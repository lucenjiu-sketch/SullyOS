import { describe, it, expect } from 'vitest';
import {
  buildReadingRoomEmojiPrompt,
  buildReadingRoomProtocol,
  buildReadingRoomThinkingPrompt,
  renderCurrentTurn,
  renderHistoryMessage,
  resolveTurnExcerpt,
} from '../features/readingRoom/requestContext';
import { createDiscussionMessage } from '../features/readingRoom/discussion';
import type { ReadingMessageReference } from '../features/readingRoom/types';
import type { CharacterProfile, UserProfile } from '../types';

/**
 * 共读室 · 一轮请求里那些纯文本组装的规则。
 *
 * `buildReadingRoomRequest` 整体要碰 IndexedDB 和向量召回，不在这里测；
 * 这个文件锁住的是**最容易被改坏、而且坏了用户很难发现**的几条：
 *
 * - 划线前后文只出现在当前这一轮，历史消息里一个字都没有
 * - 说明里的角色名和用户名是变量，不是写死的字
 * - 思考链三档开关（含久自己做的「关掉自带提示词」那个）
 */

const character = (patch: Partial<CharacterProfile> = {}): CharacterProfile => ({
  id: 'c1',
  name: '尚州',
  ...patch,
} as CharacterProfile);

const user = (patch: Partial<UserProfile> = {}): UserProfile => ({
  name: '陆沫久',
  ...patch,
} as UserProfile);

const reference = (patch: Partial<ReadingMessageReference> = {}): ReadingMessageReference => ({
  bookId: 'b1',
  bookTitle: '玻璃城堡',
  chapterTitle: '第三章',
  highlightId: 'h1',
  quote: '他看着窗外，没有回答。',
  ...patch,
});

describe('共读室 · 告诉模型这是什么地方', () => {
  it('角色名是变量，不是写死的「角色本人」', () => {
    const text = buildReadingRoomProtocol('尚州', '陆沫久');
    expect(text).toContain('你仍然是尚州');
    // 久明确要求过不要这种写法。
    expect(text).not.toContain('你仍然是角色本人');
  });

  it('用户名跟着用户设置走', () => {
    expect(buildReadingRoomProtocol('周绪文', '小久')).toContain('小久在这里和你一起读');
  });

  it('换个角色换个用户，两个名字都跟着换', () => {
    const text = buildReadingRoomProtocol('哈基米', '阿久');
    expect(text).toContain('你仍然是哈基米');
    expect(text).toContain('阿久在这里');
    expect(text).not.toContain('尚州');
  });

  it('说清楚看不到整本书', () => {
    const text = buildReadingRoomProtocol('尚州', '陆沫久');
    expect(text).toContain('没有整本书');
    expect(text).toContain('不要假装读过');
  });

  it('说清楚这里和日常聊天、别的共读窗口都不共享', () => {
    expect(buildReadingRoomProtocol('尚州', '陆沫久')).toContain('不共享对话');
  });
});

describe('共读室 · 能发什么', () => {
  it('有表情包时给出可用清单', () => {
    const text = buildReadingRoomEmojiPrompt(
      character(),
      [{ id: 'e1', name: '开心', url: 'blobref:x' } as any],
      [],
    );
    expect(text).toContain('SEND_EMOJI');
    expect(text).toContain('开心');
  });

  it('没有表情包时明确不要输出 SEND_EMOJI', () => {
    const text = buildReadingRoomEmojiPrompt(character(), [], []);
    expect(text).toContain('不要输出 SEND_EMOJI');
  });

  it('永远禁掉语音条 —— 久定的「允许表情包，不要语音条」', () => {
    // 角色开了语音也不行：面板不渲染语音，发出来就是一行裸标签。
    const text = buildReadingRoomEmojiPrompt(character({ chatVoiceEnabled: true } as any), [], []);
    expect(text).toContain('不要输出');
    expect(text).toContain('语音');
  });
});

describe('共读室 · 心象（思考链）三档开关', () => {
  it('总开关关掉就什么都不发', () => {
    expect(buildReadingRoomThinkingPrompt(character(), user())).toBe('');
    expect(buildReadingRoomThinkingPrompt(
      character({ showThinkingChain: false } as any),
      user(),
    )).toBe('');
  });

  it('总开关开着，默认发项目自带那份', () => {
    const text = buildReadingRoomThinkingPrompt(
      character({ showThinkingChain: true } as any),
      user(),
    );
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('关掉「自带提示词」后不发原生那份，只发用户写的', () => {
    // 这个开关是久自己做的，她要求共读室也认它。
    const builtin = buildReadingRoomThinkingPrompt(
      character({ showThinkingChain: true } as any),
      user(),
    );
    const text = buildReadingRoomThinkingPrompt(
      character({
        showThinkingChain: true,
        thinkingChainPromptEnabled: false,
        thinkingChainCustomPrompt: '只写一句话的心象。',
      } as any),
      user(),
    );
    expect(text).toContain('只写一句话的心象。');
    expect(text).not.toBe(builtin);
    expect(text).toContain('用户追加的心象规则');
  });

  it('关掉自带、又没写自定义，就彻底不发', () => {
    expect(buildReadingRoomThinkingPrompt(
      character({ showThinkingChain: true, thinkingChainPromptEnabled: false } as any),
      user(),
    )).toBe('');
  });

  it('自带和自定义都在时两份都发', () => {
    const text = buildReadingRoomThinkingPrompt(
      character({
        showThinkingChain: true,
        thinkingChainCustomPrompt: '别写太长。',
      } as any),
      user(),
    );
    expect(text).toContain('别写太长。');
    expect(text.trim().length).toBeGreaterThan('别写太长。'.length);
  });
});

describe('共读室 · 历史消息里没有前后文', () => {
  it('带引用的历史只给书名、章节、划线原文', () => {
    const message = createDiscussionMessage({
      windowId: 'w1',
      role: 'user',
      content: '他为什么不回答',
      reference: reference(),
      now: 1,
    });
    const text = renderHistoryMessage(message);
    expect(text).toContain('玻璃城堡');
    expect(text).toContain('第三章');
    expect(text).toContain('他看着窗外，没有回答。');
    expect(text).toContain('他为什么不回答');
  });

  it('只划了一段没写感想的历史，也渲染得出来', () => {
    const message = createDiscussionMessage({
      windowId: 'w1',
      role: 'user',
      content: '',
      reference: reference(),
      now: 1,
    });
    expect(renderHistoryMessage(message)).toContain('他看着窗外，没有回答。');
  });

  it('闲聊消息原样返回，不套引用的壳', () => {
    const message = createDiscussionMessage({
      windowId: 'w1',
      role: 'user',
      content: '今天先读到这里',
      now: 1,
    });
    expect(renderHistoryMessage(message)).toBe('今天先读到这里');
  });

  it('历史里不会出现前后文 —— 这是「不重复发送」的根据', () => {
    // 消息对象里本来就没存 before/after，渲染时也无从拼回来。
    const message = createDiscussionMessage({
      windowId: 'w1',
      role: 'user',
      content: '这段真好',
      reference: reference(),
      now: 1,
    });
    const text = renderHistoryMessage(message);
    expect(text).not.toContain('前文');
    expect(text).not.toContain('后文');
  });
});

describe('共读室 · 当前这一轮', () => {
  const excerpt = { before: '雨下了一整夜。', after: '她把窗关上了。' };

  it('写明书名和章节 —— 窗口不分书，靠这里告诉角色', () => {
    const text = renderCurrentTurn('为什么', reference(), excerpt);
    expect(text).toContain('《玻璃城堡》');
    expect(text).toContain('第三章');
  });

  it('前后文只在这一轮出现', () => {
    const text = renderCurrentTurn('为什么', reference(), excerpt);
    expect(text).toContain('雨下了一整夜。');
    expect(text).toContain('她把窗关上了。');
    expect(text).toContain('他看着窗外，没有回答。');
  });

  it('她只划了一段没写话时，明确告诉角色这件事', () => {
    const text = renderCurrentTurn('', reference(), excerpt);
    expect(text).toContain('没有写别的');
  });

  it('拿不到前后文也照样能发，只是少了前后文', () => {
    const text = renderCurrentTurn('为什么', reference(), undefined);
    expect(text).toContain('他看着窗外，没有回答。');
    expect(text).not.toContain('前文');
  });

  it('没有引用的闲聊就只发她写的那句，不套书名的壳', () => {
    expect(renderCurrentTurn('今天先读到这里', undefined, undefined)).toBe('今天先读到这里');
  });
});

describe('共读室 · 取前后文', () => {
  const content = `${'前'.repeat(500)}他看着窗外，没有回答。${'后'.repeat(500)}`;
  const range = { startOffset: 500, endOffset: 511 };

  it('前后各取一段，不是整本书', () => {
    const excerpt = resolveTurnExcerpt(content, reference(), range);
    expect(excerpt).toBeDefined();
    // buildHighlightContext 默认前后各 320 字符。
    expect(excerpt!.before.length).toBeLessThanOrEqual(320);
    expect(excerpt!.after.length).toBeLessThanOrEqual(320);
    expect(excerpt!.before.length + excerpt!.after.length).toBeLessThan(content.length);
  });

  it('正文读不出来时返回 undefined，不该让整轮失败', () => {
    expect(resolveTurnExcerpt(null, reference(), range)).toBeUndefined();
  });

  it('没有引用就不取前后文', () => {
    expect(resolveTurnExcerpt(content, undefined, range)).toBeUndefined();
  });

  it('划线范围缺失时返回 undefined（划线可能已被删掉）', () => {
    expect(resolveTurnExcerpt(content, reference(), undefined)).toBeUndefined();
  });

  it('划线就在开头、前面没内容时也不报错', () => {
    const excerpt = resolveTurnExcerpt('他看着窗外。后面还有很多字。', reference(), {
      startOffset: 0,
      endOffset: 6,
    });
    expect(excerpt?.before).toBe('');
    expect(excerpt?.after).toContain('后面还有很多字');
  });
});