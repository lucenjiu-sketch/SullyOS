/**
 * 提示词开关的执行器：把关掉的那几段从拼好的提示词里裁掉。
 *
 * 入口只有两个函数，给出口处各调用一次（见 utils/promptToggles/index.ts）：
 * - `applyRpPromptToggles`  裁五块角色扮演规范
 * - `stripThinkingChainPrompt`  裁内置思考引导
 *
 * ## 为什么用文本裁剪而不是条件拼接
 * 条件拼接要改作者的模板字符串（原方案），每次上游更新必冲突。
 * 文本裁剪只在最后一步动手，原文件可以保持上游原样。
 *
 * ## 安全底线
 * 锚点失配时**不裁**，原样返回，并打一条 console.warn。
 * 理由：多发一段提示词只是开关失效（用户能看出来、能反馈），
 * 裁错位置会切坏功能协议（表情、引用、转账的标签说明），
 * 那是静默的功能损坏。两害相权，宁可开关失效。
 */
import type { RpPromptToggles } from '../rpPromptToggles';
import { RP_SECTION_RULES, styleSections, type PromptSectionRule } from './rpPromptSections';

/** 锚点失配时的报警。收在一处，方便以后改成上报或 UI 提示。 */
function warnAnchorMiss(rule: PromptSectionRule): void {
    console.warn(
        `[promptToggles] 锚点失配，这段没裁掉: ${rule.id}\n`
        + `  找不到: ${JSON.stringify(rule.start.slice(0, 40))}\n`
        + `  很可能是上游改写了这段提示词原文。请更新 utils/promptToggles/rpPromptSections.ts 里的锚点。`,
    );
}

/**
 * 删掉 [start, end) 区间。end 省略时删到段落结束（下一个空行，或文本末尾）。
 * 找不到 start 就原样返回。
 */
function cutSection(text: string, rule: PromptSectionRule): { text: string; cut: boolean } {
    const from = text.indexOf(rule.start);
    if (from < 0) return { text, cut: false };

    let to: number;
    if (rule.end) {
        to = text.indexOf(rule.end, from + rule.start.length);
        // end 锚点找不到 → 区间右端不确定，不敢猜，整段放弃
        if (to < 0) return { text, cut: false };
    } else {
        const blank = text.indexOf('\n\n', from + rule.start.length);
        to = blank < 0 ? text.length : blank + 2;
    }

    return { text: text.slice(0, from) + (rule.replaceWith ?? '') + text.slice(to), cut: true };
}

/** 按一组规则连续裁剪，逐条报警。 */
function cutAll(text: string, rules: readonly PromptSectionRule[]): string {
    let out = text;
    for (const rule of rules) {
        const res = cutSection(out, rule);
        if (!res.cut && rule.required) warnAnchorMiss(rule);
        out = res.text;
    }
    return out;
}

/**
 * 裁掉被关掉的角色扮演规范段落。全开（默认）时直接返回原文，零开销。
 *
 * 功能协议不受影响：气泡格式、`[[SEND_EMOJI]]`、`[[QUOTE]]`、`[[ACTION:...]]`、
 * 语音标签、模式切换锚定都在裁剪区间之外（区间右端锚在「3. 格式要求」这类
 * 功能协议标题上，裁到它之前为止）。
 */
export function applyRpPromptToggles(prompt: string, toggles: RpPromptToggles): string {
    if (!prompt) return prompt;

    let out = prompt;
    // 顺序固定：style 在 emotion 之前，因为 style 的右端锚点是 emotion 的左端锚点，
    // 先裁 emotion 会让 style 的 end 失配。
    if (!toggles.style) {
        // 传 emotion 当前状态：emotion 还开着就要补「2.5 情绪回应」小标题，
        // 否则情绪那两条会变成没有标题的裸列表。
        out = cutAll(out, styleSections(toggles.emotion));
    }
    for (const key of ['emotion', 'listening', 'self', 'antiFiller'] as const) {
        if (toggles[key]) continue;
        out = cutAll(out, RP_SECTION_RULES[key]);
    }
    return out;
}

/**
 * 裁掉内置思考引导那篇（utils/thinkingChainPrompt.ts 的输出）。
 *
 * 这篇的边界比五块规范稳：它被一对 `═══` 分隔线整篇包起来，
 * 开头第一行里有 `【以下规则仅适用于 THINKING 阶段】`，
 * 末尾倒数第二段是 `【THINKING 规则结束】`，最后再一条 `═══` 收尾。
 * 所以按「开头标记往前退到它上面那条分隔线，结尾标记往后推到最后一条分隔线」定位。
 *
 * 用户自己写的追加提示词由各调用方在这篇之后单独拼接，不在裁剪范围内——
 * 这正是「只用我自己写的引导」这个用法要的效果。
 */
export function stripThinkingChainPrompt(prompt: string, enabled: boolean): string {
    if (enabled || !prompt) return prompt;

    const HEAD = '【以下规则仅适用于 THINKING 阶段】';
    const TAIL = '【THINKING 规则结束】';
    const BAR = '═══';

    const headAt = prompt.indexOf(HEAD);
    const tailAt = prompt.indexOf(TAIL);
    if (headAt < 0 || tailAt < 0 || tailAt < headAt) {
        console.warn(
            '[promptToggles] 找不到内置思考引导的首尾标记，这篇没裁掉。'
            + '可能是上游改写了 utils/thinkingChainPrompt.ts 的框架文案。'
            + '请更新 utils/promptToggles/rpPromptFilter.ts 里的标记。',
        );
        return prompt;
    }

    // 左边界：开头标记上面那条 ═══ 分隔线的行首。找不到就从标记本身切。
    const barBefore = prompt.lastIndexOf(BAR, headAt);
    let from = headAt;
    if (barBefore >= 0) {
        const lineStart = prompt.lastIndexOf('\n', barBefore);
        from = lineStart < 0 ? 0 : lineStart;
    }

    // 右边界：结尾标记之后最后一条 ═══ 分隔线的行尾。
    const barAfter = prompt.indexOf(BAR, tailAt);
    let to: number;
    if (barAfter >= 0) {
        const lineEnd = prompt.indexOf('\n', barAfter);
        to = lineEnd < 0 ? prompt.length : lineEnd;
    } else {
        const blank = prompt.indexOf('\n\n', tailAt);
        to = blank < 0 ? prompt.length : blank;
    }

    return prompt.slice(0, from) + prompt.slice(to);
}