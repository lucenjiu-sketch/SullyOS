/**
 * 六个开关的字段定义与读写 —— 不碰 types.ts。
 *
 * 原方案把这六个字段直接加进 `types.ts` 的 `CharacterProfile` 接口里
 * （见 commit a2c721c）。types.ts 是上游改得最频繁的文件之一（18 万字符），
 * 所以那六行注释加字段每次都会参与冲突。
 *
 * 这里改用 TS 的 interface 声明合并（declaration merging）：
 * 在本文件里重新 `declare module` 一次 `CharacterProfile`，把字段补上去。
 * 效果和写在 types.ts 里完全一样 —— 全项目任何地方 `char.rpStyleEnabled`
 * 都有类型、有补全、有检查 —— 但 types.ts 一个字节都不用动。
 */
import type { RpPromptToggles } from '../rpPromptToggles';

declare module '../../types' {
    interface CharacterProfile {
        // ── 角色扮演规范开关（五块，各自独立，默认全开：!== false 即开）──
        // 只管「怎么扮演 / 怎么说话」这类风格与心态提示词；聊天气泡格式、
        // 模式切换格式、语音格式，以及表情 [[SEND_EMOJI]]、引用 [[QUOTE]]、
        // 动作 [[ACTION:...]] 等功能协议一律不受影响
        // （关掉会让前端解析不到标签，功能直接失效）。
        /** 回复风格约束：沉浸感、个性化表达、对话质量与情绪层次 */
        rpStyleEnabled?: boolean;
        /** 情绪回应规则：从语气变化察觉情绪，及面对害怕/重大变故时的回应顺序 */
        rpEmotionEnabled?: boolean;
        /** 倾听与反馈规则：尊重用户明确表达的感受，并让用户反馈影响后续回应 */
        rpListeningEnabled?: boolean;
        /** 回到你自己：语言即经历的沉淀，不刻意找「符合人设」的话 */
        rpSelfEnabled?: boolean;
        /** 表达底线：没话说时不用空泛感慨与万能句式填充 */
        rpAntiFillerEnabled?: boolean;

        /**
         * 是否注入项目自带的那篇 THINKING 阶段引导（utils/thinkingChainPrompt.ts）。
         * 默认开（!== false 即开）。受 showThinkingChain 统辖：主开关关着时本开关无意义。
         * 关掉后只少那篇引导本身 —— reasoning 抓取、心象卡片渲染、以及用户自己写的
         * thinkingChainCustomPrompt 照常生效，所以可以用它「只用我自己写的引导」。
         * 聊天、语音通话、协同窗口三处共用同一篇，一并受控。
         */
        thinkingChainPromptEnabled?: boolean;
    }
}

/** 五个 rp 开关对应的角色字段名，UI 与裁剪共用一份映射。 */
export const RP_TOGGLE_FIELDS = {
    style: 'rpStyleEnabled',
    emotion: 'rpEmotionEnabled',
    listening: 'rpListeningEnabled',
    self: 'rpSelfEnabled',
    antiFiller: 'rpAntiFillerEnabled',
} as const satisfies Record<keyof RpPromptToggles, string>;

/** 内置思考引导开关的字段名。 */
export const THINKING_CHAIN_PROMPT_FIELD = 'thinkingChainPromptEnabled' as const;

/**
 * 分享角色卡时要剥掉的六个字段 —— 不碰 characterCard.ts 的 CARD_STRIPPED_FIELDS。
 *
 * 这六个都属于「用户在本机怎么想让这个角色被提示」的偏好，不该随卡传播；
 * 接收方拿到默认全开（= 上游原始行为），不会拿到一张被悄悄关掉几块规范的卡。
 * 整机备份照常保留这六个字段（备份走的是完整对象，不经这里）。
 */
export const PROMPT_TOGGLE_CARD_FIELDS = [
    'rpStyleEnabled',
    'rpEmotionEnabled',
    'rpListeningEnabled',
    'rpSelfEnabled',
    'rpAntiFillerEnabled',
    'thinkingChainPromptEnabled',
] as const;

/** 从角色对象上剥掉这六个字段，返回新对象（不改入参）。 */
export function stripPromptToggleFields<T extends Record<string, any>>(data: T): T {
    const clone: Record<string, any> = { ...data };
    for (const key of PROMPT_TOGGLE_CARD_FIELDS) {
        delete clone[key];
    }
    return clone as T;
}