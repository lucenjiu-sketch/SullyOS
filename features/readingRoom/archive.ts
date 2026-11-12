import { extractContent, safeFetchJson } from '../../utils/safeApi';
import type { LightLLMConfig } from '../../utils/memoryPalace/pipeline';
import type { ReadingDiscussionMessage } from './types';

/**
 * 共读室 · 把一个讨论窗口整理成一条可以写进记忆的第一人称经历。
 *
 * ## 为什么总结用副 LLM，不用角色的对话 API
 *
 * 归档的口径不该跟着角色换模型而变。久的角色可能挂 Claude、Gemini 或别的渠道，
 * 但「替自己写一条长期记忆」这件事她要交给记忆宫殿那个单独挑的副 API
 * （`memoryPalaceConfig.lightLLM`）。所以这里**不碰** `resolveDialogueApi` /
 * `char.dialogueApi` / 全局 `apiConfig`——那三样是讨论用的（见 `engine.ts`），
 * 跟归档是两条路。
 *
 * ## 「没配」和「报错」是两件事
 *
 * - **没配**：`baseUrl` / `apiKey` / `model` 缺一个就根本不发请求，
 *   让调用方提示去记忆宫殿设置页填。判断函数是 `isArchiveSummaryApiConfigured`。
 * - **报错**：请求发出去了，网断了或渠道返回错误。这时候抛错，
 *   调用方显示原因 + 留一个重试，**窗口状态一个字都不改**。
 *
 * 久明确问过这件事：网卡一下不能被说成「没配置」。
 *
 * ## 转写进总结的东西，和不进的东西
 *
 * 进：用户说的话、角色说的话、每条消息自己 `reference` 里的书名 / 章节 / 划线原文。
 *
 * 不进（每条都有理由，别为了「信息更全」加回来）：
 * - **`thinkingChain`**（心象）。那是角色没说出口的内部思考，
 *   当成它的发言会让总结写出它从没表达过的态度。
 * - **划线前后文**（`buildHighlightContext` 的 before / after）。那两段从第二期
 *   起就故意不进库，归档时也不许重新构造——书的正文不能因为归档进长期记忆。
 * - **别的窗口、别的角色、日常私聊**。调用方只传当前窗口的消息进来。
 *
 * 表情标签 `[[SEND_EMOJI: 名字]]` 是内部控制指令，不是角色说的话，
 * 转写成「（发了一张表情：名字）」，免得模型把方括号当成台词照抄。
 */

/** 转写文本的总长上限。超了留最后这些字——越近的讨论越该被记住。 */
const MAX_TRANSCRIPT_CHARS = 60_000;

/** 单条划线原文在转写里的上限。划线可以跨段，太长会把别的轮次挤掉。 */
const MAX_QUOTE_CHARS = 600;

/** 总结正文上限。协同是 500，这里对齐。 */
const MAX_SUMMARY_CHARS = 500;

export interface ReadingArchiveSummaryInput {
  /** 记忆宫殿配的副 LLM。缺字段时不要调用本模块，先用 `isArchiveSummaryApiConfigured` 判断。 */
  lightLLM: LightLLMConfig;
  characterName: string;
  userName: string;
  windowName: string;
  /** **只能是当前这个窗口的消息**，按 createdAt 正序。 */
  messages: ReadingDiscussionMessage[];
  signal?: AbortSignal;
}

/**
 * 副 LLM 配齐了没有。
 *
 * 三样都要：接口地址、密钥、模型名。记忆宫殿的提取环节本来就要带
 * `Authorization`，所以 apiKey 也算必填，不像对话 API 那样可以空着。
 */
export const isArchiveSummaryApiConfigured = (
  config: LightLLMConfig | null | undefined,
): boolean => (
  !!config?.baseUrl?.trim() && !!config?.apiKey?.trim() && !!config?.model?.trim()
);

export const archiveSummaryApiHint = (): string => (
  '记忆宫殿的副 LLM 还没配好（需要接口地址、密钥和模型名）。'
  + '可以去设置 → 记忆宫殿里配好，或者自己手写一段总结直接存进神经链接。'
);

/** 把表情标签换成人话。保留表情名，没名字的就整段丢掉。 */
const describeEmojiTags = (content: string): string => content.replace(
  /\[\[SEND_EMOJI\s*[:：]\s*([^\]\r\n]*?)\s*\]\]/gi,
  (_match, name: string) => {
    const label = String(name || '').trim();
    return label ? `（发了一张表情：${label}）` : '';
  },
);

/** 压掉多余空白，但保留段落换行——模型靠换行分得清这是两段话。 */
const tidyContent = (content: string): string => describeEmojiTags(content)
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/**
 * 把窗口消息转写成给总结模型看的文本。
 *
 * **纯函数，不发请求。** 测试直接断言它的输出里有什么、没有什么。
 *
 * 一个窗口会堆好几本书的讨论（久定的「窗口不分书」的直接后果），
 * 所以书名和章节**从每条消息自己的 `reference` 读**，不在外面猜一本。
 */
export function buildReadingArchiveTranscript(
  messages: ReadingDiscussionMessage[],
): string {
  const rows = messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => {
      const speaker = message.role === 'user' ? '用户' : '角色';
      const body = tidyContent(message.content);
      if (message.role !== 'user' || !message.reference) {
        return body ? `${speaker}：${body}` : '';
      }
      const reference = message.reference;
      const quote = reference.quote.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE_CHARS);
      const lines = [
        `用户正在读《${reference.bookTitle}》${reference.chapterTitle ? ` · ${reference.chapterTitle}` : ''}`,
      ];
      if (quote) lines.push(`用户划的原文：${quote}`);
      // 只划线没说话也要留着引用：那也是「她在这句上停了一下」。
      lines.push(body ? `用户当时的想法：${body}` : '用户没有另外说什么。');
      return lines.join('\n');
    })
    .filter(Boolean);
  const transcript = rows.join('\n\n');
  return transcript.length > MAX_TRANSCRIPT_CHARS
    ? transcript.slice(-MAX_TRANSCRIPT_CHARS)
    : transcript;
}

/**
 * 总结用的系统提示词。
 *
 * 口径照协同的 `summarizeCollaborationForMemory` 改写（久说参考协同）。
 * **角色名和用户名都是变量**，不写「你是角色本人」——久特意要求过这件事，
 * 第二期的说明里也是这么做的。
 */
export function buildReadingArchivePrompt(characterName: string, userName: string): string {
  const user = userName?.trim() || '用户';
  return [
    `你正在为${characterName}整理一条长期记忆：${characterName}和${user}一起读书、讨论书里某些段落的经历。`,
    `只输出一段 60～180 字的中文，用${characterName}的第一人称写（“我和${user}……”）。`,
    '不要标题、不要日期、不要列表、不要引号、不要 Markdown。',
    `写清楚我和${user}读了哪本书、聊到了什么具体的内容或人物、${user}说过什么想法、我当时怎么回应的。`,
    '如果这次聊了好几本书，每本都要点到，不要混成一本。',
    '有明确的感受、偏好或者对我们之间理解有意义的地方，也要保留。',
    '不许把书里人物的经历写成我和她真实发生过的事。',
    `不许虚构${user}没说过的想法，也不许虚构我没表达过的感受。`,
    '不要出现“用户”“助手”“AI”“模型”“共读窗口”“会话记录”“讨论记录”这类词。',
    '不要为了好看堆空洞的修饰语，也不要把同一个意思重复两遍。',
  ].join('\n');
}

/** 去掉模型爱加的代码围栏和整段包边的引号。 */
const tidySummary = (raw: string): string => raw
  .replace(/^```[^\n]*\n?|```$/g, '')
  .replace(/^[“”"'【]|[“”"'】]$/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * 月日。协同用的就是这个口径（`collaborationDateRange`），这里对齐。
 */
const monthDay = (value: number): string => {
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

/**
 * 日期壳：`【11月12日，正文】`，跨天就写成 `【11月5日～11月12日，正文】`。
 *
 * **日期取窗口里真实消息的时间**，不让总结模型自己编日期。
 * 久选了「跟着协同来」，所以包这层壳——她翻神经链接时能看出是哪天的事。
 */
export function wrapArchiveSummaryWithDate(
  summary: string,
  firstAt: number,
  lastAt: number,
): string {
  const start = monthDay(firstAt);
  const end = monthDay(lastAt);
  return `【${start === end ? start : `${start}～${end}`}，${summary}】`;
}

/**
 * 跑一次总结。
 *
 * 抛错的三种情况，调用方都该原样显示给用户：
 * - 副 LLM 没配齐（`isArchiveSummaryApiConfigured` 为假）
 * - 这个窗口没有可总结的内容
 * - 请求失败或者模型没给出可用文本
 *
 * **抛错时不要动窗口状态。** 失败了还能重试，重试就是再调一次这个函数。
 */
export const summarizeReadingRoomForMemory = async (
  input: ReadingArchiveSummaryInput,
): Promise<string> => {
  const { lightLLM, characterName, userName, windowName, messages, signal } = input;
  if (!isArchiveSummaryApiConfigured(lightLLM)) throw new Error(archiveSummaryApiHint());
  const transcript = buildReadingArchiveTranscript(messages);
  if (!transcript.trim()) throw new Error('这个窗口还没有可以总结的讨论');
  const baseUrl = lightLLM.baseUrl.trim().replace(/\/+$/, '');
  const data = await safeFetchJson(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${lightLLM.apiKey.trim()}`,
      },
      signal,
      body: JSON.stringify({
        model: lightLLM.model.trim(),
        stream: false,
        // 低温：这是在替角色记事，不是创作。协同那边也是 0.25。
        temperature: 0.25,
        messages: [
          { role: 'system', content: buildReadingArchivePrompt(characterName, userName) },
          {
            role: 'user',
            content: `这次共读的窗口叫「${windowName}」。\n\n请把下面这段一起读书的经历，写成一条我真正会记住的事情：\n\n${transcript}`,
          },
        ],
      }),
    },
    0,
    120_000,
    { appId: 'reading_room', purpose: '共读归档记忆总结' },
  );
  const summary = tidySummary(extractContent(data));
  if (!summary) throw new Error('副 LLM 没有生成可用的总结，可以再试一次');
  return summary.slice(0, MAX_SUMMARY_CHARS);
};

/**
 * 神经链接里那条归档记忆的 id。
 *
 * **按窗口固定**，所以同一个窗口重复写不会在神经链接里多出一条
 * （调用方靠这个 id 判重，照 `Chat.tsx` 的协同归档那套）。
 *
 * 注意：记忆宫殿里的向量记忆**不认这个 id**，它去重看内容像不像。
 * 所以反复归档同一个窗口，宫殿里仍可能多出几条相近的记忆——久知道这件事，
 * 界面上靠「已写进记忆」的状态和二次确认来防。
 */
export const readingArchiveFragmentId = (windowId: string): string => (
  `reading_room_archive_${windowId}`
);
