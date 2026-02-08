import { createHash } from 'node:crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
});

export function extForContentType(contentType: string): string {
  return CONTENT_TYPE_EXTENSIONS[contentType] ?? 'bin';
}

function objectKeyHash(kind: 'cover' | 'build', parts: string[]): string {
  return sha256Hex(`${kind}:${parts.join(':')}`);
}

export function makeCoverObjectKey(args: {
  gameId: string;
  contentType: string;
}): string {
  const { gameId, contentType } = args;
  const ext = extForContentType(contentType);
  const keyHash = objectKeyHash('cover', [gameId, contentType]);
  return `covers/${gameId}/${keyHash}.${ext}`;
}

export function makeBuildObjectKey(args: {
  gameId: string;
  releaseVersion: string;
  contentType: string;
}): string {
  const { gameId, releaseVersion, contentType } = args;
  const ext = extForContentType(contentType);
  const keyHash = objectKeyHash('build', [gameId, releaseVersion, contentType]);
  return `builds/${gameId}/${releaseVersion}/${keyHash}.${ext}`;
}

export function isSafeObjectKey(objectKey: string): boolean {
  // Safety net: forbid traversal-ish and path-confusion sequences.
  if (!objectKey) return false;
  if (objectKey.includes('..')) return false;
  if (objectKey.startsWith('/')) return false;
  if (objectKey.includes('\\')) return false;
  if (objectKey.includes('//')) return false;
  if (/[\u0000-\u001F\u007F]/.test(objectKey)) return false;
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
