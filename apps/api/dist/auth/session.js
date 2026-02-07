import { prisma } from '../prisma.js';
export async function getSessionById(sessionId) {
    return prisma.apiSession.findUnique({ where: { id: sessionId } });
}
export async function requireSession(req, reply) {
    const authz = String(req.headers.authorization ?? '').trim();
    let sessionId = null;
    if (authz.toLowerCase().startsWith('bearer ')) {
        sessionId = authz.slice('bearer '.length).trim();
    }
    else if (typeof req.cookies?.bi_session === 'string') {
        sessionId = req.cookies.bi_session;
    }
    if (!sessionId) {
        reply.status(401).send({ ok: false, error: 'Unauthorized' });
        return null;
    }
    const session = await getSessionById(sessionId);
    if (!session) {
        reply.status(401).send({ ok: false, error: 'Invalid session' });
        return null;
    }
    if (session.expiresAt.getTime() < Date.now()) {
        reply.status(401).send({ ok: false, error: 'Session expired' });
        return null;
    }
    return session;
}
