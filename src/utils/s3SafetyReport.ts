/* ── S3 Safety Report (v0.5.5) ── */

import type { S3CredentialStatus, S3ConnectionTestResult } from '../types';

export interface S3SafetyReport {
  provider: 's3';
  credentialsStoredOnDisk: false;
  secretInSyncConfig: false;
  hasRuntimeCredentials: boolean;
  lastConnectionTestOk: boolean | null;
  secretHidden: true;
  notes: string[];
}

/**
 * Build a safety report for display in UI.
 * Does NOT include any secrets.
 */
export function buildS3SafetyReport(
  credentialStatus: S3CredentialStatus | null,
  connectionTest: S3ConnectionTestResult | null,
): S3SafetyReport {
  const notes: string[] = [];

  if (!credentialStatus || !credentialStatus.hasCredentials) {
    notes.push('No runtime credentials set.');
  } else {
    notes.push('Credentials stored in memory only.');
    notes.push('Secret is not written to sync.json, manifest, or remote-index.');
  }

  if (connectionTest) {
    if (connectionTest.ok) {
      notes.push('Last connection test passed.');
    } else {
      notes.push('Last connection test failed.');
      if (connectionTest.errors.length > 0) {
        notes.push(`Errors: ${connectionTest.errors.join(', ')}`);
      }
    }
  } else {
    notes.push('No connection test run yet.');
  }

  return {
    provider: 's3',
    credentialsStoredOnDisk: false,
    secretInSyncConfig: false,
    hasRuntimeCredentials: credentialStatus?.hasCredentials ?? false,
    lastConnectionTestOk: connectionTest?.ok ?? null,
    secretHidden: true,
    notes,
  };
}
