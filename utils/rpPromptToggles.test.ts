import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import type { CharacterProfile, UserProfile } from '../types';

const user = { name: '久', bio: '' } as UserProfile;
const baseChar = { id: 'c1', name: '陆珂', systemPrompt: '测试人设' } as CharacterProfile;

const build = (overrides: Partial<CharacterProfile>) =>
    ChatPrompts.buildSystemPrompt(
        { ...baseChar, ...overrides } as CharacterProfile,
        user, [], [], [], [],
    );

// 关掉任何开关都不能动到这些：前端要靠它们解析标签 / 渲染气泡。
const PROTOCOL_MARKERS = [
    'ChatApp 格式（本节最高优先级）',
    '[[SEND_EMOJI:',
    '[[QUOTE:',
    '[[ACTION:POKE]]',
    '[[RECALL:',
    '每行渲染为一个气泡',
];

describe('角色扮演规范五开关', () => {
    it('默认（字段全缺）注入五块全部内容', async () => {
        const p = await build({});
        expect(p).toContain('保持角色扮演');          // style
        expect(p).toContain('用细节代替概括');        // style
        expect(p).toContain('情绪感知要先于对方的表达'); // emotion
        expect(p).toContain('关于对方的表达');        // listening
        expect(p).toContain('最后，回到你自己');      // self
        expect(p).toContain('表达底线 (Anti-Filler)'); // antiFiller
    });

    it('五块各自独立：关一块只少那一块', async () => {
        const cases: [Partial<CharacterProfile>, string, string[]][] = [
            [{ rpStyleEnabled: false }, '用细节代替概括',
                ['情绪感知要先于对方的表达', '关于对方的表达', '最后，回到你自己', '表达底线 (Anti-Filler)']],
            [{ rpEmotionEnabled: false }, '情绪感知要先于对方的表达',
                ['用细节代替概括', '关于对方的表达', '最后，回到你自己', '表达底线 (Anti-Filler)']],
            [{ rpListeningEnabled: false }, '关于对方的表达',
                ['用细节代替概括', '情绪感知要先于对方的表达', '最后，回到你自己', '表达底线 (Anti-Filler)']],
            [{ rpSelfEnabled: false }, '最后，回到你自己',
                ['用细节代替概括', '情绪感知要先于对方的表达', '关于对方的表达', '表达底线 (Anti-Filler)']],
            [{ rpAntiFillerEnabled: false }, '表达底线 (Anti-Filler)',
                ['用细节代替概括', '情绪感知要先于对方的表达', '关于对方的表达', '最后，回到你自己']],
        ];
        for (const [overrides, gone, kept] of cases) {
            const p = await build(overrides);
            expect(p, `${JSON.stringify(overrides)} 应移除「${gone}」`).not.toContain(gone);
            for (const k of kept) {
                expect(p, `${JSON.stringify(overrides)} 不该影响「${k}」`).toContain(k);
            }
        }
    });

    it('五块全关后功能协议完整保留', async () => {
        const p = await build({
            rpStyleEnabled: false, rpEmotionEnabled: false, rpListeningEnabled: false,
            rpSelfEnabled: false, rpAntiFillerEnabled: false,
        });
        for (const marker of PROTOCOL_MARKERS) {
            expect(p, `全关后仍须保留：${marker}`).toContain(marker);
        }
        expect(p).toContain('你的身份 (Character)');
        expect(p).toContain('测试人设');
    });

    it('style 关、emotion 开时情绪条目仍有自己的小标题', async () => {
        const p = await build({ rpStyleEnabled: false });
        expect(p).toContain('2.5 **情绪回应**');
        expect(p).not.toContain('对话质量 (极其重要)');
    });
});