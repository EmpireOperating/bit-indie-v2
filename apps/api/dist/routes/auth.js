import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/secp256k1';
import { prisma } from '../prisma.js';
// --- Types / helpers (keep in sync with Embedded Signer contract) ---
const CHALLENGE_VERSION = 1;
function normalizeOrigin(origin) {
    // Minimal normalization:
    // - require scheme + host
    // - lowercase scheme + host
    // - ensure explicit port
    // NOTE: we intentionally reject paths/query/fragments.
    let url;
    try {
        url = new URL(origin);
    }
    catch {
        throw new Error('Invalid origin');
    }
    if (url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Origin must not include path, query, or fragment');
    }
    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
        throw new Error('Origin protocol must be http or https');
    }
    const port = url.port
        ? Number(url.port)
        : protocol === 'https:'
            ? 443
            : 80;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error('Invalid origin port');
    }
    return `${protocol}//${hostname}:${port}`;
}
function isHex32(v) {
    return /^0x[0-9a-fA-F]{64}$/.test(v);
}
function isHex64(v) {
    return /^0x[0-9a-fA-F]{128}$/.test(v);
}
function canonicalJsonStringify(obj) {
    // Canonical JSON for v1: stable key ordering.
    // This is sufficient for our fixed challenge shape.
    if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
        return JSON.stringify(obj);
    }
    const rec = obj;
    const keys = Object.keys(rec).sort();
    const out = {};
    for (const k of keys)
        out[k] = rec[k];
    return JSON.stringify(out);
}
function sha256Hex(input) {
    const digest = sha256(new TextEncoder().encode(input));
    return `0x${Buffer.from(digest).toString('hex')}`;
}
// --- Schemas ---
const challengeSchema = z.object({
    v: z.literal(CHALLENGE_VERSION),
    origin: z.string().min(1).max(512),
    nonce: z.string().min(1).max(256),
    timestamp: z.number().int().positive(),
});
const challengeReqSchema = z.object({
    origin: z.string().min(1).max(512),
});
const sessionReqSchema = z.object({
    origin: z.string().min(1).max(512),
    pubkey: z.string().min(1).max(256),
    challenge: challengeSchema,
    signature: z.string().min(1).max(512),
    requestedScopes: z.array(z.any()).optional(),
});
export async function registerAuthRoutes(app) {
    // Issue a short-lived challenge.
    app.post('/auth/challenge', async (req, reply) => {
        const parsed = challengeReqSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ ok: false, error: 'Invalid request body', issues: parsed.error.issues });
        }
        let normalizedOrigin;
        try {
            normalizedOrigin = normalizeOrigin(parsed.data.origin);
        }
        catch (e) {
            return reply.status(400).send({ ok: false, error: e.message });
        }
        const nonce = `0x${randomBytes(32).toString('hex')}`;
        const timestamp = Math.floor(Date.now() / 1000);
        const challenge = {
            v: CHALLENGE_VERSION,
            origin: normalizedOrigin,
            nonce,
            timestamp,
        };
        // Persist pending challenge for replay protection.
        // 5 min window.
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await prisma.authChallenge.create({
            data: {
                origin: normalizedOrigin,
                nonce,
                timestamp,
                expiresAt,
            },
        });
        return reply.status(200).send({ ok: true, challenge });
    });
    // Verify signed challenge and issue a session.
    app.post('/auth/session', async (req, reply) => {
        const parsed = sessionReqSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ ok: false, error: 'Invalid request body', issues: parsed.error.issues });
        }
        const { pubkey, signature, challenge } = parsed.data;
        if (!isHex32(pubkey)) {
            return reply.status(400).send({ ok: false, error: 'pubkey must be 0x-prefixed 32-byte hex' });
        }
        if (!isHex64(signature)) {
            return reply.status(400).send({ ok: false, error: 'signature must be 0x-prefixed 64-byte hex' });
        }
        let normalizedOrigin;
        try {
            normalizedOrigin = normalizeOrigin(parsed.data.origin);
        }
        catch (e) {
            return reply.status(400).send({ ok: false, error: e.message });
        }
        if (challenge.origin !== normalizedOrigin) {
            return reply.status(400).send({ ok: false, error: 'Challenge origin mismatch' });
        }
        // Check challenge pending + not expired + not consumed.
        const pending = await prisma.authChallenge.findUnique({
            where: { origin_nonce: { origin: normalizedOrigin, nonce: challenge.nonce } },
        });
        if (!pending) {
            return reply.status(409).send({ ok: false, error: 'Challenge not found (or already used)' });
        }
        if (pending.expiresAt.getTime() < Date.now()) {
            // Best-effort cleanup.
            await prisma.authChallenge.delete({ where: { id: pending.id } });
            return reply.status(409).send({ ok: false, error: 'Challenge expired' });
        }
        // Verify signature.
        const json = canonicalJsonStringify(challenge);
        const hash = sha256Hex(json);
        const sigBytes = Buffer.from(signature.slice(2), 'hex');
        const msgBytes = Buffer.from(hash.slice(2), 'hex');
        const pubBytes = Buffer.from(pubkey.slice(2), 'hex');
        const ok = await schnorr.verify(sigBytes, msgBytes, pubBytes);
        if (!ok) {
            return reply.status(401).send({ ok: false, error: 'Invalid signature' });
        }
        // Consume challenge (replay protection).
        await prisma.authChallenge.delete({ where: { id: pending.id } });
        const ttlSeconds = Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60);
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
        const session = await prisma.apiSession.create({
            data: {
                pubkey,
                origin: normalizedOrigin,
                scopesJson: parsed.data.requestedScopes ?? [],
                expiresAt,
            },
        });
        // Create or ensure user exists.
        await prisma.user.upsert({
            where: { pubkey },
            create: { pubkey },
            update: {},
        });
        // Cookie for browser UX.
        reply.setCookie('bi_session', session.id, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.COOKIE_SECURE === 'true',
        });
        // Bearer token for headless agents.
        // v1: use the session id as an opaque access token.
        const accessToken = session.id;
        return reply.status(201).send({
            ok: true,
            session: {
                id: session.id,
                pubkey: session.pubkey,
                origin: session.origin,
                scopes: session.scopesJson,
                created_at: Math.floor(session.createdAt.getTime() / 1000),
                expires_at: Math.floor(session.expiresAt.getTime() / 1000),
            },
            accessToken,
            tokenType: 'Bearer',
        });
    });
}
