/* ── Health check handler (v0.8.6) ── */

import {
  LIVE_SYNC_SAFETY_CAPABILITY_SCHEMA,
  REQUIRED_LIVE_SYNC_SAFETY_CAPABILITIES,
  SERVER_APP_NAME,
  SERVER_BUILD_ID,
  SERVER_VERSION,
} from '../types';
import type { HealthResponse } from '../types';

export function handleHealth(): HealthResponse {
  return {
    ok: true,
    app: SERVER_APP_NAME,
    version: SERVER_VERSION,
    buildId: SERVER_BUILD_ID,
    capabilitySchemaVersion: LIVE_SYNC_SAFETY_CAPABILITY_SCHEMA,
    requiredLiveSyncSafetyCapabilities: REQUIRED_LIVE_SYNC_SAFETY_CAPABILITIES,
  };
}
