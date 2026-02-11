import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDefaultPollIntervalMs,
  getHeadedAuthStatus,
  startHeadedAuth,
  type HeadedAuthStartResponse,
} from './headedAuth';

export type AuthSessionState = {
  pubkey: string;
  expiresAtUnix: number;
  approvedAtUnix: number;
};

export type AuthFlowState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | {
      phase: 'pending';
      challenge: HeadedAuthStartResponse['challenge'];
      lightningUri: string;
      expiresAtUnix: number;
      pollCount: number;
      nextPollInMs: number;
    }
  | {
      phase: 'approved';
      pubkey: string;
      expiresAtUnix: number;
      approvedAtUnix: number;
    }
  | {
      phase: 'expired';
      reason: string;
    }
  | {
      phase: 'error';
      message: string;
    };

const MIN_POLL_MS = 1_000;
const MAX_POLL_MS = 5_000;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function pollDelayMs(baseMs: number, attempt: number): number {
  const backedOff = baseMs * Math.pow(1.2, Math.min(attempt, 8));
  const jitter = Math.floor(Math.random() * 250);
  return clamp(Math.floor(backedOff) + jitter, MIN_POLL_MS, MAX_POLL_MS);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      resolve();
    }, ms);

    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function useHeadedAuth() {
  const [flow, setFlow] = useState<AuthFlowState>({ phase: 'idle' });
  const [session, setSession] = useState<AuthSessionState | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const pollAbortRef = useRef<AbortController | null>(null);

  const stopPolling = useCallback(() => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    setIsPolling(false);
  }, []);

  const clearFlowState = useCallback(() => {
    stopPolling();
    setFlow({ phase: 'idle' });
  }, [stopPolling]);

  const logout = useCallback(() => {
    stopPolling();
    setSession(null);
    setFlow({ phase: 'idle' });
  }, [stopPolling]);

  const startLogin = useCallback(async () => {
    stopPolling();
    setFlow({ phase: 'starting' });

    const browserOrigin = window.location.origin;

    try {
      const started = await startHeadedAuth(browserOrigin);
      const nonce = started.challenge.nonce;

      const basePollInterval = started.poll?.intervalMs ?? getDefaultPollIntervalMs();

      setFlow({
        phase: 'pending',
        challenge: started.challenge,
        lightningUri: started.lightningUri,
        expiresAtUnix: started.expires_at,
        pollCount: 0,
        nextPollInMs: basePollInterval,
      });

      const controller = new AbortController();
      pollAbortRef.current = controller;
      setIsPolling(true);

      let pollCount = 0;
      let pendingDelay = basePollInterval;

      while (!controller.signal.aborted) {
        const status = await getHeadedAuthStatus(nonce, browserOrigin);

        if (status.status === 'approved') {
          const approvedState: AuthSessionState = {
            pubkey: status.pubkey,
            expiresAtUnix: status.expires_at,
            approvedAtUnix: status.approved_at,
          };

          setSession(approvedState);
          setFlow({
            phase: 'approved',
            pubkey: status.pubkey,
            expiresAtUnix: status.expires_at,
            approvedAtUnix: status.approved_at,
          });
          stopPolling();
          return;
        }

        if (status.status === 'expired_or_consumed') {
          setFlow({
            phase: 'expired',
            reason: 'Login request expired or was already consumed. Start a new QR challenge.',
          });
          stopPolling();
          return;
        }

        pollCount += 1;
        pendingDelay = pollDelayMs(status.pollAfterMs ?? basePollInterval, pollCount);

        setFlow((prev) => {
          if (prev.phase !== 'pending') {
            return prev;
          }

          return {
            ...prev,
            pollCount,
            nextPollInMs: pendingDelay,
          };
        });

        await sleep(pendingDelay, controller.signal);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unexpected auth error';
      setFlow({ phase: 'error', message });
      stopPolling();
    }
  }, [stopPolling]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    flow,
    session,
    isPolling,
    startLogin,
    clearFlowState,
    logout,
  };
}
