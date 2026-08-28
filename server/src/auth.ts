/* ── API Key Authentication (v0.8.6) ── */

import * as crypto from 'crypto';
import type * as http from 'http';

export interface AuthResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
}

const AUTH_OK: AuthResult = { ok: true };

/**
 * Get the server API key from environment variable.
 * Returns undefined if no key is configured (dev mode).
 */
export function getServerApiKey(): string | undefined {
  return process.env.ARS_NOTE_SERVER_API_KEY || undefined;
}

function secretDigest(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

/** Compare secrets without leaking matching-prefix or length timing. */
export function isValidServerApiKey(candidate: unknown): boolean {
  const configuredKey = getServerApiKey();
  if (!configuredKey || typeof candidate !== 'string' || !candidate) return false;
  return crypto.timingSafeEqual(secretDigest(candidate), secretDigest(configuredKey));
}

export function getRequestApiKey(req: http.IncomingMessage): string {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (match) return match[1];
  }
  const customHeader = req.headers['x-ars-note-api-key'];
  return typeof customHeader === 'string' ? customHeader : '';
}

/**
 * Check whether the server is running in dev mode (no API key required).
 */
export function isDevMode(): boolean {
  return !getServerApiKey();
}

/**
 * Validate an incoming request against the configured API key.
 *
 * Accepts either:
 *   Authorization: Bearer <apiKey>
 *   x-ars-note-api-key: <apiKey>
 *
 * Returns AuthResult with ok=true if authenticated (or dev mode).
 * Returns AuthResult with ok=false + statusCode + error if rejected.
 */
export function requireApiKey(req: http.IncomingMessage): AuthResult {
  const configuredKey = getServerApiKey();

  /* Dev mode: no key configured, allow all requests */
  if (!configuredKey) {
    return AUTH_OK;
  }

  if (isValidServerApiKey(getRequestApiKey(req))) return AUTH_OK;

  return {
    ok: false,
    statusCode: 401,
    error: 'Unauthorized: valid API key required',
  };
}
