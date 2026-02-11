import { ApiUnavailableError, apiClient } from './client';
import type { CatalogGame, FeaturedGame } from '../types/catalog';

type ApiEnvelope<T> = { ok: true } & T;

type GamesListResponse = ApiEnvelope<{
  games: CatalogGame[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

type GameDetailResponse = ApiEnvelope<{ game: CatalogGame }>;

const fallbackFeaturedGames: FeaturedGame[] = [
  {
    id: 'neon-circuit',
    slug: 'neon-circuit',
    title: 'Neon Circuit',
    summary: 'Arcade racing through synth-lit megacities.',
    priceSats: 49000,
    imageAlt: 'Neon Circuit key art placeholder',
    releaseId: null,
  },
  {
    id: 'hash-hunter',
    slug: 'hash-hunter',
    title: 'Hash Hunter',
    summary: 'Puzzle-combat roguelite powered by pure reflex.',
    priceSats: 79000,
    imageAlt: 'Hash Hunter key art placeholder',
    releaseId: null,
  },
  {
    id: 'agent-arena',
    slug: 'agent-arena',
    title: 'Agent Arena',
    summary: 'Tactical auto-brawler set in the relay wars.',
    priceSats: 99000,
    imageAlt: 'Agent Arena key art placeholder',
    releaseId: null,
  },
];

function mapGameToFeatured(game: CatalogGame): FeaturedGame {
  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    summary: game.summary,
    priceSats: 59000,
    imageAlt: `${game.title} key art`,
    releaseId: null,
  };
}

export async function getFeaturedGames(): Promise<{ games: FeaturedGame[]; usingFallback: boolean }> {
  try {
    const data = await apiClient.get<GamesListResponse>('/games?status=LISTED&limit=6');
    return {
      games: data.games.map(mapGameToFeatured),
      usingFallback: false,
    };
  } catch (error) {
    if (error instanceof ApiUnavailableError) {
      return { games: fallbackFeaturedGames, usingFallback: true };
    }
    throw error;
  }
}

export async function getGameById(gameId: string): Promise<CatalogGame> {
  const data = await apiClient.get<GameDetailResponse>(`/games/${gameId}`);
  return data.game;
}
