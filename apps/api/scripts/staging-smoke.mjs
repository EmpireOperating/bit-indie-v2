#!/usr/bin/env node
/**
 * Staging smoke test (no secrets required)
 *
 * Usage:
 *   ORIGIN=https://staging.bitindie.io node scripts/staging-smoke.mjs
 *
 * Options:
 *   TIMEOUT_MS=15000 (per request)
 *   APP_ORIGIN=https://staging.bitindie.io (auth origin)
 */
import { randomBytes } from 'node:crypto';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/secp256k1';

const ORIGIN = process.env.ORIGIN ?? 'https://staging.bitindie.io';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'https://staging.bitindie.io';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 15_000);

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

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(path, headers = {}) {
  const res = await fetchWithTimeout(`${ORIGIN}${path}`, { headers });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function postJson(path, body, headers = {}) {
  const res = await fetchWithTimeout(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function postForm(path, form) {
  const res = await fetchWithTimeout(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text().catch(() => '');
  return { res, text };
}

function printConfig() {
  console.log('STAGING_SMOKE_CONFIG');
  console.log(JSON.stringify({ origin: ORIGIN, appOrigin: APP_ORIGIN, timeoutMs: TIMEOUT_MS }, null, 2));
}

function pushResult(results, entry) {
  results.push(entry);
  const mark = entry.ok ? 'OK' : 'FAIL';
  const expectedText = Array.isArray(entry.expected) ? ` expected=${entry.expected.join('|')}` : '';
  console.log(`[${mark}] ${entry.check} status=${entry.status}${expectedText}`);
}

function failWithSummary(results, err, hint, failureSignature = 'UNKNOWN') {
  console.error('STAGING_SMOKE_FAIL');
  console.error(`FAILURE_SIGNATURE: ${failureSignature}`);
  console.error(String(err?.stack || err));
  if (hint) console.error(`HINT: ${hint}`);
  console.error(
    JSON.stringify(
      {
        origin: ORIGIN,
        appOrigin: APP_ORIGIN,
        timeoutMs: TIMEOUT_MS,
        failureSignature,
        results,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

async function main() {
  const results = [];
  printConfig();

  // 1) Health
  try {
    const { res, json } = await getJson('/health');
    const ok = res.ok;
    pushResult(results, { check: 'GET /health', ok, status: res.status, body: json, expected: [200] });
    if (!ok) {
      failWithSummary(results, new Error(`/health failed: ${res.status} ${JSON.stringify(json)}`), 'Check API/container health and reverse proxy.', 'HEALTH_NON_200');
    }
  } catch (err) {
    failWithSummary(results, err, 'Network/DNS/TLS issue reaching /health. Verify ORIGIN and connectivity.', 'HEALTH_NETWORK_ERROR');
  }

  // 2) Auth challenge + session + /me (bearer)
  let accessToken = null;
  try {
    const priv = randomBytes(32);
    const pubBytes = schnorr.getPublicKey(priv);
    const pubkey = hex32(pubBytes);

    const c = await postJson('/auth/challenge', { origin: APP_ORIGIN });
    pushResult(results, { check: 'POST /auth/challenge', ok: c.res.ok, status: c.res.status, expected: [200] });
    if (!c.res.ok) {
      failWithSummary(results, new Error(`challenge failed: ${c.res.status} ${JSON.stringify(c.json)}`), 'Auth challenge endpoint rejected origin or is unavailable.', 'AUTH_CHALLENGE_FAILED');
    }

    const challenge = c.json?.challenge;
    if (!challenge) {
      failWithSummary(results, new Error('challenge payload missing `challenge` field'), 'Unexpected challenge response shape.', 'AUTH_CHALLENGE_SHAPE_INVALID');
    }

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
    pushResult(results, { check: 'POST /auth/session', ok: s.res.ok, status: s.res.status, expected: [200] });
    if (!s.res.ok) {
      failWithSummary(results, new Error(`session failed: ${s.res.status} ${JSON.stringify(s.json)}`), 'Session issuance failed; check auth service and signature handling.', 'AUTH_SESSION_FAILED');
    }

    accessToken = s.json?.accessToken;
    if (!accessToken) {
      failWithSummary(results, new Error('session payload missing `accessToken` field'), 'Unexpected session response shape.', 'AUTH_SESSION_SHAPE_INVALID');
    }

    const me = await getJson('/me', { authorization: `Bearer ${accessToken}` });
    pushResult(results, { check: 'GET /me', ok: me.res.ok, status: me.res.status, expected: [200] });
    if (!me.res.ok) {
      failWithSummary(results, new Error(`/me failed: ${me.res.status} ${JSON.stringify(me.json)}`), 'Bearer token was not accepted; investigate auth/session middleware.', 'AUTH_ME_FAILED');
    }
  } catch (err) {
    failWithSummary(results, err, 'Auth smoke sequence failed before completion.', 'AUTH_SEQUENCE_EXCEPTION');
  }

  // 3) Payout readiness endpoint
  let payoutReady = false;
  try {
    const { res, json } = await getJson('/ops/payouts/readiness');

    const isShapeOk =
      json?.ok === true &&
      typeof json?.payoutReady === 'boolean' &&
      Array.isArray(json?.reasons) &&
      typeof json?.checks === 'object' &&
      typeof json?.checks?.hasOpenNodeApiKey === 'boolean' &&
      typeof json?.checks?.callbackUrl === 'object' &&
      typeof json?.checks?.callbackUrl?.valid === 'boolean' &&
      typeof json?.checks?.baseUrl === 'object' &&
      typeof json?.checks?.baseUrl?.valid === 'boolean';

    const ok = res.ok && isShapeOk;
    payoutReady = Boolean(json?.payoutReady);

    pushResult(results, {
      check: 'GET /ops/payouts/readiness',
      ok,
      status: res.status,
      body: json,
      expected: [200],
      payoutReady,
    });

    if (!res.ok) {
      const failureSignature = res.status === 404 ? 'READINESS_ROUTE_NOT_FOUND' : 'READINESS_FAILED';
      const hint =
        res.status === 404
          ? 'Staging is reachable but /ops/payouts/readiness is 404. This almost always means staging is running an older API build or reverse proxy is pointing at the wrong service. Redeploy to the intended sha and re-run smoke.'
          : 'Readiness endpoint unhealthy; check API config and dependencies.';

      failWithSummary(
        results,
        new Error(`/ops/payouts/readiness failed: ${res.status} ${JSON.stringify(json)}`),
        hint,
        failureSignature,
      );
    }

    if (res.ok && !isShapeOk) {
      failWithSummary(
        results,
        new Error(`/ops/payouts/readiness invalid shape: ${JSON.stringify(json)}`),
        'Expected ok=true, payoutReady:boolean, reasons: string[], and checks.{hasOpenNodeApiKey,callbackUrl,baseUrl} fields.',
        'READINESS_SHAPE_INVALID',
      );
    }
  } catch (err) {
    failWithSummary(results, err, 'Could not fetch payouts readiness endpoint.', 'READINESS_NETWORK_ERROR');
  }

  // 4) Webhook sanity with expected status based on readiness
  try {
    const { res, text } = await postForm('/webhooks/opennode/withdrawals', {
      id: 'w_smoke',
      status: 'confirmed',
      processed_at: new Date().toISOString(),
      fee: '0',
      hashed_order: 'bad',
    });

    const expected = payoutReady ? [401] : [503];
    const ok = expected.includes(res.status);

    pushResult(results, {
      check: 'POST /webhooks/opennode/withdrawals (sanity)',
      ok,
      status: res.status,
      expected,
      payoutReady,
      body: text?.slice(0, 300),
    });

    if (!ok) {
      failWithSummary(
        results,
        new Error(`webhook unexpected status: ${res.status} expected one of ${expected.join(',')}`),
        payoutReady
          ? 'If payoutReady=true, webhook should reject invalid signature with 401.'
          : 'If payoutReady=false, webhook should be blocked as misconfigured with 503.',
        payoutReady ? 'WEBHOOK_EXPECTED_401_GOT_OTHER' : 'WEBHOOK_EXPECTED_503_GOT_OTHER',
      );
    }
  } catch (err) {
    failWithSummary(results, err, 'Webhook sanity request failed; check route/proxy/network.', 'WEBHOOK_NETWORK_ERROR');
  }

  console.log('STAGING_SMOKE_OK');
  console.log(
    JSON.stringify(
      {
        origin: ORIGIN,
        appOrigin: APP_ORIGIN,
        timeoutMs: TIMEOUT_MS,
        payoutReady,
        results,
      },
      null,
      2,
    ),
  );
}

main();
