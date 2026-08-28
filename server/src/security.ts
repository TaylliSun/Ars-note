import type * as http from 'http';

export type ServerSecurityMode = 'lan' | 'public';

export interface ServerSecurityConfig {
  mode: ServerSecurityMode;
  publicMode: boolean;
  trustProxy: boolean;
  requireHttps: boolean;
  allowApiKeyInQuery: boolean;
  allowedOrigins: string[];
  minApiKeyLength: number;
  authFailureLimit: number;
  authFailureWindowMs: number;
  authBlockMs: number;
  maxWebSocketConnections: number;
  maxWebSocketConnectionsPerIp: number;
  maxWebSocketMessagesPerMinute: number;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseBoundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function isLoopbackBindHost(host: string): boolean {
  const normalized = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.');
}

export function createServerSecurityConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServerSecurityConfig {
  const mode: ServerSecurityMode = String(env.ARS_NOTE_SECURITY_MODE || '').trim().toLowerCase() === 'public'
    ? 'public'
    : 'lan';
  const publicMode = mode === 'public';
  const configuredOrigins = String(env.ARS_NOTE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    mode,
    publicMode,
    trustProxy: parseBoolean(env.ARS_NOTE_TRUST_PROXY, false),
    // Public mode is deliberately fail-closed and cannot opt out of TLS enforcement.
    requireHttps: publicMode || parseBoolean(env.ARS_NOTE_REQUIRE_HTTPS, false),
    allowApiKeyInQuery: !publicMode && parseBoolean(env.ARS_NOTE_ALLOW_API_KEY_IN_QUERY, false),
    allowedOrigins: configuredOrigins.length > 0 ? configuredOrigins : (publicMode ? ['null'] : ['*']),
    minApiKeyLength: parseBoundedInteger(env.ARS_NOTE_MIN_API_KEY_LENGTH, publicMode ? 32 : 16, 16, 256),
    authFailureLimit: parseBoundedInteger(env.ARS_NOTE_AUTH_FAILURE_LIMIT, 8, 3, 100),
    authFailureWindowMs: parseBoundedInteger(env.ARS_NOTE_AUTH_FAILURE_WINDOW_SECONDS, 60, 10, 3600) * 1000,
    authBlockMs: parseBoundedInteger(env.ARS_NOTE_AUTH_BLOCK_SECONDS, 900, 30, 86400) * 1000,
    maxWebSocketConnections: parseBoundedInteger(env.ARS_NOTE_MAX_WS_CONNECTIONS, 200, 2, 10000),
    maxWebSocketConnectionsPerIp: parseBoundedInteger(env.ARS_NOTE_MAX_WS_CONNECTIONS_PER_IP, 16, 1, 1000),
    maxWebSocketMessagesPerMinute: parseBoundedInteger(env.ARS_NOTE_MAX_WS_MESSAGES_PER_MINUTE, 1200, 60, 100000),
  };
}

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').split(',')[0].trim();
}

export function getClientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = firstHeaderValue(req.headers['x-forwarded-for']);
    if (forwarded) return forwarded.slice(0, 128);
  }
  return String(req.socket.remoteAddress || 'unknown').slice(0, 128);
}

export function isSecureRequest(req: http.IncomingMessage, trustProxy: boolean): boolean {
  if ((req.socket as http.IncomingMessage['socket'] & { encrypted?: boolean }).encrypted) return true;
  if (!trustProxy) return false;
  return firstHeaderValue(req.headers['x-forwarded-proto']).toLowerCase() === 'https';
}

function requestOrigin(req: http.IncomingMessage, trustProxy: boolean): string {
  const host = trustProxy
    ? (firstHeaderValue(req.headers['x-forwarded-host']) || firstHeaderValue(req.headers.host))
    : firstHeaderValue(req.headers.host);
  if (!host) return '';
  const protocol = isSecureRequest(req, trustProxy) ? 'https' : 'http';
  return `${protocol}://${host}`;
}

/**
 * Returns the Access-Control-Allow-Origin value, undefined when no Origin was
 * sent, or null when a browser origin must be rejected.
 */
export function resolveCorsOrigin(
  req: http.IncomingMessage,
  config: ServerSecurityConfig,
): string | null | undefined {
  const origin = firstHeaderValue(req.headers.origin);
  if (!origin) return undefined;
  if (config.allowedOrigins.includes('*')) return '*';
  if (config.allowedOrigins.includes(origin)) return origin;
  if (origin === requestOrigin(req, config.trustProxy)) return origin;
  return null;
}

export function applySecurityHeaders(
  res: http.ServerResponse,
  options: { html: boolean; secure: boolean },
): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader(
    'Content-Security-Policy',
    options.html
      ? "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:"
      : "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  if (options.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

interface AuthFailureState {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
  lastSeenAt: number;
}

export class AuthFailureLimiter {
  private readonly entries = new Map<string, AuthFailureState>();
  private operations = 0;

  constructor(
    private readonly failureLimit: number,
    private readonly windowMs: number,
    private readonly blockMs: number,
  ) {}

  retryAfterSeconds(key: string, now = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry || entry.blockedUntil <= now) return 0;
    return Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000));
  }

  recordFailure(key: string, now = Date.now()): number {
    this.pruneOccasionally(now);
    const previous = this.entries.get(key);
    const current: AuthFailureState = !previous || now - previous.windowStartedAt > this.windowMs
      ? { failures: 0, windowStartedAt: now, blockedUntil: 0, lastSeenAt: now }
      : previous;
    current.failures += 1;
    current.lastSeenAt = now;
    if (current.failures >= this.failureLimit) {
      current.blockedUntil = Math.max(current.blockedUntil, now + this.blockMs);
    }
    this.entries.set(key, current);
    return this.retryAfterSeconds(key, now);
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  private pruneOccasionally(now: number): void {
    this.operations += 1;
    if (this.operations % 256 !== 0 && this.entries.size < 10000) return;
    const staleBefore = now - Math.max(this.windowMs, this.blockMs) * 2;
    for (const [key, entry] of this.entries) {
      if (entry.blockedUntil <= now && entry.lastSeenAt < staleBefore) this.entries.delete(key);
    }
  }
}

export function describeSecurityConfig(config: ServerSecurityConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    httpsRequired: config.requireHttps,
    trustedProxy: config.trustProxy,
    apiKeyInQueryAllowed: config.allowApiKeyInQuery,
    minimumApiKeyLength: config.minApiKeyLength,
    corsPolicy: config.allowedOrigins.includes('*') ? 'wildcard' : 'allowlist',
    authRateLimitEnabled: true,
    connectionLimitsEnabled: true,
    messageRateLimitEnabled: true,
  };
}
