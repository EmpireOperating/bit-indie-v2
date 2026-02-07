import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerStoragePresignRoutes } from './routes/storagePresign.js';
import { registerGameRoutes } from './routes/games.js';
import { registerReleaseRoutes } from './routes/releases.js';
import { registerAdminUploadRoutes } from './routes/adminUpload.js';
import { registerPurchaseRoutes } from './routes/purchases.js';
const app = Fastify({ logger: true });
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
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
