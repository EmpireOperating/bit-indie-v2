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

function extensionFor(contentType: string): string | undefined {
  return CONTENT_TYPE_EXTENSIONS[contentType];
}

export function extForContentType(contentType: string): string {
  return extensionFor(contentType) ?? 'bin';
}

function objectKeyHash(kind: 'cover' | 'build', parts: string[]): string {
  return sha256Hex(`${kind}:${parts.join(':')}`);
}

function objectKeyPrefix(kind: 'cover' | 'build', gameId: string): string {
  return kind === 'cover' ? `covers/${gameId}` : `builds/${gameId}`;
}

function objectKeyFilename(kind: 'cover' | 'build', parts: string[], ext: string): string {
  return `${objectKeyHash(kind, parts)}.${ext}`;
}

export function makeCoverObjectKey(args: {
  gameId: string;
  contentType: string;
}): string {
  const { gameId, contentType } = args;
  const ext = extForContentType(contentType);
  const filename = objectKeyFilename('cover', [gameId, contentType], ext);
  return `${objectKeyPrefix('cover', gameId)}/${filename}`;
}

export function makeBuildObjectKey(args: {
  gameId: string;
  releaseVersion: string;
  contentType: string;
}): string {
  const { gameId, releaseVersion, contentType } = args;
  const ext = extForContentType(contentType);
  const filename = objectKeyFilename('build', [gameId, releaseVersion, contentType], ext);
  return `${objectKeyPrefix('build', gameId)}/${releaseVersion}/${filename}`;
}

function hasUnsafeObjectKeyChars(objectKey: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(objectKey);
}

function hasPathConfusionSegments(objectKey: string): boolean {
  return objectKey.includes('..') || objectKey.startsWith('/') || objectKey.includes('\\') || objectKey.includes('//');
}

export function isSafeObjectKey(objectKey: string): boolean {
  // Safety net: forbid traversal-ish and path-confusion sequences.
  if (!objectKey) return false;
  if (hasPathConfusionSegments(objectKey)) return false;
  if (hasUnsafeObjectKeyChars(objectKey)) return false;
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
