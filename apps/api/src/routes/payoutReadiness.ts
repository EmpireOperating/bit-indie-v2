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

function parseOptionalUrl(value: string): { ok: boolean; reason?: string } {
  return value ? parseUrl(value) : { ok: true };
}

function urlCheck(value: string, parsed: { ok: boolean }) {
  return {
    configured: Boolean(value),
    valid: parsed.ok,
    value: value || null,
  };
}

function hasConfiguredApiKey(value: string): boolean {
  return Boolean(value.trim());
}

function resolveProviderMode(hasApiKey: boolean): 'opennode' | 'mock' {
  return hasApiKey ? 'opennode' : 'mock';
}

function buildReadinessReasons(args: {
  hasApiKey: boolean;
  callback: { ok: boolean; reason?: string };
  base: { ok: boolean; reason?: string };
}): string[] {
  const reasons: string[] = [];
  if (!args.hasApiKey) reasons.push('OPENNODE_API_KEY missing');
  if (!args.callback.ok) reasons.push(`OPENNODE_WITHDRAWAL_CALLBACK_URL ${args.callback.reason}`);
  if (!args.base.ok) reasons.push(`OPENNODE_BASE_URL ${args.base.reason}`);
  return reasons;
}

export async function registerPayoutReadinessRoutes(app: FastifyInstance) {
  app.get('/ops/payouts/readiness', async () => {
    const apiKey = (process.env.OPENNODE_API_KEY ?? '').trim();
    const callbackUrl = (process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL ?? '').trim();
    const baseUrl = (process.env.OPENNODE_BASE_URL ?? '').trim();

    const hasApiKey = hasConfiguredApiKey(apiKey);
    const callback = parseUrl(callbackUrl);
    const base = parseOptionalUrl(baseUrl);
    const reasons = buildReadinessReasons({
      hasApiKey,
      callback,
      base,
    });

    return ok({
      payoutReady: reasons.length === 0,
      providerMode: resolveProviderMode(hasApiKey),
      checks: {
        hasOpenNodeApiKey: hasApiKey,
        callbackUrl: urlCheck(callbackUrl, callback),
        baseUrl: urlCheck(baseUrl, base),
      },
      reasons,
    });
  });
}
