import { useEffect, useState } from 'react';
import { getFeaturedGames } from '../api/catalog';
import { Hero } from '../components/Hero';
import { FeaturedSection } from '../components/FeaturedSection';
import { LibrarySection } from '../components/LibrarySection';
import type { FeaturedGame } from '../types/catalog';

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export function HomePage() {
  const [games, setGames] = useState<FeaturedGame[]>([]);
  const [state, setState] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setState('loading');
        setErrorMessage(null);
        const data = await getFeaturedGames();

        if (cancelled) return;

        setGames(data.games);
        setUsingFallback(data.usingFallback);
        setState(data.games.length > 0 ? 'ready' : 'empty');
      } catch (error) {
        if (cancelled) return;
        setState('error');
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load catalog');
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Hero />
      <FeaturedSection games={games} state={state} errorMessage={errorMessage} usingFallback={usingFallback} />
      <LibrarySection games={games} />
    </>
  );
}
