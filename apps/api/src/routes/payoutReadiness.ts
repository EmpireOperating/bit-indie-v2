import type { FastifyInstance } from 'fastify';

import { ok } from './httpResponses.js';

function isHttpProtocol(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function parseUrl(value: string): { ok: boolean; reason?: string } {
  if (!value) return { ok: false, reason: 'missing' };
  try {
    const url = new URL(value);
    if (!isHttpProtocol(url)) {
      return { ok: false, reason: 'invalid_protocol' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
}

function urlCheck(value: string, parsed: { ok: boolean }) {
  return {
    configured: Boolean(value),
    valid: parsed.ok,
    value: value || null,
  };
}

export async function registerPayoutReadinessRoutes(app: FastifyInstance) {
  app.get('/ops/payouts/readiness', async () => {
    const apiKey = (process.env.OPENNODE_API_KEY ?? '').trim();
    const callbackUrl = (process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL ?? '').trim();
    const baseUrl = (process.env.OPENNODE_BASE_URL ?? '').trim();

    const callback = parseUrl(callbackUrl);
    const base = baseUrl ? parseUrl(baseUrl) : { ok: true as const };
    const reasons: string[] = [];

    if (!apiKey) reasons.push('OPENNODE_API_KEY missing');
    if (!callback.ok) reasons.push(`OPENNODE_WITHDRAWAL_CALLBACK_URL ${callback.reason}`);
    if (!base.ok) reasons.push(`OPENNODE_BASE_URL ${base.reason}`);

    return ok({
      payoutReady: reasons.length === 0,
      providerMode: apiKey ? 'opennode' : 'mock',
      checks: {
        hasOpenNodeApiKey: Boolean(apiKey),
        callbackUrl: urlCheck(callbackUrl, callback),
        baseUrl: urlCheck(baseUrl, base),
      },
      reasons,
    });
  });
}
