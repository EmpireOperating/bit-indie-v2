#!/usr/bin/env node
/**
 * OpenNode withdrawal webhook helper.
 *
 * Usage:
 *   OPENNODE_API_KEY=... node scripts/opennode-withdrawal-webhook.mjs hash <withdrawalId>
 *
 *   OPENNODE_API_KEY=... node scripts/opennode-withdrawal-webhook.mjs curl \
 *     <apiBaseUrl> <withdrawalId> [confirmed|failed|error] \
 *     [--processed-at <iso>] [--fee <value>] [--error <message>]
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

function parseFlags(argv) {
  const out = { args: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v && v.startsWith('--')) {
      const k = v.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out.flags[k] = true;
      } else {
        out.flags[k] = next;
        i += 1;
      }
    } else {
      out.args.push(v);
    }
  }
  return out;
}

const apiKey = (process.env.OPENNODE_API_KEY ?? '').trim();
if (!apiKey) die('OPENNODE_API_KEY is required');

const [cmd, ...restRaw] = process.argv.slice(2);
const { args: rest, flags } = parseFlags(restRaw);

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
    die('Usage: ... curl <apiBaseUrl> <withdrawalId> [confirmed|failed|error] [--processed-at <iso>] [--fee <value>] [--error <message>]');
  }

  const hashed = hmacHex(apiKey, withdrawalId);
  const processedAt = flags['processed-at'] ? String(flags['processed-at']) : null;
  const fee = flags.fee ? String(flags.fee) : null;
  const error = flags.error ? String(flags.error) : null;

  const lines = [
    `curl -sS -X POST \\`, 
    `  "${apiBaseUrl}/webhooks/opennode/withdrawals" \\\n  -H 'Content-Type: application/x-www-form-urlencoded' \\\n  --data-urlencode 'id=${withdrawalId}' \\\n  --data-urlencode 'status=${status}' \\\n  --data-urlencode 'hashed_order=${hashed}'`,
  ];

  if (processedAt) lines.push(`  --data-urlencode 'processed_at=${processedAt}'`);
  if (fee) lines.push(`  --data-urlencode 'fee=${fee}'`);
  if (error) lines.push(`  --data-urlencode 'error=${error.replace(/'/g, "'\\''")}'`);

  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
  process.exit(0);
}

die('Unknown command. Use: hash | curl');
