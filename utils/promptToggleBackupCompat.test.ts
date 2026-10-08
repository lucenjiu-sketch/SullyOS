import { describe, it, expect } from 'vitest';
import { BACKUP_FORMAT_VERSION, SUPPORTED_IMPORT_FORMAT_VERSIONS } from './backupFormat';
import { resolveRpPromptToggles } from './rpPromptToggles';
import { stripSensitiveCardFields } from './characterCard';
import type { CharacterProfile } from '../types';

// 本次改动新增 6 个角色级可选字段（rp* 五个 + thinkingChainPromptEnabled）。
// 这里固定住「旧备份导入后行为不变」这条契约，防止以后有人把默认值反过来写。

describe('备份互通性', () => {
    it('备份格式版本号未被改动', () => {
        expect(BACKUP_FORMAT_VERSION).toBe(3);
        expect(SUPPORTED_IMPORT_FORMAT_VERSIONS).toContain(2);
        expect(SUPPORTED_IMPORT_FORMAT_VERSIONS).toContain(3);
    });

    it('旧备份里的角色（6 个字段全缺）→ 新开关一律视为开启，行为与改动前一致', () => {
        // 模拟从旧版备份 JSON 反序列化出来的角色：这些字段当时还不存在
        const legacy = JSON.parse(JSON.stringify({
            id: 'legacy-1', name: '旧角色', avatar: '', systemPrompt: '人设',
            showThinkingChain: true, chatVoiceEnabled: false,
        })) as CharacterProfile;

        expect(resolveRpPromptToggles(legacy)).toEqual({
            style: true, emotion: true, listening: true, self: true, antiFiller: true,
        });
        // 内置思考引导同样按「缺失即开」判定（与三处装配点的条件一致）
        expect(legacy.thinkingChainPromptEnabled !== false).toBe(true);
    });

    it('新版导出的角色带着开关值往返后不丢', () => {
        const saved = {
            id: 'c1', name: '新角色', avatar: '', systemPrompt: '人设',
            rpStyleEnabled: false, rpEmotionEnabled: true, rpListeningEnabled: false,
            rpSelfEnabled: true, rpAntiFillerEnabled: false,
            thinkingChainPromptEnabled: false,
        } as CharacterProfile;

        const roundTripped = JSON.parse(JSON.stringify(saved)) as CharacterProfile;
        expect(resolveRpPromptToggles(roundTripped)).toEqual({
            style: false, emotion: true, listening: false, self: true, antiFiller: false,
        });
        expect(roundTripped.thinkingChainPromptEnabled).toBe(false);
    });

    it('角色卡分享会剥离这 6 个本机偏好 → 接收方拿到的是默认全开', () => {
        const shared = stripSensitiveCardFields({
            id: 'c1', name: '发出去的角色', avatar: '', systemPrompt: '人设',
            rpStyleEnabled: false, rpEmotionEnabled: false, rpListeningEnabled: false,
            rpSelfEnabled: false, rpAntiFillerEnabled: false,
            thinkingChainPromptEnabled: false,
        } as CharacterProfile) as Partial<CharacterProfile>;

        for (const key of [
            'rpStyleEnabled', 'rpEmotionEnabled', 'rpListeningEnabled',
            'rpSelfEnabled', 'rpAntiFillerEnabled', 'thinkingChainPromptEnabled',
        ] as const) {
            expect(shared, `${key} 不该随角色卡分享`).not.toHaveProperty(key);
        }
        // 人设本体照常保留
        expect(shared.systemPrompt).toBe('人设');
        expect(resolveRpPromptToggles(shared)).toEqual({
            style: true, emotion: true, listening: true, self: true, antiFiller: true,
        });
    });
});