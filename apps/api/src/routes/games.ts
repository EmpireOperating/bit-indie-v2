import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { assertPrefix } from '../storageKeys.js';
import { mapPrismaWriteError } from './prismaErrors.js';

const uuidSchema = z.string().uuid();

const slugSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const gameBodySchema = z.object({
  developerUserId: uuidSchema,
  slug: slugSchema,
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(500).optional().nullable(),
  descriptionMd: z.string().max(200_000).optional().nullable(),
  coverObjectKey: z.string().max(1024).optional().nullable(),
  status: z.enum(['DRAFT', 'UNLISTED', 'LISTED', 'FEATURED', 'BANNED']).optional(),
});

const gameUpdateBodySchema = gameBodySchema.partial().extend({
  id: uuidSchema.optional(),
});

const listGamesQuerySchema = z.object({
  status: z.enum(['DRAFT', 'UNLISTED', 'LISTED', 'FEATURED', 'BANNED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: uuidSchema.optional(),
});

export async function registerGameRoutes(app: FastifyInstance) {
  app.get('/games', async (req, reply) => {
    const parsed = listGamesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid query', issues: parsed.error.issues });
    }

    const rows = await prisma.game.findMany({
      where: parsed.data.status ? { status: parsed.data.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: parsed.data.limit,
      ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
    });

    const nextCursor = rows.length === parsed.data.limit ? rows.at(-1)?.id ?? null : null;

    return { ok: true, games: rows, nextCursor };
  });

  app.get('/games/:gameId', async (req, reply) => {
    const gameIdParsed = uuidSchema.safeParse((req.params as any).gameId);
    if (!gameIdParsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid gameId' });
    }

    const game = await prisma.game.findUnique({ where: { id: gameIdParsed.data } });
    if (!game) {
      return reply.status(404).send({ ok: false, error: 'Game not found' });
    }

    return { ok: true, game };
  });

  app.post('/games', async (req, reply) => {
    const parsed = gameBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid request body',
        issues: parsed.error.issues,
      });
    }

    const data = parsed.data;
    if (data.coverObjectKey != null) {
      try {
        assertPrefix(data.coverObjectKey, 'covers/');
      } catch {
        return reply.status(400).send({ ok: false, error: 'Invalid coverObjectKey' });
      }
    }

    try {
      const game = await prisma.game.create({
        data: {
          developerUserId: data.developerUserId,
          slug: data.slug,
          title: data.title,
          summary: data.summary ?? null,
          descriptionMd: data.descriptionMd ?? null,
          coverObjectKey: data.coverObjectKey ?? null,
          status: data.status ?? 'DRAFT',
        },
      });

      return { ok: true, game };
    } catch (e) {
      const mapped = mapPrismaWriteError(e, {
        P2002: 'Game with same unique field already exists',
        P2003: 'Referenced record not found',
      });
      if (mapped) return reply.status(mapped.status).send({ ok: false, error: mapped.error });
      throw e;
    }
  });

  app.put('/games/:gameId', async (req, reply) => {
    const gameIdParsed = uuidSchema.safeParse((req.params as any).gameId);
    if (!gameIdParsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid gameId' });
    }

    const parsed = gameUpdateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid request body',
        issues: parsed.error.issues,
      });
    }

    const data = parsed.data;
    if (data.id && data.id !== gameIdParsed.data) {
      return reply.status(400).send({ ok: false, error: 'Body id must match route gameId' });
    }

    if (data.coverObjectKey != null) {
      try {
        assertPrefix(data.coverObjectKey, 'covers/');
      } catch {
        return reply.status(400).send({ ok: false, error: 'Invalid coverObjectKey' });
      }
    }

    try {
      const game = await prisma.game.update({
        where: { id: gameIdParsed.data },
        data: {
          developerUserId: data.developerUserId,
          slug: data.slug,
          title: data.title,
          summary: data.summary,
          descriptionMd: data.descriptionMd,
          coverObjectKey: data.coverObjectKey,
          status: data.status,
        },
      });

      return { ok: true, game };
    } catch (e) {
      const mapped = mapPrismaWriteError(e, {
        P2002: 'Game with same unique field already exists',
        P2003: 'Referenced record not found',
        P2025: 'Game not found',
      });
      if (mapped) return reply.status(mapped.status).send({ ok: false, error: mapped.error });
      throw e;
    }
  });
}
