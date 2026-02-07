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
  if (!s.res.ok) throw new Error(`session failed: ${s.res.status} ${JSON.stringify(s.json)}`);

  const accessToken = s.json.accessToken;
  const me = await getJson('/me', { authorization: `Bearer ${accessToken}` });
  if (!me.res.ok) throw new Error(`me failed: ${me.res.status} ${JSON.stringify(me.json)}`);

  console.log('OK');
  console.log({ pubkey, sessionId: me.json.sessionId, expiresAt: me.json.expiresAt });
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
