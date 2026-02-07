import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerStoragePresignRoutes } from './routes/storagePresign.js';
const app = Fastify({ logger: true });
await app.register(cors, {
    origin: true,
    credentials: true,
});
app.get('/health', async () => {
    return { ok: true };
});
await registerStoragePresignRoutes(app);
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
