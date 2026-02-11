const DEFAULT_POLL_INTERVAL_MS = 1_500;

type ApiEnvelope<T> = T & {
  ok?: boolean;
  error?: string;
};

export type AuthChallenge = {
  v: number;
  origin: string;
  nonce: string;
  timestamp: number;
};

export type HeadedAuthStartResponse = {
  contractVersion: string;
  challenge: AuthChallenge;
  challengeTtlSeconds: number;
  expires_at: number;
  lightningUri: string;
  poll?: {
    endpoint?: string;
    intervalMs?: number;
    statusValues?: string[];
  };
};

export type HeadedAuthStatusResponse =
  | {
      status: 'pending';
      pollAfterMs?: number;
    }
  | {
      status: 'approved';
      accessToken: string;
      tokenType: 'Bearer';
      pubkey: string;
      approved_at: number;
      expires_at: number;
    }
  | {
      status: 'expired_or_consumed';
    };

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api';

function buildUrl(path: string): string {
  return `${baseUrl}${path}`;
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const raw = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || raw.ok === false) {
    const message = raw.error ?? `Auth request failed (${response.status})`;
    throw new Error(message);
  }

  return raw as T;
}

export async function startHeadedAuth(origin: string): Promise<HeadedAuthStartResponse> {
  const response = await fetch(buildUrl('/auth/qr/start'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ origin }),
  });

  return parseJsonOrThrow<HeadedAuthStartResponse>(response);
}

export async function getHeadedAuthStatus(nonce: string, origin: string): Promise<HeadedAuthStatusResponse> {
  const params = new URLSearchParams({ origin });
  const response = await fetch(buildUrl(`/auth/qr/status/${nonce}?${params.toString()}`), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return parseJsonOrThrow<HeadedAuthStatusResponse>(response);
}

export function getDefaultPollIntervalMs(): number {
  return DEFAULT_POLL_INTERVAL_MS;
}
