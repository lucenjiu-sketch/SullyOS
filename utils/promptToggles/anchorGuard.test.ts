/**
 * 锚点自检 —— 同步上游之后跑这个。
 *
 * 为什么需要它：六个开关靠「认出作者写的提示词原文」来定位要裁掉的段落
 * （见 rpPromptSections.ts）。作者要是改写了那几段话，锚点就对不上，
 * 开关会静默失灵 —— 不会报错、不会坏功能，只是关了没反应。
 *
 * 这个测试把「锚点必须能在源码里找到」钉成一条契约：
 * 合并上游后 vitest 一跑，锚点失配会直接变成测试失败，在推给用户之前就暴露。
 *
 * 失败了怎么办：按报错里的文件和锚点，去原文里找作者改成了什么，
 * 更新 rpPromptSections.ts 里对应的 start / end 字符串即可。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RP_SECTION_RULES, styleSections } from './rpPromptSections';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf8');

/** 每个开关的锚点分别该出现在哪个源文件里。 */
const ANCHOR_SOURCES: Record<string, string[]> = {
    style: ['utils/chatPrompts.ts'],
    emotion: ['utils/chatPrompts.ts'],
    listening: ['utils/characterResponsePrinciples.ts'],
    self: ['utils/characterResponsePrinciples.ts'],
    antiFiller: ['utils/context.ts'],
};

describe('提示词开关锚点自检（同步上游后必跑）', () => {
    for (const [key, files] of Object.entries(ANCHOR_SOURCES)) {
        const rules = key === 'style'
            ? styleSections(true)
            : RP_SECTION_RULES[key as keyof typeof RP_SECTION_RULES];

        it(`${key}：锚点仍能在上游原文里定位`, () => {
            const sources = files.map(read);
            const hit = (needle: string) => sources.some(s => s.includes(needle));

            for (const rule of rules) {
                expect(
                    hit(rule.start),
                    `[${rule.id}] 起点锚点在 ${files.join(' / ')} 里找不到了。\n`
                    + `  锚点：${JSON.stringify(rule.start)}\n`
                    + `  很可能是上游改写了这段提示词。请去原文里对照，更新 rpPromptSections.ts。`,
                ).toBe(true);

                if (rule.end) {
                    expect(
                        hit(rule.end),
                        `[${rule.id}] 终点锚点在 ${files.join(' / ')} 里找不到了。\n`
                        + `  锚点：${JSON.stringify(rule.end)}\n`
                        + `  请去原文里对照，更新 rpPromptSections.ts。`,
                    ).toBe(true);
                }
            }
        });
    }

    it('内置思考引导的首尾标记仍在', () => {
        const src = read('utils/thinkingChainPrompt.ts');
        for (const marker of ['【以下规则仅适用于 THINKING 阶段】', '【THINKING 规则结束】', '═══']) {
            expect(
                src.includes(marker),
                `思考引导标记 ${JSON.stringify(marker)} 在 utils/thinkingChainPrompt.ts 里找不到了。\n`
                + `  请更新 rpPromptFilter.ts 的 stripThinkingChainPrompt。`,
            ).toBe(true);
        }
    });

    it('六个开关字段没有被写进上游文件（保持零侵入）', () => {
        // 这条守的是重构的初衷：一旦有人图省事又把字段塞回 types.ts
        // 或 characterCard.ts，同步上游就会重新开始冲突。
        const guarded = ['types.ts', 'utils/characterCard.ts', 'utils/chatPrompts.ts', 'utils/context.ts'];
        for (const rel of guarded) {
            const src = read(rel);
            for (const field of [
                'rpStyleEnabled', 'rpEmotionEnabled', 'rpListeningEnabled',
                'rpSelfEnabled', 'rpAntiFillerEnabled', 'thinkingChainPromptEnabled',
            ]) {
                expect(
                    src.includes(field),
                    `${rel} 里出现了 ${field}。\n`
                    + `  这六个字段应该只存在于 utils/promptToggles/ 内，`
                    + `写进上游文件会让同步更新重新冲突。`,
                ).toBe(false);
            }
        }
    });
});