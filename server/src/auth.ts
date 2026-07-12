/* ── API Key Authentication (v0.8.6) ── */

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
  return process.env.ARS_NOTE_SERVER_API_KEY;
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

  /* Try Authorization: Bearer <key> */
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string') {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1] === configuredKey) {
      return AUTH_OK;
    }
  }

  /* Try x-ars-note-api-key header */
  const customHeader = req.headers['x-ars-note-api-key'];
  if (typeof customHeader === 'string' && customHeader === configuredKey) {
    return AUTH_OK;
  }

  return {
    ok: false,
    statusCode: 401,
    error: 'Unauthorized: valid API key required',
  };
}
