/**
 * 角色扮演规范开关 —— 五块风格类提示词的注入判定。
 *
 * 背景：聊天 system prompt 里混着两类内容。
 * - 风格/心态类（「保持角色扮演」「用细节代替概括」「你就是 XXX」…）：影响语气和表达，
 *   删掉模型照样能正常对话，只是少了这层引导。这五个开关管的就是这类。
 * - 功能协议类（气泡换行格式、`[[SEND_EMOJI]]`、`[[QUOTE]]`、`[[ACTION:...]]`、
 *   语音标签、模式切换锚定…）：前端要靠它解析标签。**不受开关影响**，
 *   关掉会让表情/引用/转账等功能直接失效。
 *
 * 默认全开（`!== false`）：旧角色数据里没有这些字段，必须保持现有行为不变。
 */
import type { CharacterProfile } from '../types';

export interface RpPromptToggles {
    /** 回复风格约束：沉浸感、个性化表达、对话质量与情绪层次 */
    style: boolean;
    /** 情绪回应规则：从语气变化察觉情绪，及面对害怕/重大变故时的回应顺序 */
    emotion: boolean;
    /** 倾听与反馈规则：尊重用户明确表达的感受，并让用户反馈影响后续回应 */
    listening: boolean;
    /** 回到你自己：语言是经历的沉淀，不刻意找「符合人设」的话 */
    self: boolean;
    /** 表达底线：没话说时不用空泛感慨与万能句式填充 */
    antiFiller: boolean;
}

export const DEFAULT_RP_PROMPT_TOGGLES: RpPromptToggles = {
    style: true, emotion: true, listening: true, self: true, antiFiller: true,
};

/** 从角色档案读出五个开关。char 缺失（部分旧调用路径）时按全开处理。 */
export function resolveRpPromptToggles(char?: Partial<CharacterProfile> | null): RpPromptToggles {
    if (!char) return { ...DEFAULT_RP_PROMPT_TOGGLES };
    return {
        style: char.rpStyleEnabled !== false,
        emotion: char.rpEmotionEnabled !== false,
        listening: char.rpListeningEnabled !== false,
        self: char.rpSelfEnabled !== false,
        antiFiller: char.rpAntiFillerEnabled !== false,
    };
}
