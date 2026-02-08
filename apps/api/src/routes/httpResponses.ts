export function ok<T extends Record<string, unknown>>(payload: T): { ok: true } & T {
  return { ok: true, ...payload };
}

export function fail<T extends Record<string, unknown> = Record<string, never>>(
  error: string,
  payload?: T,
): { ok: false; error: string } & T {
  return { ok: false, error, ...(payload ?? ({} as T)) };
}
