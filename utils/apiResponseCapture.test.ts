import { describe, it, expect } from 'vitest';
import { buildApiResponseCapture } from './apiCallLog';

/**
 * 响应原文抓包。
 *
 * 这个功能存在的理由就是「看不到模型实际回了什么」，所以测试重点在于：
 * 原文必须原样保留，而解析失败时不能把原文一起丢掉。
 */
describe('buildApiResponseCapture', () => {
    it('parses a whole-package JSON response', () => {
        const raw = JSON.stringify({
            model: 'backend-model-v2',
            usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 },
            choices: [{
                message: { role: 'assistant', content: '我在。', reasoning_content: '先确认她在问什么。' },
                finish_reason: 'stop',
            }],
        });

        const capture = buildApiResponseCapture({ rawText: raw, ok: true, status: 200, durationMs: 1500 });

        expect(capture.shape).toBe('json');
        expect(capture.content).toBe('我在。');
        expect(capture.contentChars).toBe(3);
        expect(capture.reasoning).toBe('先确认她在问什么。');
        expect(capture.backendModel).toBe('backend-model-v2');
        expect(capture.finishReason).toBe('stop');
        expect(capture.usage).toEqual({ prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 });
        expect(capture.durationMs).toBe(1500);
        expect(capture.rawText).toBe(raw);
    });

    it('reassembles SSE deltas in order and records which delta fields appeared', () => {
        const raw = [
            'data: {"model":"sse-model","choices":[{"delta":{"role":"assistant","reasoning_content":"想一下"}}]}',
            'data: {"choices":[{"delta":{"content":"第一段"}}]}',
            'data: {"choices":[{"delta":{"content":"第二段"},"finish_reason":"stop"}]}',
            'data: {"usage":{"prompt_tokens":10,"completion_tokens":6,"total_tokens":16},"choices":[]}',
            'data: [DONE]',
        ].join('\n');

        const capture = buildApiResponseCapture({ rawText: raw, ok: true, status: 200 });

        expect(capture.shape).toBe('sse');
        expect(capture.content).toBe('第一段第二段');
        expect(capture.reasoning).toBe('想一下');
        expect(capture.backendModel).toBe('sse-model');
        expect(capture.finishReason).toBe('stop');
        expect(capture.usage).toEqual({ prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 });
        expect(capture.deltaKeys).toContain('reasoning_content');
        expect(capture.deltaKeys).toContain('content');
    });

    it('collects tool call names from streamed fragments', () => {
        const raw = [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_calendar","arguments":"{\\"d"}}]}}]}',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ay\\":1}"}}]},"finish_reason":"tool_calls"}]}',
        ].join('\n');

        const capture = buildApiResponseCapture({ rawText: raw, ok: true, status: 200 });

        expect(capture.toolCallNames).toEqual(['read_calendar']);
        expect(capture.finishReason).toBe('tool_calls');
    });

    it('picks up reasoning from the Anthropic block-array dialect', () => {
        const raw = JSON.stringify({
            choices: [{
                message: {
                    content: [
                        { type: 'thinking', thinking: '她刚说了两句。' },
                        { type: 'text', text: '嗯，我听着。' },
                    ],
                },
            }],
        });

        const capture = buildApiResponseCapture({ rawText: raw, ok: true, status: 200 });

        expect(capture.content).toBe('嗯，我听着。');
        expect(capture.reasoning).toBe('她刚说了两句。');
    });

    it('flags an empty reply so a blank content field is visible at a glance', () => {
        const raw = JSON.stringify({
            choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
        });

        const capture = buildApiResponseCapture({ rawText: raw, ok: true, status: 200 });

        expect(capture.contentChars).toBe(0);
        expect(capture.reasoningChars).toBe(0);
    });

    it('keeps the raw text when the body is neither JSON nor SSE', () => {
        const raw = '<html><body>502 Bad Gateway</body></html>';

        const capture = buildApiResponseCapture({ rawText: raw, ok: false, status: 502 });

        expect(capture.shape).toBe('other');
        expect(capture.rawText).toBe(raw);
        expect(capture.ok).toBe(false);
        expect(capture.status).toBe(502);
    });

    it('keeps the raw text even when JSON parsing throws', () => {
        const raw = '{"choices":[{"message":{"content":"截断了';

        const capture = buildApiResponseCapture({ rawText: raw, ok: true, status: 200 });

        expect(capture.rawText).toBe(raw);
        expect(capture.content).toBe('');
    });

    it('truncates oversized bodies but reports the real length', () => {
        const raw = 'x'.repeat(250_000);

        const capture = buildApiResponseCapture({ rawText: raw, ok: true, status: 200 });

        expect(capture.truncated).toBe(true);
        expect(capture.rawChars).toBe(250_000);
        expect(capture.rawText.length).toBeLessThan(250_000);
    });
});
