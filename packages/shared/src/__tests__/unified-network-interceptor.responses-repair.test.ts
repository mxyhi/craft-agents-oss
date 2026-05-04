import { beforeAll, describe, expect, it } from 'bun:test';

let repairResponsesHistoryInPlace: typeof import('../unified-network-interceptor.ts').repairResponsesHistoryInPlace;
let validateOpenAiResponsesBody: typeof import('../unified-network-interceptor.ts').validateOpenAiResponsesBody;

describe('unified-network-interceptor responses-history repair (#613)', () => {
  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    const mod = await import('../unified-network-interceptor.ts');
    repairResponsesHistoryInPlace = mod.repairResponsesHistoryInPlace;
    validateOpenAiResponsesBody = mod.validateOpenAiResponsesBody;
  });

  it('normalizes Codex-style call ids instead of synthesizing repaired ids', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', id: 'call_1', name: 'ls', arguments: '{"path":"/tmp"}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'real' },
      { type: 'message', role: 'assistant', call_id: 'call_noise', content: [] },
    ];
    const result = repairResponsesHistoryInPlace(input, { store: false });
    expect(result.normalizedCallIds).toBe(3);
    expect(result.droppedOrphans).toBe(0);
    expect(input).toEqual([
      { type: 'function_call', name: 'ls', arguments: '{"path":"/tmp"}', call_id: 'fc1' },
      { type: 'function_call_output', call_id: 'fc1', output: 'real' },
      { type: 'message', role: 'assistant', content: [] },
    ]);
  });

  it('drops function_call_output entries that reference unknown call_ids', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', call_id: 'call_1', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_ghost', output: 'orphan' },
      { type: 'function_call_output', call_id: 'call_1', output: 'real' },
    ];
    const result = repairResponsesHistoryInPlace(input, { store: false });
    expect(result.normalizedCallIds).toBe(3);
    expect(result.droppedOrphans).toBe(1);
    expect(input.length).toBe(2);
    expect(input).toEqual([
      { type: 'function_call', call_id: 'fc1', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'fc1', output: 'real' },
    ]);
  });

  it('does not invent call ids when no source id exists', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'ls', arguments: '{}' },
    ];
    const result = repairResponsesHistoryInPlace(input);
    expect(result.normalizedCallIds).toBe(0);
    expect(input.length).toBe(1);
    expect(input[0]!.call_id).toBeUndefined();
    expect(() => validateOpenAiResponsesBody({ input })).toThrow('missing call_id');
  });

  it('is a no-op when history is already well-formed', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', call_id: 'fc1', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'fc1', output: 'a' },
    ];
    const result = repairResponsesHistoryInPlace(input);
    expect(result.normalizedCallIds).toBe(0);
    expect(result.droppedOrphans).toBe(0);
    expect(input.length).toBe(2);
  });

  it('drops non-persisted reasoning item ids under store false', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'message', id: 'msg_1', role: 'assistant', content: [] },
      { type: 'reasoning', id: 'rs_069e3541260626fa0169f863d79378819bb3cbcaeef937d57c' },
      { type: 'item_reference', id: 'rs_reference_from_non_persisted_reasoning' },
      { type: 'function_call', call_id: 'call_1', name: 'ls', arguments: '{}' },
    ];
    const result = repairResponsesHistoryInPlace(input, { store: false });
    expect(result.droppedReasoningItems).toBe(1);
    expect(result.droppedReasoningReferences).toBe(1);
    expect(input).toEqual([
      { type: 'message', role: 'assistant', content: [] },
      { type: 'function_call', call_id: 'fc1', name: 'ls', arguments: '{}' },
    ]);
  });

  it('produces a body that passes validation after repair (end-to-end)', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', id: 'call_1', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'done' },
    ];
    repairResponsesHistoryInPlace(input, { store: false });
    expect(() => validateOpenAiResponsesBody({ input })).not.toThrow();
  });
});
