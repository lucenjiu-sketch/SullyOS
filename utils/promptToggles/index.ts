/**
 * 六个提示词开关 —— 统一入口。
 *
 * 外部只从这里 import。目录内部的分工：
 * - `promptToggleFields.ts`  字段定义（声明合并，不碰 types.ts）与角色卡剥离
 * - `rpPromptSections.ts`    「关掉哪个开关要裁哪几段」的锚点清单
 * - `rpPromptFilter.ts`      裁剪执行与锚点失配报警
 *
 * ## 这套东西为什么存在
 * 久（本仓库 owner）要把项目内置的角色扮演提示词做成可关的开关，
 * 但又要能方便地同步上游作者的更新。第一版（commit a2c721c）直接改了
 * `hooks/useChatAI.ts` / `types.ts` / `utils/characterCard.ts` 等核心文件的内部，
 * 结果每次上游更新都冲突（实测作者 21 个提交 239 文件，GitHub 判 mergeable=false）。
 *
 * 这一版的原则：**上游文件一个都不碰**。
 * - 字段靠 TS 声明合并挂到 CharacterProfile 上
 * - 开关生效靠在提示词出口处做一次文本裁剪
 * - UI 面板是本仓库自己新增的组件
 *
 * 唯一的接入点在 `utils/chatRequestPayload.ts` 的出口（一行调用），
 * 以及 UI 侧挂面板的地方。其余全在本目录内。
 */
export {
    RP_TOGGLE_FIELDS,
    THINKING_CHAIN_PROMPT_FIELD,
    PROMPT_TOGGLE_CARD_FIELDS,
    stripPromptToggleFields,
} from './promptToggleFields';

export {
    applyRpPromptToggles,
    stripThinkingChainPrompt,
} from './rpPromptFilter';

export {
    RP_SECTION_RULES,
    type PromptSectionRule,
} from './rpPromptSections';

import type { CharacterProfile } from '../../types';
import { resolveRpPromptToggles, type RpPromptToggles } from '../rpPromptToggles';
import { applyRpPromptToggles, stripThinkingChainPrompt } from './rpPromptFilter';

export { resolveRpPromptToggles, type RpPromptToggles };

/** 内置思考引导是否开启。缺省（旧数据）= 开。 */
export function isThinkingChainPromptEnabled(char?: Partial<CharacterProfile> | null): boolean {
    return char?.thinkingChainPromptEnabled !== false;
}

/**
 * 出口处的总入口：按角色的六个开关，把该裁的段落从完整提示词里裁掉。
 *
 * 放在提示词拼完之后调用一次，所以：
 * - 不管上游以后把这些段落挪到哪个文件、哪个顺序，只要文案没改就照样生效
 * - 全开（默认 / 旧角色数据）时原样返回，行为与上游完全一致
 */
export function applyPromptToggles(
    prompt: string,
    char?: Partial<CharacterProfile> | null,
): string {
    if (!prompt || !char) return prompt;
    const out = applyRpPromptToggles(prompt, resolveRpPromptToggles(char));
    return stripThinkingChainPrompt(out, isThinkingChainPromptEnabled(char));
}