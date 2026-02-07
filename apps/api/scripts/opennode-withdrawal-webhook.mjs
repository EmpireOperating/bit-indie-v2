#!/usr/bin/env node
/**
 * OpenNode withdrawal webhook helper.
 *
 * Usage:
 *   OPENNODE_API_KEY=... node scripts/opennode-withdrawal-webhook.mjs hash <withdrawalId>
 *   OPENNODE_API_KEY=... node scripts/opennode-withdrawal-webhook.mjs curl <apiBaseUrl> <withdrawalId> [confirmed|failed|error]
 *
 * Notes:
 * - OpenNode sends application/x-www-form-urlencoded.
 * - Our server validates: hashed_order = HMAC_SHA256_HEX(OPENNODE_API_KEY, withdrawalId)
 */

import crypto from 'node:crypto';

function hmacHex(key, msg) {
  return crypto.createHmac('sha256', key).update(msg).digest('hex');
}

function die(msg) {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
}

const apiKey = (process.env.OPENNODE_API_KEY ?? '').trim();
if (!apiKey) die('OPENNODE_API_KEY is required');

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'hash') {
  const withdrawalId = String(rest[0] ?? '').trim();
  if (!withdrawalId) die('Usage: ... hash <withdrawalId>');
  // eslint-disable-next-line no-console
  console.log(hmacHex(apiKey, withdrawalId));
  process.exit(0);
}

if (cmd === 'curl') {
  const apiBaseUrl = String(rest[0] ?? '').trim().replace(/\/$/, '');
  const withdrawalId = String(rest[1] ?? '').trim();
  const status = String(rest[2] ?? 'confirmed').trim();

  if (!apiBaseUrl || !withdrawalId) {
    die('Usage: ... curl <apiBaseUrl> <withdrawalId> [confirmed|failed|error]');
  }

  const hashed = hmacHex(apiKey, withdrawalId);

  // eslint-disable-next-line no-console
  console.log(
    [
      'curl -sS -X POST \\\',
      `  "${apiBaseUrl}/webhooks/opennode/withdrawals" \\\n  -H 'Content-Type: application/x-www-form-urlencoded' \\\n  --data-urlencode 'id=${withdrawalId}' \\\n  --data-urlencode 'status=${status}' \\\n  --data-urlencode 'hashed_order=${hashed}'`,
    ].join('\n')
  );
  process.exit(0);
}

die('Unknown command. Use: hash | curl');
