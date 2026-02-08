#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/secp256k1';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:8787';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3000';

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

function failWithHint(step, status, body) {
  const error = body?.error;
  const hints = [];

  if (step === 'challenge') {
    hints.push('Check ORIGIN points to API base URL and APP_ORIGIN has scheme+host only (no path/query).');
  }
  if (step === 'session' && error === 'Challenge expired') {
    hints.push('Challenge TTL is 5 minutes. Re-run promptly or request a fresh challenge.');
  }
  if (step === 'session' && error === 'Challenge not found (or already used)') {
    hints.push('Challenge nonce may be reused/consumed. Request a new challenge and retry once.');
  }
  if (step === 'session' && error === 'Invalid signature') {
    hints.push('Ensure challenge JSON is canonicalized before hashing/signing and pubkey matches signing key.');
  }
  if ((step === 'challenge' || step === 'session') && status === 503) {
    hints.push('Backend store may be unavailable. Verify DB connectivity and Prisma migrations.');
  }
  if (step === 'me' && status === 401) {
    hints.push('Session may be expired/invalid. Re-run challenge+session flow to obtain a fresh token.');
  }

  const hintText = hints.length > 0 ? `\nHints:\n- ${hints.join('\n- ')}` : '';
  throw new Error(`${step} failed: ${status} ${JSON.stringify(body)}${hintText}`);
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

async function getJson(path, headers = {}) {
  const res = await fetch(`${ORIGIN}${path}`, { headers });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function main() {
  // Random privkey (not persisted). Use noble's randomPrivateKey? Keep simple here.
  const priv = randomBytes(32);

  // schnorr pubkey is x-only 32 bytes
  const pubBytes = schnorr.getPublicKey(priv);
  const pubkey = hex32(pubBytes);

  const c = await postJson('/auth/challenge', { origin: APP_ORIGIN });
  if (!c.res.ok) failWithHint('challenge', c.res.status, c.json);
  const challenge = c.json?.challenge;
  if (!challenge) throw new Error(`challenge response missing challenge payload: ${JSON.stringify(c.json)}`);

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
  if (!s.res.ok) failWithHint('session', s.res.status, s.json);

  const accessToken = s.json?.accessToken;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error(`session response missing accessToken: ${JSON.stringify(s.json)}`);
  }

  const me = await getJson('/me', { authorization: `Bearer ${accessToken}` });
  if (!me.res.ok) failWithHint('me', me.res.status, me.json);

  console.log('OK');
  console.log({ pubkey, sessionId: me.json.sessionId, expiresAt: me.json.expiresAt });
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
