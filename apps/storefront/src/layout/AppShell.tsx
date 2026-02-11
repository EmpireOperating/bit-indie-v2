import { useState, type PropsWithChildren } from 'react';
import type { AuthFlowState, AuthSessionState } from '../auth/useHeadedAuth';
import { LightningLoginPanel } from '../components/LightningLoginPanel';
import './AppShell.css';

type AppShellProps = PropsWithChildren<{
  authFlow: AuthFlowState;
  authSession: AuthSessionState | null;
  isPolling: boolean;
  onStartLogin: () => void;
  onResetFlow: () => void;
  onLogout: () => void;
}>;

function formatPubkey(pubkey: string): string {
  if (pubkey.length < 16) return pubkey;
  return `${pubkey.slice(0, 10)}…${pubkey.slice(-8)}`;
}

export function AppShell({
  children,
  authFlow,
  authSession,
  isPolling,
  onStartLogin,
  onResetFlow,
  onLogout,
}: AppShellProps) {
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <p className="brand">BIT INDIE</p>
        <div className="top-bar__actions">
          {authSession ? <span className="session-chip">{formatPubkey(authSession.pubkey)}</span> : null}
          <button className="login-link" onClick={() => setLoginOpen((prev) => !prev)} type="button">
            {authSession ? 'Session ⚡' : 'Login ⚡'}
          </button>
        </div>
      </header>

      <LightningLoginPanel
        open={loginOpen}
        flow={authFlow}
        session={authSession}
        isPolling={isPolling}
        onClose={() => setLoginOpen(false)}
        onStart={onStartLogin}
        onResetFlow={onResetFlow}
        onLogout={onLogout}
      />

      <main>{children}</main>
    </div>
  );
}
