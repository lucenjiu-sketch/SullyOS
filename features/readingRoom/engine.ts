import type { APIConfig, CharacterProfile, Emoji, EmojiCategory, UserProfile } from '../../types';
import { extractContent, safeFetchJson } from '../../utils/safeApi';
import { resolveDialogueApi, dialogueMaxTokens } from '../../utils/characterApi';
import { parseCollaborationReply } from '../collaboration/reasoning';
import { sanitizeCollaborationRichOutputSource } from '../collaboration/richOutput';
import { buildReadingRoomRequest, type ReadingTurnExcerpt } from './requestContext';
import type { ReadingDiscussionMessage, ReadingMessageReference } from './types';

/**
 * 共读室 · 把一轮讨论发给角色。
 *
 * ## API 怎么选
 *
 * 走项目现成的 `resolveDialogueApi(globalApi, char)`：**角色自己配的对话 API
 * 优先，没配就跟随全局**。这是久定的，别在这里另写一套优先级判断。
 * 每次发送都重新解析一遍，不缓存——她可能中途去改角色的 API。
 *
 * ## 不用协同工作那套引擎
 *
 * `runCollaborationTurn` 走的是**协同自己的 API Profile**（在协同设置里单独配的），
 * 不是久要的「角色独立 API 优先 + 全局兜底」。所以这里自己发请求，
 * 只复用它的回复解析（`parseCollaborationReply` 处理各家把思考链塞在
 * reasoning_content 的差异）和脏标签清理。
 *
 * ## 思考链
 *
 * 模型原生的思考通道由 `parseCollaborationReply` 分离出来，单独存在
 * `thinkingChain` 里，不混进正文。要不要向模型索取思考链由
 * `requestContext` 那边按角色设置决定（含久自己做的「关掉自带提示词」开关）。
 */

export interface ReadingTurnResult {
  content: string;
  thinkingChain?: string;
}

export interface RunReadingTurnInput {
  globalApi: APIConfig;
  char: CharacterProfile;
  user: UserProfile;
  emojis?: Emoji[];
  categories?: EmojiCategory[];
  /** 当前窗口已有的消息，不含这一轮。 */
  history: ReadingDiscussionMessage[];
  text: string;
  reference?: ReadingMessageReference;
  /** 划线前后文。**只用于这一轮**，不会被存库。 */
  excerpt?: ReadingTurnExcerpt;
  signal?: AbortSignal;
  /** 流式增量。每次给的是本次尝试累计的完整正文，调用方全量替换即可。 */
  onDelta?: (fullText: string) => void;
}

/** 配没配好。两边都没有时要让用户看见明确报错，不能静默。 */
export const isReadingApiConfigured = (api: APIConfig): boolean => (
  !!api.baseUrl?.trim() && !!api.model?.trim()
);

export const readingApiHint = (char: CharacterProfile): string => (
  `${char.name}和全局都没有配好对话 API（需要接口地址和模型名）。`
  + '可以在角色设置里给TA单独配一个，或者在系统设置里配好全局 API。'
);

/**
 * 跑一轮。
 *
 * 失败就抛错，由调用方决定怎么提示——**用户那条消息已经存好了，不要删**（久的要求）。
 */
export const runReadingTurn = async ({
  globalApi,
  char,
  user,
  emojis,
  categories,
  history,
  text,
  reference,
  excerpt,
  signal,
  onDelta,
}: RunReadingTurnInput): Promise<ReadingTurnResult> => {
  // 每轮重新解析：角色独立 API 优先，没配跟随全局。
  const api = resolveDialogueApi(globalApi, char);
  if (!isReadingApiConfigured(api)) throw new Error(readingApiHint(char));

  const messages = await buildReadingRoomRequest({
    char, user, emojis, categories, history, text, reference, excerpt,
  });
  signal?.throwIfAborted();

  const baseUrl = api.baseUrl.trim().replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (api.apiKey?.trim()) headers.Authorization = `Bearer ${api.apiKey.trim()}`;

  const stream = api.stream !== false;
  const data = await safeFetchJson(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: api.model.trim(),
        messages,
        temperature: Math.max(0, Math.min(2, Number(api.temperature) || 0.85)),
        max_tokens: dialogueMaxTokens(api),
        stream,
      }),
    },
    0,
    0,
    { appId: 'reading_room', appName: '共读室', charId: char.id, purpose: '共读讨论' },
    // 流式时边收边显示。清理在这里也做一遍，否则半截的标签会闪出来。
    stream && onDelta
      ? { onDelta: (_delta, fullText) => onDelta(sanitizeCollaborationRichOutputSource(fullText)) }
      : undefined,
  );

  if (signal?.aborted) throw signal.reason ?? new DOMException('已停止生成', 'AbortError');

  const parsed = parseCollaborationReply(data);
  const content = parsed.content || extractContent(data) || '';
  if (!content.trim()) throw new Error('这一轮没有收到可用的回复内容');
  return {
    content: sanitizeCollaborationRichOutputSource(content),
    ...(parsed.thinkingChain ? { thinkingChain: parsed.thinkingChain } : {}),
  };
};