/**
 * 六个提示词开关的「要删哪几段」清单 —— 全部集中在这个文件里。
 *
 * 为什么这样写：这六个开关原先是直接插进 chatPrompts.ts / context.ts /
 * characterResponsePrinciples.ts 的模板字符串里的（见 commit a2c721c）。
 * 那三个文件是上游作者几乎每次更新都会动的核心文件，于是每次同步上游都冲突。
 *
 * 改成「后处理」：原文件保持上游原样，提示词照原样拼完整，最后在出口处把
 * 关掉的那几段按文本锚点裁掉。作者再怎么改那三个文件都不会和我们撞。
 *
 * 代价与权衡：锚点是作者写的提示词原文，作者改字 → 锚点失配。
 * 所以每段都带 `required` 标记，失配时由 rpPromptFilter 统一报警（见那边注释），
 * 行为上「宁可多发一段提示词，也不要裁错位置」。
 */

/** 一段「从哪到哪」的文本区间。start/end 都是提示词原文里的锚点。 */
export interface PromptSectionRule {
    /** 调试用名字，报警信息里会出现 */
    id: string;
    /** 区间起点锚点（含）。必须能在原文里唯一定位 */
    start: string;
    /**
     * 区间终点锚点（不含）—— 裁到它之前为止，它本身保留。
     * 省略表示裁到 start 所在段落结束（下一个空行）。
     */
    end?: string;
    /**
     * true = 这段锚点找不到就算异常（提示词被上游改写了），要报警。
     * false = 这段本来就可能不存在（例如依赖其它开关状态的衔接文本）。
     */
    required?: boolean;
    /**
     * 裁掉后在原位插入的替代文本。用于补小标题这类「不能只删、还得缝一下」的情况。
     * 省略 = 纯删除。
     */
    replaceWith?: string;
}

/**
 * style：回复风格约束。
 * 裁掉「1. 沉浸感」「2. 行为模式」「2.5 对话质量」整块，到「情绪感知」之前为止
 * （情绪那两条属 emotion 开关，单独管）。
 *
 * `emotionOn` 决定要不要补小标题：style 关而 emotion 开时，情绪那两条会失去
 * 它们原本挂靠的「2.5 对话质量」标题，变成两条没有归属的裸列表项。
 * 这时补一个「2.5 情绪回应」小标题顶上，与旧实现（commit a2c721c）行为一致。
 */
export function styleSections(emotionOn: boolean): PromptSectionRule[] {
    return [
        {
            id: 'style/chatAppRules',
            start: '1. **沉浸感**: 保持角色扮演。',
            end: '   - **情绪感知要先于对方的表达**',
            required: true,
            replaceWith: emotionOn ? '2.5 **情绪回应**:\n' : undefined,
        },
    ];
}

/** 兼容旧引用：等价于 `styleSections(true)`。 */
export const STYLE_SECTIONS: PromptSectionRule[] = styleSections(true);

/**
 * emotion：情绪回应规则。两条，紧挨着，一起裁到「3. 格式要求」之前。
 * 注意「3. 格式要求」属功能协议，必须保留。
 */
export const EMOTION_SECTIONS: PromptSectionRule[] = [
    {
        id: 'emotion/chatAppRules',
        start: '   - **情绪感知要先于对方的表达**',
        end: '3. **格式要求**:',
        required: true,
    },
];

/** listening：收尾总纲第一块「关于对方的表达」。 */
export const LISTENING_SECTIONS: PromptSectionRule[] = [
    {
        id: 'listening/principles',
        start: '### 关于对方的表达（极其重要）',
        end: '### 最后，回到你自己',
        required: true,
    },
];

/** self：收尾总纲第二块「回到你自己」。到文本末尾为止。 */
export const SELF_SECTIONS: PromptSectionRule[] = [
    {
        id: 'self/principles',
        start: '### 最后，回到你自己',
        required: true,
    },
];

/** antiFiller：context.ts 里注入的「表达底线」整段。 */
export const ANTI_FILLER_SECTIONS: PromptSectionRule[] = [
    {
        id: 'antiFiller/context',
        start: '### 表达底线 (Anti-Filler)',
        required: true,
    },
];

/** 按开关 key 查要裁的区间。 */
export const RP_SECTION_RULES = {
    style: STYLE_SECTIONS,
    emotion: EMOTION_SECTIONS,
    listening: LISTENING_SECTIONS,
    self: SELF_SECTIONS,
    antiFiller: ANTI_FILLER_SECTIONS,
} as const;
