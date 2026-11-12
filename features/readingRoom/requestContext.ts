import type { CharacterProfile, Emoji, EmojiCategory, UserProfile } from '../../types';
import { ContextBuilder } from '../../utils/context';
import { ChatPrompts } from '../../utils/chatPrompts';
import { buildThinkingChainPrompt } from '../../utils/thinkingChainPrompt';
import { injectMemoryPalace } from '../../utils/memoryPalace/pipeline';
import { buildHighlightContext } from './highlight';
import type { ReadingDiscussionMessage, ReadingMessageReference } from './types';

/**
 * 共读室 · 一轮请求的上下文组装。
 *
 * ## 角色还是平时那个角色
 *
 * 久要的是「共读室里的角色仍然是平时聊天里的那个」，所以人设、世界观、
 * 世界书、用户资料、长期记忆、记忆宫殿门牌、向量召回**全都走项目现成的
 * `ContextBuilder.buildCharacterRequest`**，不自己拼一套简版人设。
 *
 * ## 但讨论历史是独立的
 *
 * `buildCharacterRequest` 天生不读日常私聊记录，正好符合久的要求。
 * **不要改成走 `buildLiveCollaborationChatContext`** —— 那个函数内部真的去读
 * ChatApp 的聊天历史，用它就会把日常私聊整段搬进共读室。
 *
 * ## 门牌和召回必须先跑 injectMemoryPalace
 *
 * 这两样都不是 `buildCharacterRequest` 自己能拿到的：
 * - **门牌**（房间常驻介绍）是纯本地读 + 格式化，不花钱，每轮都该在
 * - **向量召回**按当前这句话去翻相关记忆，每轮都变
 *
 * `injectMemoryPalace` 把两样都挂到传进去的角色对象上（`roomPlatesInjection`
 * / `memoryPalaceInjection`），`buildCharacterRequest` 随后才读得到。
 * **少了这一步，角色就只剩人设和长期记忆，没有门牌也没有精确召回。**
 *
 * 写在一个**浅拷贝**上，不碰真正的角色对象——那份会被 saveCharacter 持久化，
 * 污染了会让日常聊天也带上共读室这一轮的召回。
 *
 * ## 正文永不进请求
 *
 * 只发划线那段加前后各 320 字符（`buildHighlightContext`）。
 * **前后文只属于这一轮**：不进 IndexedDB，也不从历史消息里重新拼回来。
 * 历史里的引用只有书名 / 章节 / 划线原文（见 `types.ts`）。
 */

/** 记忆召回最多给多少条。和协同的沉浸式一档对齐。 */
const RECALL_MAX_ITEMS = 15;

/** 召回 query 取最近几条讨论。太多会把检索意图冲淡。 */
const RECALL_RECENT_MESSAGES = 6;

/**
 * 告诉模型这是什么地方。
 *
 * 角色名和用户名都是变量——久明确要求的：不要写「你仍然是角色本人」，
 * 要写「你仍然是〔那个角色的名字〕」。
 */
export const buildReadingRoomProtocol = (charName: string, userName: string): string => `### 共读室
这是共读室，一个由用户主动打开的独立窗口。你仍然是${charName}，和日常聊天里是同一个你——记忆、关系、说话的方式都延续着。
${userName}在这里和你一起读一本书。她会划出某一段来问你。

- 你看到的只有她划的那一段和它前后的少量原文，**没有整本书**。不要假装读过没给你的部分，也不要推测后面的情节；想知道就问她。
- 这一轮在读哪本书、哪一章，下面写明了。同一个窗口里可能先后聊过好几本书，以当前这一轮为准。
- 像一个真的在陪她读书的人那样说话：可以有自己的看法，可以被某一句打动，可以不同意书里某个人的做法。这不是阅读理解题。
- 她有时只划一段、不写别的，那就是在说「你看这个」。
- 这间窗口能发文字、Markdown 排版、表情包。**不能用**日常聊天里那些动作（戳一戳、转账、日历、定时消息、HTML 气泡、语音条等等），也不要输出 \`[[ACTION:...]]\` 这类指令。
- 本窗口和日常聊天、和其它共读窗口都不共享对话。`;

/**
 * 表情包规则。
 *
 * 久定的：**允许表情包，不要语音条**。所以这里只声明表情，
 * 并且明确告诉模型别输出语音标签——不写这一句，开了语音的角色会照习惯发
 * `<语音>`，面板不认它就变成一行裸标签。
 */
export const buildReadingRoomEmojiPrompt = (
  char: CharacterProfile,
  emojis: Emoji[] = [],
  categories: EmojiCategory[] = [],
): string => {
  const visible = ChatPrompts.filterVisibleEmojis(emojis, categories, char.id);
  const emojiRule = visible.emojis.length > 0
    ? `- 可以发表情包；只用 \`[[SEND_EMOJI: 表情名称]]\`，可用表情为：${ChatPrompts.buildEmojiContext(visible.emojis, visible.categories)}。`
    : '- 当前没有可用表情包，不要输出 SEND_EMOJI。';
  return `

### 这里能发什么
${emojiRule}
- 共读室不支持语音条，不要输出 \`<语音>\` 或 \`<字幕>\`。`;
};

/**
 * 心象（思考链）规则。
 *
 * 口径和协同工作完全一致，久确认过这件事：
 * - `showThinkingChain` 关 → 什么都不发
 * - `thinkingChainPromptEnabled` 为 false → **不发项目自带那份**，只发用户写的
 * - 两个都开 → 自带 + 用户追加
 *
 * 那个「关掉自带提示词」的开关是久自己做的，她要求共读室也认它。
 */
export const buildReadingRoomThinkingPrompt = (
  char: CharacterProfile,
  user: UserProfile,
): string => {
  if (!char.showThinkingChain) return '';
  const custom = (char.thinkingChainCustomPrompt || '').trim();
  const builtin = char.thinkingChainPromptEnabled !== false
    ? buildThinkingChainPrompt(char.name, user.name)
    : '';
  const customBlock = custom ? `\n\n### 用户追加的心象规则\n${custom}` : '';
  if (!builtin && !customBlock) return '';
  return `\n\n${builtin}${customBlock}`;
};

/** 这一轮的引用要带的临时正文。**只在本轮请求里存在。** */
export interface ReadingTurnExcerpt {
  before: string;
  after: string;
}

/**
 * 把一条历史消息渲染成发给模型的文字。
 *
 * 带引用的消息会在前面标出书名、章节和划线原文——**但没有前后文**。
 * 这是「前后文不重复发送」的实现点：历史消息里本来就没存前后文，
 * 所以这里也不可能把它们拼回来。
 */
export const renderHistoryMessage = (message: ReadingDiscussionMessage): string => {
  if (!message.reference) return message.content;
  const head = `［她引用了《${message.reference.bookTitle}》${message.reference.chapterTitle}：“${message.reference.quote}”］`;
  return message.content ? `${head}\n${message.content}` : head;
};

/**
 * 当前这一轮的用户消息。
 *
 * 和历史消息的区别**只有前后文**：这里多了划线前后各 320 字符，
 * 用完就丢。下一轮再读这条消息时走 `renderHistoryMessage`，前后文不会再出现。
 */
export const renderCurrentTurn = (
  text: string,
  reference?: ReadingMessageReference,
  excerpt?: ReadingTurnExcerpt,
): string => {
  if (!reference) return text;
  const lines = [
    '### 当前共读',
    `书名：《${reference.bookTitle}》`,
    `章节：${reference.chapterTitle}`,
    '',
    '### 她划的这一段',
  ];
  if (excerpt?.before) lines.push(`（前文）…${excerpt.before}`);
  lines.push(`【${reference.quote}】`);
  if (excerpt?.after) lines.push(`（后文）${excerpt.after}…`);
  lines.push('');
  lines.push('### 她说');
  lines.push(text || '（她只把这一段划给你看，没有写别的。）');
  return lines.join('\n');
};

/**
 * 取这一轮的前后文。
 *
 * 用 `buildHighlightContext`（有测试锁着「不含全书」）。
 * 拿不到正文（书被删了、划线对不上）时返回 undefined，这一轮就只带划线原文——
 * 不该因为少一点前后文就整轮失败。
 */
export const resolveTurnExcerpt = (
  content: string | null,
  reference?: ReadingMessageReference,
  highlightRange?: { startOffset: number; endOffset: number },
): ReadingTurnExcerpt | undefined => {
  if (!content || !reference || !highlightRange) return undefined;
  const excerpt = buildHighlightContext(content, highlightRange);
  if (!excerpt.before && !excerpt.after) return undefined;
  return { before: excerpt.before, after: excerpt.after };
};

export interface BuildReadingRequestInput {
  char: CharacterProfile;
  user: UserProfile;
  emojis?: Emoji[];
  categories?: EmojiCategory[];
  /** 这个窗口已有的消息（不含当前这一轮）。只能是**当前窗口**的。 */
  history: ReadingDiscussionMessage[];
  /** 当前这一轮用户写的话。 */
  text: string;
  reference?: ReadingMessageReference;
  excerpt?: ReadingTurnExcerpt;
}

/**
 * 组装一轮请求的 messages。
 *
 * 顺序要紧：**先召回，再建上下文**。`injectMemoryPalace` 把门牌和召回写到
 * 浅拷贝上，`buildCharacterRequest` 才能把它们放进 system prompt。
 * 倒过来的话这两样都会丢。
 */
export const buildReadingRoomRequest = async ({
  char,
  user,
  emojis = [],
  categories = [],
  history,
  text,
  reference,
  excerpt,
}: BuildReadingRequestInput): Promise<Array<{ role: string; content: any }>> => {
  // 浅拷贝：注入字段会被 saveCharacter 持久化，不能污染真正的角色对象。
  const recallChar: CharacterProfile = {
    ...char,
    memoryPalaceInjection: '',
    roomPlatesInjection: '',
  };

  // 召回的 query：当前这句话 + 划线原文 + 最近几条讨论。
  // 划线原文要进 query——她问的往往就是这段话里的人和事。
  const query = [
    text,
    reference?.quote,
    ...history.slice(-RECALL_RECENT_MESSAGES).map(message => message.content),
  ].filter(Boolean).join('\n').slice(-80_000);

  // 召回失败不该让整轮挂掉：没有召回角色照样能聊，只是记得少一些。
  try {
    await injectMemoryPalace(
      recallChar,
      history.slice(-200).map((message, index) => ({
        id: Math.max(1, Math.floor(message.createdAt)) + index,
        charId: char.id,
        role: message.role,
        type: 'text',
        content: renderHistoryMessage(message).slice(0, 30_000),
        timestamp: message.createdAt,
      })) as any,
      query,
      user.name,
      { entryPoint: 'reading_room', formatterMaxOutputItems: RECALL_MAX_ITEMS },
    );
  } catch (error) {
    console.warn('[ReadingRoom] 这一轮的记忆召回没成功', error);
  }

  const instructions = [
    buildReadingRoomProtocol(char.name, user.name),
    buildReadingRoomEmojiPrompt(char, emojis, categories),
    buildReadingRoomThinkingPrompt(char, user),
  ].join('');

  const turns = [
    ...history.map(message => ({
      role: message.role as 'user' | 'assistant',
      content: renderHistoryMessage(message),
    })),
    { role: 'user' as const, content: renderCurrentTurn(text, reference, excerpt) },
  ].filter(message => !!String(message.content).trim());

  return ContextBuilder.buildCharacterRequest(
    { char: recallChar, user, instructions, includeDetailedMemories: true },
    turns,
  );
};