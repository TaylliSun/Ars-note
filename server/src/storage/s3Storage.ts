/* ── S3 / MinIO storage backend (v0.8.6) ── */
/* Uses AWS Signature V4 with Node.js built-in http/https + crypto */
/* Zero external dependencies */

import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import { URL } from 'url';
import type { StoredVault, StoredBackupMeta, BackupListItem } from '../types';
import type { StorageBackend, BackupListItemWithVault, VaultDeleteResult } from './storageTypes';
import { sanitizeRelativePath } from './localStorage';

/* ── Configuration ── */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/* ── AWS Signature V4 ── */

function hmacSha256(key: Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate AWS Signature V4 for an S3 request.
 * Returns headers to add to the request.
 */
function signV4(
  method: string,
  url: URL,
  headers: Record<string, string>,
  body: string | Buffer,
  config: S3Config,
): Record<string, string> {
  const service = 's3';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.substring(0, 8);

  const payloadHash = sha256Hex(body);

  /* Canonical headers must be sorted */
  const signedHeaderKeys = ['host', 'x-amz-content-sha256', 'x-amz-date'];
  const canonicalHeaders =
    `host:${url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = signedHeaderKeys.join(';');

  const canonicalUri = url.pathname;
  const canonicalQuerystring = url.search ? url.search.substring(1) : '';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${config.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  let signingKey = hmacSha256(Buffer.from('AWS4' + config.secretAccessKey), dateStamp);
  signingKey = hmacSha256(signingKey, config.region);
  signingKey = hmacSha256(signingKey, service);
  signingKey = hmacSha256(signingKey, 'aws4_request');

  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    'Authorization': authHeader,
  };
}

/* ── S3 HTTP helpers ── */

function makeS3Request(
  method: string,
  config: S3Config,
  objectKey: string,
  body?: string | Buffer,
  query?: string,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    let baseEndpoint = config.endpoint.replace(/\/+$/, '');
    let path: string;

    if (config.forcePathStyle) {
      /* Path-style: http://endpoint/bucket/key */
      path = '/' + config.bucket + '/' + objectKey;
    } else {
      /* Virtual-hosted-style: http://bucket.endpoint/key */
      const urlObj = new URL(baseEndpoint);
      urlObj.hostname = config.bucket + '.' + urlObj.hostname;
      baseEndpoint = urlObj.toString().replace(/\/+$/, '');
      path = '/' + objectKey;
    }

    if (query) {
      path += (path.includes('?') ? '&' : '?') + query;
    }

    const fullUrl = new URL(path, baseEndpoint);
    const isHttps = fullUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const bodyData = body || '';
    const authHeaders = signV4(method, fullUrl, {}, bodyData, config);

    const options: http.RequestOptions = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (isHttps ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      method,
      headers: {
        ...authHeaders,
        'Content-Length': Buffer.byteLength(bodyData),
      },
    };

    const req = httpModule.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8');
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') respHeaders[k] = v;
          else if (Array.isArray(v)) respHeaders[k] = v.join(', ');
        }
        resolve({ status: res.statusCode || 0, body: responseBody, headers: respHeaders });
      });
    });

    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function xmlTagText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1] ? decodeXmlText(match[1]) : '';
}

/* ── S3StorageBackend ── */

export class S3StorageBackend implements StorageBackend {
  private config: S3Config;
  private indexKey = 'remote-index.json';
  private indexCache: Record<string, StoredVault> = {};

  constructor(config: S3Config) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    /* Ensure bucket exists by attempting to list — create if needed */
    try {
      const result = await makeS3Request('GET', this.config, '', undefined, 'list-type=2&max-keys=1');
      if (result.status === 404) {
        /* Bucket doesn't exist, try to create */
        await makeS3Request('PUT', this.config, '');
        console.log(`Created S3 bucket: ${this.config.bucket}`);
      } else if (result.status === 200) {
        /* Bucket exists */
      } else if (result.status === 403) {
        console.warn(`S3: Access denied to bucket "${this.config.bucket}". Ensure credentials are correct.`);
      }
    } catch (err: any) {
      console.error('S3 initialization error:', err.message);
    }

    /* Load existing index */
    await this.loadIndex();
  }

  /* ── Index management (remote-index.json in S3) ── */

  private async loadIndex(): Promise<void> {
    try {
      const result = await makeS3Request('GET', this.config, this.indexKey);
      if (result.status === 200) {
        this.indexCache = JSON.parse(result.body) as Record<string, StoredVault>;
      }
    } catch { /* empty index */ }
  }

  private async saveIndex(): Promise<void> {
    const body = JSON.stringify(this.indexCache, null, 2);
    await makeS3Request('PUT', this.config, this.indexKey, body);
  }

  /* ── Vault operations ── */

  async registerVault(vaultId: string, vaultName: string, clientId?: string): Promise<StoredVault> {
    /* Check existing */
    for (const [, vault] of Object.entries(this.indexCache)) {
      if (vault.vaultId === vaultId) {
        vault.vaultName = vaultName;
        if (clientId) vault.clientId = clientId;
        await this.saveIndex();
        return vault;
      }
    }

    const serverVaultId = 'sv_' + crypto.randomUUID().replace(/-/g, '').substring(0, 12);
    const entry: StoredVault = {
      serverVaultId,
      vaultId,
      vaultName,
      clientId,
      registeredAt: new Date().toISOString(),
    };

    this.indexCache[serverVaultId] = entry;
    await this.saveIndex();
    return entry;
  }

  vaultExists(vaultId: string): boolean {
    return Object.values(this.indexCache).some(v => v.vaultId === vaultId);
  }

  async listVaults(): Promise<StoredVault[]> {
    return Object.values(this.indexCache).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
  }

  async deleteVault(vaultId: string): Promise<VaultDeleteResult> {
    const found = Object.entries(this.indexCache).find(
      ([key, vault]) => key === vaultId || vault.vaultId === vaultId || vault.serverVaultId === vaultId,
    );

    if (!found) {
      return {
        deleted: false,
        vaultId,
        serverVaultId: vaultId,
        backupsDeleted: false,
        liveDeleted: false,
        vaultRecordDeleted: false,
      };
    }

    const [indexKey, vault] = found;
    const backupPrefixes = uniqueStrings([
      `backups/${vault.serverVaultId}/`,
      `backups/${vault.vaultId}/`,
    ]);
    const livePrefixes = uniqueStrings([
      `live/${vault.vaultId}/`,
      `live/${vault.serverVaultId}/`,
    ]);
    const vaultPrefixes = uniqueStrings([
      `vaults/${vault.serverVaultId}/`,
      `vaults/${vault.vaultId}/`,
    ]);

    const backupsDeleted = await this.deletePrefixes(backupPrefixes);
    const liveDeleted = await this.deletePrefixes(livePrefixes);
    await this.deletePrefixes(vaultPrefixes);

    delete this.indexCache[indexKey];
    await this.saveIndex();

    return {
      deleted: true,
      vaultId: vault.vaultId,
      serverVaultId: vault.serverVaultId,
      vaultName: vault.vaultName,
      backupsDeleted,
      liveDeleted,
      vaultRecordDeleted: true,
    };
  }

  /* ── Backup metadata (stored as JSON in S3) ── */

  async renameVault(vaultId: string, newVaultName: string): Promise<StoredVault | null> {
    const cleanName = String(newVaultName || '').trim();
    if (!cleanName) {
      throw new Error('InvalidVaultName: new vault name is empty');
    }

    const found = Object.entries(this.indexCache).find(
      ([key, vault]) => key === vaultId || vault.vaultId === vaultId || vault.serverVaultId === vaultId,
    );
    if (!found) return null;

    const [, vault] = found;
    vault.vaultName = cleanName;
    await this.saveIndex();
    return vault;
  }

  async storeBackupMeta(meta: StoredBackupMeta): Promise<void> {
    const key = `backups/${meta.vaultId}/${meta.backupId}/backup-meta.json`;
    const body = JSON.stringify(meta, null, 2);
    await makeS3Request('PUT', this.config, key, body);
  }

  async backupMetaExists(vaultId: string, backupId: string): Promise<boolean> {
    const key = `backups/${vaultId}/${backupId}/backup-meta.json`;
    const result = await makeS3Request('HEAD', this.config, key);
    return result.status === 200;
  }

  async getBackupMeta(vaultId: string, backupId: string): Promise<StoredBackupMeta | null> {
    const key = `backups/${vaultId}/${backupId}/backup-meta.json`;
    const result = await makeS3Request('GET', this.config, key);
    if (result.status !== 200) return null;
    try {
      return JSON.parse(result.body) as StoredBackupMeta;
    } catch { return null; }
  }

  async listBackups(vaultId: string): Promise<BackupListItem[]> {
    const prefix = `backups/${vaultId}/`;
    const results: BackupListItem[] = [];

    try {
      const result = await makeS3Request(
        'GET', this.config, '',
        undefined,
        `list-type=2&prefix=${encodeURIComponent(prefix)}&delimiter=/`,
      );

      if (result.status !== 200) return results;

      /* Parse XML response to find backup directories */
      const commonPrefixes = result.body.match(/<Prefix>([^<]+)<\/Prefix>/g) || [];
      for (const prefixTag of commonPrefixes) {
        const match = prefixTag.match(/<Prefix>([^<]+)<\/Prefix>/);
        if (!match) continue;

        /* Extract backupId from prefix like "backups/sv_xxx/backup-001/" */
        const parts = match[1].replace(/\/$/, '').split('/');
        const backupId = parts[parts.length - 1];
        if (!backupId) continue;

        /* Load meta for this backup */
        const meta = await this.getBackupMeta(vaultId, backupId);
        if (meta) {
          results.push({
            backupId: meta.backupId,
            uploadedAt: meta.uploadedAt,
            fileCount: meta.fileCount,
            totalSize: meta.totalSize,
            manifestHash: meta.manifestHash,
          });
        }
      }
    } catch { /* ignore errors */ }

    results.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return results;
  }

  async listAllBackups(): Promise<BackupListItemWithVault[]> {
    const results: BackupListItemWithVault[] = [];

    for (const vault of Object.values(this.indexCache)) {
      const backups = await this.listBackups(vault.serverVaultId);
      for (const backup of backups) {
        results.push({
          ...backup,
          vaultId: vault.vaultId,
          vaultName: vault.vaultName,
        });
      }
    }

    results.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return results;
  }

  /* ── File operations ── */

  async deleteBackup(vaultId: string, backupId: string): Promise<boolean> {
    if (!/^[a-zA-Z0-9_-]+$/.test(backupId)) {
      throw new Error('Invalid backupId format');
    }

    return this.deletePrefixes([`backups/${vaultId}/${backupId}/`]);
  }

  async storeFile(vaultId: string, backupId: string, relativePath: string, content: Buffer): Promise<void> {
    const sanitized = sanitizeRelativePath(relativePath);
    const key = `backups/${vaultId}/${backupId}/${sanitized}`;
    await makeS3Request('PUT', this.config, key, content);
  }

  async readFile(vaultId: string, backupId: string, relativePath: string): Promise<Buffer | null> {
    const sanitized = sanitizeRelativePath(relativePath);
    const key = `backups/${vaultId}/${backupId}/${sanitized}`;
    const result = await makeS3Request('GET', this.config, key);
    if (result.status !== 200) return null;
    return Buffer.from(result.body, 'utf-8');
  }

  async fileExists(vaultId: string, backupId: string, relativePath: string): Promise<boolean> {
    const sanitized = sanitizeRelativePath(relativePath);
    const key = `backups/${vaultId}/${backupId}/${sanitized}`;
    const result = await makeS3Request('HEAD', this.config, key);
    return result.status === 200;
  }

  private async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken = '';

    do {
      const query = [
        'list-type=2',
        `prefix=${encodeURIComponent(prefix)}`,
        continuationToken ? `continuation-token=${encodeURIComponent(continuationToken)}` : '',
      ].filter(Boolean).join('&');
      const result = await makeS3Request('GET', this.config, '', undefined, query);
      if (result.status !== 200) return keys;

      const contentsMatches = result.body.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
      for (const block of contentsMatches) {
        const key = xmlTagText(block, 'Key');
        if (key) keys.push(key);
      }

      const isTruncated = xmlTagText(result.body, 'IsTruncated').toLowerCase() === 'true';
      continuationToken = isTruncated ? xmlTagText(result.body, 'NextContinuationToken') : '';
    } while (continuationToken);

    return keys;
  }

  private async deletePrefixes(prefixes: string[]): Promise<boolean> {
    let deletedAny = false;
    for (const prefix of prefixes) {
      const keys = await this.listKeys(prefix);
      for (const key of keys) {
        await makeS3Request('DELETE', this.config, key);
        deletedAny = true;
      }
    }
    return deletedAny;
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
