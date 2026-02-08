import { describe, expect, it } from 'vitest';
import { extForContentType, makeBuildObjectKey } from './storageKeys.js';

describe('storageKeys', () => {
  it('maps application/x-zip-compressed to zip extension', () => {
    expect(extForContentType('application/x-zip-compressed')).toBe('zip');
  });

  it('generates build keys with .zip for x-zip-compressed uploads', () => {
    const key = makeBuildObjectKey({
      gameId: '11111111-1111-4111-8111-111111111111',
      releaseVersion: '1.0.0',
      contentType: 'application/x-zip-compressed',
    });

    expect(key.startsWith('builds/11111111-1111-4111-8111-111111111111/1.0.0/')).toBe(true);
    expect(key.endsWith('.zip')).toBe(true);
  });
});
