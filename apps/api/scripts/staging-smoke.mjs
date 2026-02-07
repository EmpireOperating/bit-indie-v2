#!/usr/bin/env node
/**
 * Staging smoke test (no secrets required)
 *
 * Usage:
 *   ORIGIN=https://staging.bitindie.io node scripts/staging-smoke.mjs
 */
import { randomBytes } from 'node:crypto';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/secp256k1';

const ORIGIN = process.env.ORIGIN ?? 'https://staging.bitindie.io';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'https://staging.bitindie.io';

function canonicalJsonStringify(obj) {
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}

function sha256Hex(input) {
  const digest = sha256(new TextEncoder().encode(input));
  return `0x${Buffer.from(digest).toString('hex')}`;
}

function hex32(bytes) {
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

async function getJson(path, headers = {}) {
  const res = await fetch(`${ORIGIN}${path}`, { headers });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function postJson(path, body, headers = {}) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function postForm(path, form) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text().catch(() => '');
  return { res, text };
}

async function main() {
  const results = [];

  // 1) Health
  {
    const { res, json } = await getJson('/health');
    results.push({ check: 'GET /health', ok: res.ok, status: res.status, body: json });
    if (!res.ok) throw new Error(`/health failed: ${res.status} ${JSON.stringify(json)}`);
  }

  // 2) Auth challenge + session + /me (bearer)
  let accessToken = null;
  {
    const priv = randomBytes(32);
    const pubBytes = schnorr.getPublicKey(priv);
    const pubkey = hex32(pubBytes);

    const c = await postJson('/auth/challenge', { origin: APP_ORIGIN });
    results.push({ check: 'POST /auth/challenge', ok: c.res.ok, status: c.res.status });
    if (!c.res.ok) throw new Error(`challenge failed: ${c.res.status} ${JSON.stringify(c.json)}`);

    const challenge = c.json.challenge;
    const json = canonicalJsonStringify(challenge);
    const hashHex = sha256Hex(json);
    const sigBytes = await schnorr.sign(Buffer.from(hashHex.slice(2), 'hex'), priv);
    const signature = hex32(sigBytes);

    const s = await postJson('/auth/session', {
      origin: APP_ORIGIN,
      pubkey,
      challenge,
      signature,
      requestedScopes: [{ type: 'auth.sign_challenge' }, { type: 'session.refresh' }],
    });
    results.push({ check: 'POST /auth/session', ok: s.res.ok, status: s.res.status });
    if (!s.res.ok) throw new Error(`session failed: ${s.res.status} ${JSON.stringify(s.json)}`);

    accessToken = s.json.accessToken;

    const me = await getJson('/me', { authorization: `Bearer ${accessToken}` });
    results.push({ check: 'GET /me', ok: me.res.ok, status: me.res.status });
    if (!me.res.ok) throw new Error(`/me failed: ${me.res.status} ${JSON.stringify(me.json)}`);
  }

  // 3) Webhook sanity: if not configured, should be 503 (not 500)
  {
    const { res } = await postForm('/webhooks/opennode/withdrawals', {
      id: 'w_smoke',
      status: 'confirmed',
      processed_at: new Date().toISOString(),
      fee: '0',
      hashed_order: 'bad',
    });
    // We expect 503 when misconfigured (no API key). If configured, we might get 401 due to bad HMAC.
    const ok = res.status === 503 || res.status === 401;
    results.push({ check: 'POST /webhooks/opennode/withdrawals (misconfig/401)', ok, status: res.status });
    if (!ok) throw new Error(`webhook unexpected status: ${res.status}`);
  }

  console.log('STAGING_SMOKE_OK');
  console.log(JSON.stringify({ origin: ORIGIN, results }, null, 2));
  if (!accessToken) process.exit(2);
}

main().catch((e) => {
  console.error('STAGING_SMOKE_FAIL');
  console.error(String(e?.stack || e));
  process.exit(1);
});
