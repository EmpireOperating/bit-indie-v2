import { createHash } from 'node:crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function extForContentType(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'application/zip') return 'zip';
  return 'bin';
}

export function makeCoverObjectKey(args: {
  gameId: string;
  contentType: string;
}): string {
  const { gameId, contentType } = args;
  const ext = extForContentType(contentType);
  const keyHash = sha256Hex(`cover:${gameId}:${contentType}`);
  return `covers/${gameId}/${keyHash}.${ext}`;
}

export function makeBuildObjectKey(args: {
  gameId: string;
  releaseVersion: string;
  contentType: string;
}): string {
  const { gameId, releaseVersion, contentType } = args;
  const ext = extForContentType(contentType);
  const keyHash = sha256Hex(`build:${gameId}:${releaseVersion}:${contentType}`);
  return `builds/${gameId}/${releaseVersion}/${keyHash}.${ext}`;
}

export function isSafeObjectKey(objectKey: string): boolean {
  // Very small safety net: forbid traversal-ish sequences.
  if (objectKey.includes('..')) return false;
  if (objectKey.startsWith('/')) return false;
  return true;
}

export function assertPrefix(objectKey: string, prefix: string): void {
  if (!objectKey.startsWith(prefix)) {
    throw new Error(`objectKey must start with ${prefix}`);
  }
  if (!isSafeObjectKey(objectKey)) {
    throw new Error('objectKey failed safety checks');
  }
}
