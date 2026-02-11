export type ApiClientOptions = {
  baseUrl?: string;
  token?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export class ApiUnavailableError extends ApiError {
  constructor(message: string, status = 503, details?: unknown) {
    super(message, status, details);
    this.name = 'ApiUnavailableError';
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/api';
    this.token = options.token ?? import.meta.env.VITE_API_TOKEN;
  }

  async get<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new ApiUnavailableError(`API unavailable for ${path}`);
    }

    const maybeJson = await response
      .clone()
      .json()
      .catch(() => null);

    if (!response.ok) {
      if (response.status >= 500) {
        throw new ApiUnavailableError(`API unavailable (${response.status}) for ${path}`, response.status, maybeJson);
      }

      throw new ApiError(`API request failed (${response.status}) for ${path}`, response.status, maybeJson);
    }

    return (await response.json()) as T;
  }
}

export const apiClient = new ApiClient();
