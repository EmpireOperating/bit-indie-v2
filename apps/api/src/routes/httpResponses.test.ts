import { describe, expect, it } from 'vitest';
import { fail, ok } from './httpResponses.js';

describe('httpResponses', () => {
  it('ok wraps payload with ok:true', () => {
    expect(ok({ id: 'x' })).toEqual({ ok: true, id: 'x' });
  });

  it('fail wraps message with ok:false and optional payload', () => {
    expect(fail('Bad input')).toEqual({ ok: false, error: 'Bad input' });
    expect(fail('Bad input', { issues: ['x'] })).toEqual({
      ok: false,
      error: 'Bad input',
      issues: ['x'],
    });
  });
});
