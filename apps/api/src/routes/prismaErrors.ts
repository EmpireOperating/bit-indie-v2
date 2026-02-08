export function mapPrismaWriteError(
  error: unknown,
  messages?: Partial<Record<'P2002' | 'P2003' | 'P2025', string>>,
): { status: number; error: string } | null {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as any).code) : null;

  if (code === 'P2002') {
    return { status: 409, error: messages?.P2002 ?? 'Unique constraint violation' };
  }

  if (code === 'P2003') {
    return { status: 404, error: messages?.P2003 ?? 'Referenced record not found' };
  }

  if (code === 'P2025') {
    return { status: 404, error: messages?.P2025 ?? 'Record not found' };
  }

  return null;
}
