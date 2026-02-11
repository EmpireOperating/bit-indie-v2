import { useEffect, useState } from 'react';
import { getGameById } from '../api/catalog';
import type { CatalogGame } from '../types/catalog';
import './GameDetailPage.css';

type GameDetailPageProps = {
  gameId: string;
};

type State = 'loading' | 'ready' | 'error' | 'notFound';

export function GameDetailPage({ gameId }: GameDetailPageProps) {
  const [state, setState] = useState<State>('loading');
  const [game, setGame] = useState<CatalogGame | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setState('loading');
        const data = await getGameById(gameId);
        if (cancelled) return;
        setGame(data);
        setState('ready');
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.message.includes('(404)')) {
          setState('notFound');
          return;
        }
        setState('error');
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [gameId]);

  if (state === 'loading') {
    return <p className="game-detail-note">Loading game details...</p>;
  }

  if (state === 'notFound') {
    return (
      <section className="game-detail-shell">
        <p className="game-detail-note">Game not found.</p>
        <a href="/" className="game-detail-back">
          ← Back to storefront
        </a>
      </section>
    );
  }

  if (state === 'error' || !game) {
    return (
      <section className="game-detail-shell">
        <p className="game-detail-note">Could not load this game right now.</p>
        <a href="/" className="game-detail-back">
          ← Back to storefront
        </a>
      </section>
    );
  }

  return (
    <section className="game-detail-shell" aria-labelledby="game-detail-title">
      <a href="/" className="game-detail-back">
        ← Back to storefront
      </a>
      <div className="game-detail-art" aria-label={`${game.title} cover art`} />
      <h1 id="game-detail-title">{game.title}</h1>
      <p className="game-detail-meta">Slug: {game.slug}</p>
      {game.summary && <p className="game-detail-summary">{game.summary}</p>}
      <article className="game-detail-description">{game.descriptionMd ?? 'Description coming soon.'}</article>
    </section>
  );
}
