function withEnvelopeFlag<T extends Record<string, unknown>, TFlag extends boolean>(
  ok: TFlag,
  payload: T,
): { ok: TFlag } & T {
  return { ok, ...payload };
}

export function ok<T extends Record<string, unknown>>(payload: T): { ok: true } & T {
  return withEnvelopeFlag(true, payload);
}

export function fail<T extends Record<string, unknown> = Record<string, never>>(
  error: string,
  payload?: T,
): { ok: false; error: string } & T {
  return withEnvelopeFlag(false, { error, ...(payload ?? ({} as T)) });
}
