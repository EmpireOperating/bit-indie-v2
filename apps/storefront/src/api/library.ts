import { ApiError, apiClient } from './client';

type Envelope<T> = T & { ok?: boolean };

type EntitlementPathRequirements = {
  query?: string;
  authorizationHeader?: string;
  cookie?: string | null;
  direct?: string[];
};

export type EntitlementPathResponse = Envelope<{
  surface: 'headed' | 'headless';
  mode: 'direct_download' | 'tokenized_access';
  supported: boolean;
  reason?: string;
  fallback?: string;
  endpoint?: string;
  requirements?: EntitlementPathRequirements;
}>;

export type DownloadResolutionResponse = Envelope<{
  downloadUrl: string;
  entitlementMode: string;
  entitlementPath?: {
    mode: string;
    tokenSource: string;
    usedBuyerUserId: boolean;
    usedGuestReceiptCode: boolean;
    supportsTokenizedAccess: boolean;
    supportsDirectDownloadAccess: boolean;
  };
}>;

export type LibraryCredentials = {
  accessToken?: string;
  buyerUserId?: string;
  guestReceiptCode?: string;
};

export async function getEntitlementPath(surface: 'headed' | 'headless', mode: 'direct_download' | 'tokenized_access') {
  return apiClient.get<EntitlementPathResponse>(
    `/storefront/entitlement/path?surface=${surface}&mode=${mode}`,
  );
}

export async function resolveDownloadAccess(releaseId: string, credentials: LibraryCredentials) {
  const params = new URLSearchParams();

  if (credentials.accessToken?.trim()) params.set('accessToken', credentials.accessToken.trim());
  if (credentials.buyerUserId?.trim()) params.set('buyerUserId', credentials.buyerUserId.trim());
  if (credentials.guestReceiptCode?.trim())
    params.set('guestReceiptCode', credentials.guestReceiptCode.trim());

  const queryString = params.toString();
  const path = `/releases/${releaseId}/download${queryString ? `?${queryString}` : ''}`;

  return apiClient.get<DownloadResolutionResponse>(path);
}

export function getApiErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    const details = error.details as { error?: string } | null;
    if (details?.error) return details.error;
    return `${fallbackMessage} (status ${error.status})`;
  }

  if (error instanceof Error && error.message) return error.message;

  return fallbackMessage;
}

export function getApiErrorStatus(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}
