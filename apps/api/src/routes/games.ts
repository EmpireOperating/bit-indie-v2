import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { assertPrefix } from '../storageKeys.js';

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

function mapPrismaWriteError(error: unknown): { status: number; error: string } | null {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as any).code) : null;

  if (code === 'P2002') {
    return { status: 409, error: 'Game with same unique field already exists' };
  }

  if (code === 'P2003') {
    return { status: 404, error: 'Referenced record not found' };
  }

  if (code === 'P2025') {
    return { status: 404, error: 'Game not found' };
  }

  return null;
}

export async function registerGameRoutes(app: FastifyInstance) {
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
      } catch (e) {
        return reply.status(400).send({ ok: false, error: (e as Error).message });
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
      const mapped = mapPrismaWriteError(e);
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
      } catch (e) {
        return reply.status(400).send({ ok: false, error: (e as Error).message });
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
      const mapped = mapPrismaWriteError(e);
      if (mapped) return reply.status(mapped.status).send({ ok: false, error: mapped.error });
      throw e;
    }
  });
}
