import { useEffect, useState } from 'react';
import { useHeadedAuth } from './auth/useHeadedAuth';
import { AppShell } from './layout/AppShell';
import { HomePage } from './pages/HomePage';
import { GameDetailPage } from './pages/GameDetailPage';

function getPathname() {
  return window.location.pathname;
}

function App() {
  const [pathname, setPathname] = useState(getPathname);
  const auth = useHeadedAuth();

  useEffect(() => {
    const onPopState = () => setPathname(getPathname());

    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const gameMatch = pathname.match(/^\/games\/([^/]+)$/);

  return (
    <AppShell
      authFlow={auth.flow}
      authSession={auth.session}
      isPolling={auth.isPolling}
      onStartLogin={auth.startLogin}
      onResetFlow={auth.clearFlowState}
      onLogout={auth.logout}
    >
      {gameMatch ? <GameDetailPage gameId={gameMatch[1]} /> : <HomePage />}
    </AppShell>
  );
}

export default App;
