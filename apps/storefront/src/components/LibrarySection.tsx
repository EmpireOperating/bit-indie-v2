import { useMemo, useState } from 'react';
import { getApiErrorMessage, getApiErrorStatus, getEntitlementPath, resolveDownloadAccess } from '../api/library';
import type { FeaturedGame } from '../types/catalog';
import './LibrarySection.css';

type LibrarySectionProps = {
  games: FeaturedGame[];
};

type EntitlementState = {
  status: 'idle' | 'checking' | 'unlocked' | 'locked';
  message: string;
  downloadUrl?: string;
};

function initialState(): EntitlementState {
  return {
    status: 'idle',
    message: 'Enter your token/receipt and check access.',
  };
}

export function LibrarySection({ games }: LibrarySectionProps) {
  const [accessToken, setAccessToken] = useState('');
  const [buyerUserId, setBuyerUserId] = useState('');
  const [guestReceiptCode, setGuestReceiptCode] = useState('');
  const [states, setStates] = useState<Record<string, EntitlementState>>({});

  const credentialSummary = useMemo(() => {
    if (accessToken.trim()) return 'tokenized access';
    if (buyerUserId.trim() || guestReceiptCode.trim()) return 'direct access';
    return 'none';
  }, [accessToken, buyerUserId, guestReceiptCode]);

  const getState = (gameId: string): EntitlementState => states[gameId] ?? initialState();

  async function checkAccess(game: FeaturedGame) {
    if (!game.releaseId) {
      setStates((prev) => ({
        ...prev,
        [game.id]: {
          status: 'locked',
          message: 'No published release linked to this game yet.',
        },
      }));
      return;
    }

    const hasToken = Boolean(accessToken.trim());
    const mode = hasToken ? 'tokenized_access' : 'direct_download';

    setStates((prev) => ({
      ...prev,
      [game.id]: { status: 'checking', message: 'Checking entitlement…' },
    }));

    try {
      const support = await getEntitlementPath('headed', mode);

      if (!support.supported) {
        setStates((prev) => ({
          ...prev,
          [game.id]: {
            status: 'locked',
            message: support.reason ?? 'This access mode is not available on the current surface.',
          },
        }));
        return;
      }

      const download = await resolveDownloadAccess(game.releaseId, {
        accessToken,
        buyerUserId,
        guestReceiptCode,
      });

      setStates((prev) => ({
        ...prev,
        [game.id]: {
          status: 'unlocked',
          message: `Access granted via ${download.entitlementMode.replaceAll('_', ' ')}.`,
          downloadUrl: download.downloadUrl,
        },
      }));
    } catch (error) {
      const status = getApiErrorStatus(error);

      let message = getApiErrorMessage(error, 'Unable to verify access right now.');
      if (status === 403) message = 'Locked: no entitlement found for this account/receipt.';
      if (status === 401) message = 'Locked: session token is invalid or expired.';
      if (status === 404) message = 'Release not found for this game yet.';
      if (status === 409) message = 'Release exists, but no downloadable build is published yet.';

      setStates((prev) => ({
        ...prev,
        [game.id]: {
          status: 'locked',
          message,
        },
      }));
    }
  }

  return (
    <section className="library-section" aria-labelledby="library-heading">
      <div className="library-header">
        <h2 id="library-heading">Your Library</h2>
        <p className="library-help">Current credential mode: {credentialSummary}</p>
      </div>

      <div className="library-credentials" role="group" aria-label="Download credentials">
        <label>
          Access token
          <input
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
            placeholder="UUID session token"
          />
        </label>

        <label>
          Buyer user ID
          <input
            value={buyerUserId}
            onChange={(event) => setBuyerUserId(event.target.value)}
            placeholder="Buyer UUID"
          />
        </label>

        <label>
          Guest receipt code
          <input
            value={guestReceiptCode}
            onChange={(event) => setGuestReceiptCode(event.target.value)}
            placeholder="Receipt code"
          />
        </label>
      </div>

      <div className="library-grid">
        {games.length === 0 ? <p className="library-state">No games in catalog yet.</p> : null}

        {games.map((game) => {
          const state = getState(game.id);

          return (
            <article key={game.id} className="library-card">
              <h3>{game.title}</h3>
              <p className={`library-state ${state.status}`}>{state.message}</p>

              <div className="library-actions">
                <button type="button" onClick={() => void checkAccess(game)} disabled={state.status === 'checking'}>
                  {state.status === 'checking' ? 'Checking…' : 'Check access'}
                </button>

                {state.downloadUrl ? (
                  <a href={state.downloadUrl} target="_blank" rel="noreferrer">
                    Download
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
