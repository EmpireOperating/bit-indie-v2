import crypto from 'node:crypto';

export async function recordDownloadEventBestEffort(opts: {
  prisma: {
    downloadEvent: {
      create: (args: {
        data: {
          entitlementId: string;
          releaseId: string;
          ipHash: string;
          userAgent: string | null;
        };
      }) => Promise<unknown>;
    };
  };
  entitlementId: string;
  releaseId: string;
  ipRaw: string;
  userAgentRaw?: string | null;
}) {
  try {
    const ip = opts.ipRaw.trim();
    if (!ip) return;

    const ipHash = crypto.createHash('sha256').update(ip).digest('hex');
    const userAgent = String(opts.userAgentRaw ?? '').slice(0, 512) || null;

    await opts.prisma.downloadEvent.create({
      data: {
        entitlementId: opts.entitlementId,
        releaseId: opts.releaseId,
        ipHash,
        userAgent,
      },
    });
  } catch {
    // best-effort only
  }
}
