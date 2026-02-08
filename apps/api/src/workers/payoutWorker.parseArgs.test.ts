import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('payoutWorker parseArgs', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects fractional --limit values', async () => {
    vi.doMock('../prisma.js', () => ({ prisma: {} }));
    vi.doMock('../payouts/opennode.js', () => ({ opennodeSendToLnAddress: vi.fn() }));

    const mod = await import('./payoutWorker.js');

    expect(() => mod.parseArgs(['--limit', '2.5'])).toThrow(/Invalid --limit/);
    expect(() => mod.parseArgs(['--limit', '501'])).toThrow(/max 500/);
    expect(mod.parseArgs(['--limit', '3']).limit).toBe(3);
    expect(mod.parseArgs(['--limit=4', '--dry-run'])).toMatchObject({ limit: 4, dryRun: true });
  });

  it('rejects unknown args so typoed flags do not silently noop', async () => {
    vi.doMock('../prisma.js', () => ({ prisma: {} }));
    vi.doMock('../payouts/opennode.js', () => ({ opennodeSendToLnAddress: vi.fn() }));

    const mod = await import('./payoutWorker.js');

    expect(() => mod.parseArgs(['--dryrun'])).toThrow(/Unknown argument/);
  });
});
