import type { FastifyInstance } from 'fastify';

function parseUrl(value: string): { ok: boolean; reason?: string } {
  if (!value) return { ok: false, reason: 'missing' };
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
}

export async function registerPayoutReadinessRoutes(app: FastifyInstance) {
  app.get('/ops/payouts/readiness', async () => {
    const apiKey = (process.env.OPENNODE_API_KEY ?? '').trim();
    const callbackUrl = (process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL ?? '').trim();
    const baseUrl = (process.env.OPENNODE_BASE_URL ?? '').trim();

    const callback = parseUrl(callbackUrl);
    const reasons: string[] = [];

    if (!apiKey) reasons.push('OPENNODE_API_KEY missing');
    if (!callback.ok) reasons.push(`OPENNODE_WITHDRAWAL_CALLBACK_URL ${callback.reason}`);

    return {
      ok: true,
      payoutReady: reasons.length === 0,
      providerMode: apiKey ? 'opennode' : 'mock',
      checks: {
        hasOpenNodeApiKey: Boolean(apiKey),
        callbackUrl: {
          configured: Boolean(callbackUrl),
          valid: callback.ok,
          value: callbackUrl || null,
        },
        baseUrl: baseUrl || null,
      },
      reasons,
    };
  });
}
