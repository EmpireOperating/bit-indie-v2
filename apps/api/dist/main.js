import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import * as querystring from 'node:querystring';
import { registerStoragePresignRoutes } from './routes/storagePresign.js';
import { registerGameRoutes } from './routes/games.js';
import { registerReleaseRoutes } from './routes/releases.js';
import { registerAdminUploadRoutes } from './routes/adminUpload.js';
import { registerPurchaseRoutes } from './routes/purchases.js';
import { registerOpenNodeWebhookRoutes } from './routes/opennodeWebhooks.js';
const app = Fastify({
    logger: true,
    // We accept OpenNode webhooks as application/x-www-form-urlencoded.
    // Fastify doesn't parse it by default without a plugin, so we add a small parser.
});
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
        done(null, querystring.parse(body));
    }
    catch (e) {
        done(e);
    }
});
await app.register(cors, {
    origin: true,
    credentials: true,
});
app.get('/health', async () => {
    return { ok: true };
});
await registerStoragePresignRoutes(app);
await registerGameRoutes(app);
await registerReleaseRoutes(app);
await registerAdminUploadRoutes(app);
await registerPurchaseRoutes(app);
await registerOpenNodeWebhookRoutes(app);
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
