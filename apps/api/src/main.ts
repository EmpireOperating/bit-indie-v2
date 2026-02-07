import 'dotenv/config';
import fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import * as querystring from 'node:querystring';
import { registerAuthRoutes } from './routes/auth.js';
import { registerStoragePresignRoutes } from './routes/storagePresign.js';
import { registerGameRoutes } from './routes/games.js';
import { registerReleaseRoutes } from './routes/releases.js';
import { registerAdminUploadRoutes } from './routes/adminUpload.js';
import { registerPurchaseRoutes } from './routes/purchases.js';
import { registerOpenNodeWebhookRoutes } from './routes/opennodeWebhooks.js';

const app = fastify({
  logger: true,
  // We accept OpenNode webhooks as application/x-www-form-urlencoded.
  // Fastify doesn't parse it by default without a plugin, so we add a small parser.
});

app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req: any, body: any, done: any) => {
  try {
    done(null, querystring.parse(body as string));
  } catch (e) {
    done(e as Error);
  }
});

await app.register(cors, {
  origin: true,
  credentials: true,
});

await app.register(cookie, {
  // If you rotate this, existing sessions will continue to work because
  // we store sessions in DB; this is only used for cookie signing by Fastify.
  secret: process.env.COOKIE_SECRET ?? 'dev-cookie-secret',
});

app.get('/health', async () => {
  return { ok: true };
});

await registerAuthRoutes(app);
await registerStoragePresignRoutes(app);
await registerGameRoutes(app);
await registerReleaseRoutes(app);
await registerAdminUploadRoutes(app);
await registerPurchaseRoutes(app);
await registerOpenNodeWebhookRoutes(app);

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

await app.listen({ port, host });
