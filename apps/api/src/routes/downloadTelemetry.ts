import crypto from 'node:crypto';

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

function normalizeUserAgent(userAgentRaw?: string | null): string | null {
  return String(userAgentRaw ?? '').slice(0, 512) || null;
}

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

    const ipHash = hashIp(ip);
    const userAgent = normalizeUserAgent(opts.userAgentRaw);

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
