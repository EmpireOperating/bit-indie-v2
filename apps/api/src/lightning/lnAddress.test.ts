import { describe, expect, it, vi } from 'vitest';
import { fetchLnurlPayParams } from './lnAddress.js';

describe('lnAddress', () => {
  it('rejects LNURLp payload when minSendable > maxSendable', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        callback: 'https://pay.example.test/cb',
        tag: 'payRequest',
        minSendable: 2000,
        maxSendable: 1000,
      }),
    }));

    vi.stubGlobal('fetch', fetchMock as any);

    await expect(fetchLnurlPayParams('alice@example.com')).rejects.toThrow(
      'LNURLp invalid sendable bounds',
    );
  });

  it('rejects LNURLp payload when callback protocol is not http/https', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        callback: 'ftp://pay.example.test/cb',
        tag: 'payRequest',
        minSendable: 1000,
        maxSendable: 2000,
      }),
    }));

    vi.stubGlobal('fetch', fetchMock as any);

    await expect(fetchLnurlPayParams('alice@example.com')).rejects.toThrow(
      'Unsupported URL protocol',
    );
  });
});
