import 'dotenv/config';
import { buildApp } from './app.js';

function startupPayoutChecks() {
  const apiKey = (process.env.OPENNODE_API_KEY ?? '').trim();
  const callback = (process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL ?? '').trim();
  const warnings: string[] = [];

  if (!apiKey) warnings.push('OPENNODE_API_KEY missing (payout worker will run in mock mode)');
  if (!callback) warnings.push('OPENNODE_WITHDRAWAL_CALLBACK_URL missing (webhook route will report misconfigured)');
  else {
    try {
      // eslint-disable-next-line no-new
      new URL(callback);
    } catch {
      warnings.push('OPENNODE_WITHDRAWAL_CALLBACK_URL is not a valid URL');
    }
  }

  return {
    warnings,
    mode: apiKey ? 'opennode' : 'mock',
  };
}

const app = await buildApp();

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

const payoutConfig = startupPayoutChecks();
if (payoutConfig.warnings.length > 0) {
  app.log.warn({ mode: payoutConfig.mode, warnings: payoutConfig.warnings }, 'payout startup checks: incomplete configuration');
} else {
  app.log.info({ mode: payoutConfig.mode }, 'payout startup checks: ready');
}

await app.listen({ port, host });
