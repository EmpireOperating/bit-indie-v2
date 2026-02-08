import { z } from 'zod';

export const gameStatusSchema = z.enum(['DRAFT', 'UNLISTED', 'LISTED', 'FEATURED', 'BANNED']);

export type GameStatus = z.infer<typeof gameStatusSchema>;
