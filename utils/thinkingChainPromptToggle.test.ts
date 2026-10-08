import { describe, it, expect } from 'vitest';
import { buildChatRequestPayload } from './chatRequestPayload';
import type { BuildChatPayloadInput } from './chatRequestPayload';
import type { CharacterProfile } from '../types';

// 内置思考引导（utils/thinkingChainPrompt.ts）的开关。关掉只少这一篇：
// reasoning 抓取、心象卡片、以及用户自己写的追加提示词都照常。
// 同一篇引导另有两处装配 —— 语音通话（apps/CallApp.tsx）与协同窗口
// （features/collaboration/context.ts），判定条件与此处一致，但都不走这条可测管线。

const BUILTIN_MARKER = '【以下规则仅适用于 THINKING 阶段】';
const userProfile = { name: '小明' } as any;

const payloadFor = async (charPatch: Partial<CharacterProfile>, customPrompt?: string) => {
    const input: BuildChatPayloadInput = {
        char: { id: 'c1', name: '阿一', showThinkingChain: true, ...charPatch } as any,
        userProfile,
        groups: [], emojis: [], categories: [],
        historyMsgs: [
            { id: 1, charId: 'c1', role: 'user', type: 'text', content: '在吗', timestamp: Date.now() },
        ] as any[],
        contextLimit: 20,
        thinkingChain: { enabled: true, customPrompt },
    };
    const out = await buildChatRequestPayload(input);
    return out.systemPrompt;
};

describe('聊天：内置思考引导开关', () => {
    it('字段缺失（旧角色数据）→ 照常注入，行为不变', async () => {
        expect(await payloadFor({})).toContain(BUILTIN_MARKER);
    });

    it('显式关闭 → 引导消失', async () => {
        expect(await payloadFor({ thinkingChainPromptEnabled: false })).not.toContain(BUILTIN_MARKER);
    });

    it('关闭引导后，用户自己写的追加要求照常发送', async () => {
        const p = await payloadFor({ thinkingChainPromptEnabled: false }, '思考时偶尔切到日语');
        expect(p).not.toContain(BUILTIN_MARKER);
        expect(p).toContain('用户对内心独白的额外要求');
        expect(p).toContain('思考时偶尔切到日语');
    });

    it('默认状态下引导在前、追加要求在后', async () => {
        const p = await payloadFor({}, '多写感官细节');
        expect(p.indexOf(BUILTIN_MARKER)).toBeGreaterThan(-1);
        expect(p.indexOf(BUILTIN_MARKER)).toBeLessThan(p.indexOf('多写感官细节'));
    });

    it('思考链总开关关着时，子开关不产生任何注入', async () => {
        const input: BuildChatPayloadInput = {
            char: { id: 'c1', name: '阿一', showThinkingChain: false } as any,
            userProfile, groups: [], emojis: [], categories: [],
            historyMsgs: [], contextLimit: 20,
            thinkingChain: { enabled: false },
        };
        const out = await buildChatRequestPayload(input);
        expect(out.systemPrompt).not.toContain(BUILTIN_MARKER);
    });
});