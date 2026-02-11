import type { AuthFlowState, AuthSessionState } from '../auth/useHeadedAuth';
import './LightningLoginPanel.css';

type LightningLoginPanelProps = {
  open: boolean;
  flow: AuthFlowState;
  session: AuthSessionState | null;
  isPolling: boolean;
  onClose: () => void;
  onStart: () => void;
  onResetFlow: () => void;
  onLogout: () => void;
};

function shortPubkey(pubkey: string): string {
  if (pubkey.length < 16) return pubkey;
  return `${pubkey.slice(0, 10)}…${pubkey.slice(-8)}`;
}

export function LightningLoginPanel({
  open,
  flow,
  session,
  isPolling,
  onClose,
  onStart,
  onResetFlow,
  onLogout,
}: LightningLoginPanelProps) {
  if (!open) return null;

  return (
    <section aria-live="polite" className="login-panel" role="dialog" aria-label="Lightning login">
      <div className="login-panel__header">
        <h2>Lightning Login ⚡</h2>
        <button className="login-panel__close" onClick={onClose} type="button">
          Close
        </button>
      </div>

      {session ? (
        <div className="login-panel__session">
          <p className="login-panel__state login-panel__state--ok">Signed in</p>
          <p>Pubkey: {shortPubkey(session.pubkey)}</p>
          <p>Session expires: {new Date(session.expiresAtUnix * 1000).toLocaleString()}</p>
          <button className="login-panel__button" onClick={onLogout} type="button">
            Sign out
          </button>
        </div>
      ) : null}

      {!session ? (
        <div className="login-panel__body">
          {flow.phase === 'idle' ? (
            <>
              <p>Start login to generate a challenge for your Lightning signer wallet.</p>
              <button className="login-panel__button" onClick={onStart} type="button">
                Start Lightning Login
              </button>
            </>
          ) : null}

          {flow.phase === 'starting' ? <p className="login-panel__state">Creating login challenge…</p> : null}

          {flow.phase === 'pending' ? (
            <>
              <p className="login-panel__state">Waiting for wallet approval…</p>
              <p>Open your signer wallet and scan or paste this Lightning URI:</p>
              <code className="login-panel__code">{flow.lightningUri}</code>
              <p>Nonce: {flow.challenge.nonce}</p>
              <p>Challenge expires: {new Date(flow.expiresAtUnix * 1000).toLocaleTimeString()}</p>
              <p>Polling status: {isPolling ? `active (${flow.pollCount} checks)` : 'paused'}</p>
              <p>Next retry in ~{Math.ceil(flow.nextPollInMs / 1000)}s</p>
              <button className="login-panel__button" onClick={onResetFlow} type="button">
                Cancel and reset
              </button>
            </>
          ) : null}

          {flow.phase === 'approved' ? (
            <>
              <p className="login-panel__state login-panel__state--ok">Approved. Session active.</p>
              <p>Pubkey: {shortPubkey(flow.pubkey)}</p>
              <p>Approved: {new Date(flow.approvedAtUnix * 1000).toLocaleTimeString()}</p>
              <p>Expires: {new Date(flow.expiresAtUnix * 1000).toLocaleString()}</p>
              <button className="login-panel__button" onClick={onClose} type="button">
                Done
              </button>
            </>
          ) : null}

          {flow.phase === 'expired' ? (
            <>
              <p className="login-panel__state login-panel__state--warn">{flow.reason}</p>
              <button className="login-panel__button" onClick={onStart} type="button">
                Start new challenge
              </button>
            </>
          ) : null}

          {flow.phase === 'error' ? (
            <>
              <p className="login-panel__state login-panel__state--err">Login failed: {flow.message}</p>
              <div className="login-panel__actions">
                <button className="login-panel__button" onClick={onStart} type="button">
                  Retry
                </button>
                <button className="login-panel__button login-panel__button--ghost" onClick={onResetFlow} type="button">
                  Reset
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
