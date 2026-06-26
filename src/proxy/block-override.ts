import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

type OverrideState = 'pending' | 'approved';

interface BlockOverride {
  state: OverrideState;
  expiresAt: number;
}

const OVERRIDE_TTL_MS = 5 * 60 * 1000;
const overrides = new Map<string, BlockOverride>();

function pruneExpired(now = Date.now()): void {
  for (const [token, override] of overrides.entries()) {
    if (override.expiresAt <= now) overrides.delete(token);
  }
}

function requestOrigin(request: FastifyRequest): string {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const scheme = typeof proto === 'string' && proto ? proto : 'http';
  const requestedHost =
    request.headers.host ?? `localhost:${request.server.addresses()[0]?.port ?? 8457}`;
  const host = requestedHost.replace(/^host\.docker\.internal(?=:|$)/, 'localhost');
  return `${scheme}://${host}`;
}

export function createBlockOverrideUrl(request: FastifyRequest): string {
  pruneExpired();
  const token = randomUUID();
  overrides.set(token, { state: 'pending', expiresAt: Date.now() + OVERRIDE_TTL_MS });
  return `${requestOrigin(request)}/truegate/override/${token}`;
}

export function consumeApprovedBlockOverride(): boolean {
  pruneExpired();
  for (const [token, override] of overrides.entries()) {
    if (override.state !== 'approved') continue;
    overrides.delete(token);
    return true;
  }
  return false;
}

export function clearBlockOverrides(): void {
  overrides.clear();
}

export function registerBlockOverrideRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: { token: string } }>('/truegate/override/:token', async (request, reply) => {
    pruneExpired();
    const override = overrides.get(request.params.token);
    if (!override) {
      return reply
        .type('text/html')
        .code(404)
        .send('<!doctype html><title>trueGate override expired</title><h1>Override expired</h1>');
    }

    overrides.set(request.params.token, { ...override, state: 'approved' });
    return reply.type('text/html').send(`<!doctype html>
<title>trueGate override armed</title>
<h1>trueGate override armed</h1>
<p>The next blocked response will be allowed once. Return to your AI client and retry the request.</p>`);
  });
}
