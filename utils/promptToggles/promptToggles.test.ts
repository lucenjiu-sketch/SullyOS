/**
 * 提示词开关（插件式重构版）的行为测试。
 *
 * 关注三件事：
 * 1. 默认全开时提示词与上游完全一致（一个字符都不少）
 * 2. 关掉某个开关时，确实只少了那一段，功能协议完好
 * 3. 锚点失配时不裁、报警（安全底线）
 */
import { describe, it, expect, vi } from 'vitest';
import {
    applyRpPromptToggles,
    stripThinkingChainPrompt,
    applyPromptToggles,
    resolveRpPromptToggles,
    stripPromptToggleFields,
    RP_TOGGLE_FIELDS,
} from './index';
import { buildThinkingChainPrompt } from '../thinkingChainPrompt';
import { buildCharacterResponsePrinciples } from '../characterResponsePrinciples';

/** 真实提示词片段：聊天 App 行为规范里受开关影响的那一段 + 后面的功能协议。 */
const CHAT_RULES = `### 聊天 App 行为规范 (Chat App Rules)
**TOP 1｜ChatApp 格式（本节最高优先级）**：你是发消息的真实存在，以自然短句、短气泡为主。
1. **沉浸感**: 保持角色扮演。使用适合即时通讯(IM)的口语化风格。
2. **行为模式**: 不要总是围绕用户转。分享你自己的生活、想法或随意的观察。
2.5 **对话质量 (极其重要)**:
   - **拒绝空话**: 不要说”我会一直在”这类万能安慰句。
   - **允许长句**: 在情绪强烈时可以发长消息。
   - **情绪感知要先于对方的表达**: 不要等对方说”我难过”才回应。
   - **当ta真的在害怕时（健康、安全、重大变故——不是玩闹逗你）：先稳，再问清楚，最后才安抚**。
3. **格式要求**:
   - 每行渲染为一个气泡；空格和标点不会拆泡。
   - **发送表情包**: 必须且只能使用命令: \`[[SEND_EMOJI: 表情名称]]\`。
4. **引用功能 (Quote/Reply)**:
   - \`[[QUOTE: 引用内容]]\`
6. **可用动作**:
   - 转账: \`[[ACTION:TRANSFER|to=user|amount=100]]\``;

const ANTI_FILLER = `### 表达底线 (Anti-Filler)\n当你觉得"没什么可说"的时候，不要用空泛的感慨、万能句式或华丽排比去填充。\n\n`;

const PRINCIPLES = buildCharacterResponsePrinciples('小夏', '久');

/** 功能协议标记：任何开关组合下都必须保留。 */
const PROTOCOL_MARKERS = [
    '[[SEND_EMOJI:',
    '[[QUOTE:',
    '[[ACTION:TRANSFER',
    '3. **格式要求**:',
    '每行渲染为一个气泡',
    'TOP 1｜ChatApp 格式',
];

const ALL_ON = { style: true, emotion: true, listening: true, self: true, antiFiller: true };

describe('applyRpPromptToggles', () => {
    const full = `${CHAT_RULES}\n\n${ANTI_FILLER}${PRINCIPLES}`;

    it('默认全开 → 原文一字不改', () => {
        expect(applyRpPromptToggles(full, ALL_ON)).toBe(full);
    });

    it('关 style → 只少风格那几条，情绪两条与功能协议都留着', () => {
        const out = applyRpPromptToggles(full, { ...ALL_ON, style: false });
        expect(out).not.toContain('**沉浸感**');
        expect(out).not.toContain('**行为模式**');
        expect(out).not.toContain('**拒绝空话**');
        // emotion 归 emotion 开关管，不该被 style 带走
        expect(out).toContain('情绪感知要先于对方的表达');
        expect(out).toContain('当ta真的在害怕时');
        for (const m of PROTOCOL_MARKERS) expect(out).toContain(m);
    });

    it('关 emotion → 只少情绪两条，风格那几条留着', () => {
        const out = applyRpPromptToggles(full, { ...ALL_ON, emotion: false });
        expect(out).not.toContain('情绪感知要先于对方的表达');
        expect(out).not.toContain('当ta真的在害怕时');
        expect(out).toContain('**沉浸感**');
        expect(out).toContain('**拒绝空话**');
        for (const m of PROTOCOL_MARKERS) expect(out).toContain(m);
    });

    it('关 listening → 只少「关于对方的表达」，「回到你自己」留着', () => {
        const out = applyRpPromptToggles(full, { ...ALL_ON, listening: false });
        expect(out).not.toContain('### 关于对方的表达');
        expect(out).toContain('### 最后，回到你自己');
    });

    it('关 self → 只少「回到你自己」，「关于对方的表达」留着', () => {
        const out = applyRpPromptToggles(full, { ...ALL_ON, self: false });
        expect(out).not.toContain('### 最后，回到你自己');
        expect(out).toContain('### 关于对方的表达');
    });

    it('关 antiFiller → 只少「表达底线」', () => {
        const out = applyRpPromptToggles(full, { ...ALL_ON, antiFiller: false });
        expect(out).not.toContain('### 表达底线');
        expect(out).toContain('### 关于对方的表达');
    });

    it('style + emotion 同时关 → 两块都没了，功能协议仍完整', () => {
        const out = applyRpPromptToggles(full, { ...ALL_ON, style: false, emotion: false });
        expect(out).not.toContain('**沉浸感**');
        expect(out).not.toContain('情绪感知要先于对方的表达');
        for (const m of PROTOCOL_MARKERS) expect(out).toContain(m);
    });

    it('五个全关 → 风格类全没，功能协议一个不少', () => {
        const out = applyRpPromptToggles(full, {
            style: false, emotion: false, listening: false, self: false, antiFiller: false,
        });
        for (const gone of [
            '**沉浸感**', '情绪感知要先于对方的表达', '### 关于对方的表达',
            '### 最后，回到你自己', '### 表达底线',
        ]) expect(out).not.toContain(gone);
        for (const m of PROTOCOL_MARKERS) expect(out).toContain(m);
    });

    it('锚点失配 → 不裁、报警（宁可开关失效也不切坏功能协议）', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const rewritten = '### 聊天规范\n1. 作者把这段完全改写了。\n3. **格式要求**:\n   - 气泡';
        const out = applyRpPromptToggles(rewritten, { ...ALL_ON, style: false });
        expect(out).toBe(rewritten);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('stripThinkingChainPrompt', () => {
    const builtin = buildThinkingChainPrompt('小夏', '久');
    const custom = '## 用户对内心独白的额外要求\n思考时偶尔切到日语';
    const full = `前面的系统提示词。\n\n${builtin}\n\n${custom}`;

    it('开启 → 原文不变', () => {
        expect(stripThinkingChainPrompt(full, true)).toBe(full);
    });

    it('关闭 → 内置那篇整篇消失，用户自己写的照常保留', () => {
        const out = stripThinkingChainPrompt(full, false);
        expect(out).not.toContain('【以下规则仅适用于 THINKING 阶段】');
        expect(out).not.toContain('【THINKING 规则结束】');
        expect(out).not.toContain('这个任务里全部作废');
        expect(out).toContain('思考时偶尔切到日语');
        expect(out).toContain('前面的系统提示词。');
    });

    it('关闭且没有内置那篇 → 不报错，原样返回', () => {
        const onlyCustom = `前面。\n\n${custom}`;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(stripThinkingChainPrompt(onlyCustom, false)).toBe(onlyCustom);
        warn.mockRestore();
    });
});

describe('applyPromptToggles（出口总入口）', () => {
    const full = `${CHAT_RULES}\n\n${ANTI_FILLER}${buildThinkingChainPrompt('小夏', '久')}\n\n${PRINCIPLES}`;

    it('旧角色数据（六个字段都没有）→ 行为与上游完全一致', () => {
        expect(applyPromptToggles(full, { name: '小夏' } as any)).toBe(full);
    });

    it('char 为空 → 原样返回，不炸', () => {
        expect(applyPromptToggles(full, null)).toBe(full);
        expect(applyPromptToggles(full, undefined)).toBe(full);
    });

    it('六个一起关 → 风格类与内置引导全消失，功能协议完好', () => {
        const out = applyPromptToggles(full, {
            rpStyleEnabled: false, rpEmotionEnabled: false, rpListeningEnabled: false,
            rpSelfEnabled: false, rpAntiFillerEnabled: false, thinkingChainPromptEnabled: false,
        } as any);
        for (const gone of [
            '**沉浸感**', '情绪感知要先于对方的表达', '### 关于对方的表达',
            '### 最后，回到你自己', '### 表达底线', '【以下规则仅适用于 THINKING 阶段】',
        ]) expect(out).not.toContain(gone);
        for (const m of PROTOCOL_MARKERS) expect(out).toContain(m);
    });
});

describe('字段层', () => {
    it('声明合并后字段可读，缺失即视为开启', () => {
        expect(resolveRpPromptToggles({})).toEqual(ALL_ON);
        expect(resolveRpPromptToggles({ rpStyleEnabled: false } as any))
            .toEqual({ ...ALL_ON, style: false });
    });

    it('RP_TOGGLE_FIELDS 映射与 resolve 读的字段名一致', () => {
        for (const [key, field] of Object.entries(RP_TOGGLE_FIELDS)) {
            const toggles = resolveRpPromptToggles({ [field]: false } as any);
            expect(toggles[key as keyof typeof toggles]).toBe(false);
        }
    });

    it('分享角色卡剥掉六个字段，且不改入参', () => {
        const card = {
            name: '小夏',
            rpStyleEnabled: false, rpEmotionEnabled: false, rpListeningEnabled: false,
            rpSelfEnabled: false, rpAntiFillerEnabled: false, thinkingChainPromptEnabled: false,
        };
        const out = stripPromptToggleFields(card);
        expect(out).toEqual({ name: '小夏' });
        // 接收方拿到的是默认全开
        expect(resolveRpPromptToggles(out as any)).toEqual(ALL_ON);
        // 原对象不动（整机备份照常保留这六个字段）
        expect(card.rpStyleEnabled).toBe(false);
    });
});