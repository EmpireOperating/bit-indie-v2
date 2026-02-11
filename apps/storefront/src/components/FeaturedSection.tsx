import type { FeaturedGame } from '../types/catalog';
import './FeaturedSection.css';

type FeaturedSectionProps = {
  games: FeaturedGame[];
  state: 'idle' | 'loading' | 'ready' | 'empty' | 'error';
  errorMessage?: string | null;
  usingFallback?: boolean;
};

function formatSats(value: number) {
  return value.toLocaleString('en-US');
}

export function FeaturedSection({ games, state, errorMessage, usingFallback = false }: FeaturedSectionProps) {
  return (
    <section className="featured-section" aria-labelledby="featured-heading">
      <h2 id="featured-heading">Featured Games</h2>

      {usingFallback && <p className="featured-note">Showing curated seed picks while API is unavailable.</p>}

      {state === 'loading' && <p className="featured-note">Loading catalog...</p>}
      {state === 'empty' && <p className="featured-note">No listed games yet. Check back soon.</p>}
      {state === 'error' && <p className="featured-note featured-note--error">Could not load featured games. {errorMessage}</p>}

      {(state === 'ready' || (usingFallback && games.length > 0)) && (
        <div className="featured-grid">
          {games.map((game) => (
            <article key={game.id} className="featured-card">
              <a href={`/games/${game.id}`} className="featured-link" aria-label={`View ${game.title}`}>
                <div className="card-image" aria-label={game.imageAlt} />
                <h3>{game.title}</h3>
                {game.summary && <p className="card-summary">{game.summary}</p>}
                <p>⚡ {formatSats(game.priceSats)} sats</p>
              </a>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
