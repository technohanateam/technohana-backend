import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  // A regular function (not an arrow function - arrow functions can never be
  // constructed via `new`) that explicitly returns the fake client object.
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: mockCreate } };
  }),
}));

// Imported after the mock so ai.service.ts's `new Anthropic(...)` picks up the mock.
const { completeText, completeJson } = await import('../../../src/services/ai.service.js');

describe('ai.service', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('completeText concatenates only text content blocks', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 'x', name: 'noop', input: {} },
        { type: 'text', text: 'world' },
      ],
    });

    const result = await completeText({ system: 'sys', prompt: 'prompt' });
    expect(result).toBe('Hello\nworld');
  });

  it('completeJson parses a clean JSON response', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"a": 1, "b": "two"}' }] });
    await expect(completeJson({ system: 'sys', prompt: 'prompt' })).resolves.toEqual({ a: 1, b: 'two' });
  });

  it('completeJson strips markdown fences and surrounding commentary', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Sure, here you go:\n```json\n{"headline": "Great deal"}\n```\nHope that helps!' }],
    });
    await expect(completeJson({ system: 'sys', prompt: 'prompt' })).resolves.toEqual({ headline: 'Great deal' });
  });

  it('completeJson repairs a literal raw newline inside a JSON string value', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"summary": "Line one\nLine two", "score": 72}' }],
    });
    await expect(completeJson({ system: 'sys', prompt: 'prompt' })).resolves.toEqual({
      summary: 'Line one\nLine two',
      score: 72,
    });
  });

  it('completeJson preserves already-valid escape sequences untouched', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"note": "Tab\\there and quote \\" done"}' }],
    });
    await expect(completeJson({ system: 'sys', prompt: 'prompt' })).resolves.toEqual({
      note: 'Tab\there and quote " done',
    });
  });

  it('completeJson throws a clear error when no JSON object is present', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'no json here' }] });
    await expect(completeJson({ system: 'sys', prompt: 'prompt' })).rejects.toThrow(/No JSON object found/);
  });
});
