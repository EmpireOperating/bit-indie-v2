import { PrismaClient } from '@prisma/client';
// Fastify dev mode reloads can create multiple clients; keep a single instance.
const globalForPrisma = globalThis;
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production')
    globalForPrisma.prisma = prisma;
