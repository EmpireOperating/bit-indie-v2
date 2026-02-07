import 'dotenv/config';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Prisma's JS runtime is CJS; in ESM we need to import the default and destructure.
const { PrismaClient } = prismaPkg;
export type PrismaClientType = InstanceType<typeof PrismaClient>;

// Fastify dev mode reloads can create multiple clients; keep a single instance.
// We also keep a single pg Pool so we don't leak connections across reloads.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientType;
  pgPool?: Pool;
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required (Prisma v7 requires a driver adapter configuration).');
}

const schemaFromUrl = (() => {
  try {
    const u = new URL(connectionString);
    return u.searchParams.get('schema');
  } catch {
    return null;
  }
})();

// IMPORTANT: Prisma's `?schema=` param does not automatically set Postgres search_path
// for the `pg` driver. We set it explicitly so runtime queries hit the same schema
// that `prisma migrate` targets.
const pool = globalForPrisma.pgPool ?? new Pool({
  connectionString,
  options: schemaFromUrl ? `-c search_path=${schemaFromUrl}` : undefined,
});
const adapter = new PrismaPg(pool);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.pgPool = pool;
  globalForPrisma.prisma = prisma;
}
