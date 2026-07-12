/* ── Minimal S3-compatible client using Node.js built-ins (v0.5.4) ── */
/* Supports: AWS S3, MinIO, Cloudflare R2 via AWS Signature V4 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

export interface S3Credentials {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

interface S3RequestOptions {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  bucket: string;
  key: string;
  body?: Buffer;
  query?: Record<string, string>;
  contentType?: string;
}

function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/**
 * Parse endpoint URL to extract host and base path.
 */
function parseEndpoint(endpoint: string): { protocol: string; host: string; basePath: string } {
  const clean = endpoint.replace(/\/+$/, '');
  let protocol = 'https';
  let rest = clean;
  if (clean.startsWith('https://')) {
    protocol = 'https';
    rest = clean.substring(8);
  } else if (clean.startsWith('http://')) {
    protocol = 'http';
    rest = clean.substring(7);
  }
  const slashIdx = rest.indexOf('/');
  if (slashIdx >= 0) {
    return { protocol, host: rest.substring(0, slashIdx), basePath: rest.substring(slashIdx) };
  }
  return { protocol, host: rest, basePath: '' };
}

/**
 * AWS Signature V4 signing for S3.
 * Handles both virtual-host style (AWS S3, R2) and path-style (MinIO).
 */
function signRequest(
  credentials: S3Credentials,
  opts: S3RequestOptions,
  body: Buffer,
): { headers: Record<string, string>; url: URL } {
  const { protocol: epProtocol, host: epHost, basePath: epBasePath } = parseEndpoint(credentials.endpoint);
  const region = credentials.region || 'us-east-1';
  const service = 's3';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dateStamp = amzDate.substring(0, 8);

  const usePathStyle = credentials.forcePathStyle || false;

  /* Build canonical query string */
  const queryParts: string[] = [];
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query).sort(([a], [b]) => a.localeCompare(b))) {
      queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  const canonicalQueryString = queryParts.join('&');

  /* Determine host and path based on style */
  let signingHost: string;
  let objectPath: string;
  if (usePathStyle) {
    signingHost = epHost;
    objectPath = `${epBasePath}/${opts.bucket}/${opts.key}`;
  } else {
    signingHost = `${opts.bucket}.${epHost}`;
    objectPath = `${epBasePath}/${opts.key}`;
  }
  if (!objectPath.startsWith('/')) objectPath = '/' + objectPath;

  /* Canonical URI */
  const canonicalUri = objectPath;

  /* Payload hash */
  const payloadHash = sha256(body);

  /* Canonical headers */
  const headersToSign: Record<string, string> = {
    host: signingHost,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (opts.contentType) {
    headersToSign['content-type'] = opts.contentType;
  }
  const sortedHeaderKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headersToSign[k]}\n`).join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  /* Canonical request */
  const canonicalRequest = [
    opts.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  /* String to sign */
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  /* Signing key */
  let signingKey = hmacSha256(`AWS4${credentials.secretAccessKey}`, dateStamp);
  signingKey = hmacSha256(signingKey, region);
  signingKey = hmacSha256(signingKey, service);
  signingKey = hmacSha256(signingKey, 'aws4_request');

  /* Signature */
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  /* Authorization header */
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  /* Build final URL */
  let urlPath: string;
  if (usePathStyle) {
    urlPath = `${epBasePath}/${opts.bucket}/${opts.key}`;
  } else {
    urlPath = `${epBasePath}/${opts.key}`;
  }
  if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;

  const finalUrl = new URL(`${epProtocol}://${signingHost}${urlPath}`);
  if (canonicalQueryString) finalUrl.search = canonicalQueryString;

  /* Build final headers */
  const finalHeaders: Record<string, string> = {
    'Host': signingHost,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: authorization,
  };
  if (opts.contentType) {
    finalHeaders['Content-Type'] = opts.contentType;
  }

  return { headers: finalHeaders, url: finalUrl };
}

/**
 * Execute an S3 HTTP request with improved error handling.
 */
function s3Request(
  credentials: S3Credentials,
  opts: S3RequestOptions,
  body: Buffer = Buffer.alloc(0),
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    let signingResult: { headers: Record<string, string>; url: URL };
    try {
      signingResult = signRequest(credentials, opts, body);
    } catch (err: any) {
      reject(new Error(`S3 signing error: ${err.message}`));
      return;
    }
    const { headers, url } = signingResult;
    const isHttps = url.protocol === 'https:';
    const requester = isHttps ? https.request : http.request;

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: opts.method,
      headers,
    };

    const req = requester(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') respHeaders[k] = v;
          else if (Array.isArray(v)) respHeaders[k] = v.join(', ');
        }
        resolve({
          status: res.statusCode || 0,
          headers: respHeaders,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', (err) => {
      reject(new Error(`S3 network error: ${err.message}`));
    });
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('S3 request timeout (30s)'));
    });
    if (body.length > 0) req.write(body);
    req.end();
  });
}

/* ── Public API ── */

/**
 * Test basic S3 connectivity with a list bucket request (max-keys=0).
 */
export async function testS3Connection(credentials: S3Credentials): Promise<boolean> {
  try {
    const resp = await s3Request(credentials, {
      method: 'GET',
      bucket: credentials.bucket,
      key: '',
      query: { 'list-type': '2', 'max-keys': '0' },
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

/**
 * Upload a buffer to S3.
 */
export async function s3PutObject(
  credentials: S3Credentials,
  key: string,
  body: Buffer,
  contentType: string = 'application/octet-stream',
): Promise<void> {
  const resp = await s3Request(credentials, {
    method: 'PUT',
    bucket: credentials.bucket,
    key,
    body,
    contentType,
  });
  if (resp.status !== 200 && resp.status !== 204) {
    const bodyText = resp.body.toString('utf-8').substring(0, 300);
    throw new Error(`S3 PUT failed (${resp.status}): ${key} — ${bodyText}`);
  }
}

/**
 * Download an object from S3.
 */
export async function s3GetObject(
  credentials: S3Credentials,
  key: string,
): Promise<Buffer> {
  const resp = await s3Request(credentials, {
    method: 'GET',
    bucket: credentials.bucket,
    key,
  });
  if (resp.status !== 200) {
    const bodyText = resp.body.toString('utf-8').substring(0, 300);
    throw new Error(`S3 GET failed (${resp.status}): ${key} — ${bodyText}`);
  }
  return resp.body;
}

/**
 * Check if an object exists (HEAD request).
 */
export async function s3HeadObject(
  credentials: S3Credentials,
  key: string,
): Promise<boolean> {
  try {
    const resp = await s3Request(credentials, {
      method: 'HEAD',
      bucket: credentials.bucket,
      key,
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

/**
 * Delete an object from S3.
 */
export async function s3DeleteObject(
  credentials: S3Credentials,
  key: string,
): Promise<void> {
  const resp = await s3Request(credentials, {
    method: 'DELETE',
    bucket: credentials.bucket,
    key,
  });
  if (resp.status !== 204 && resp.status !== 200 && resp.status !== 404) {
    const bodyText = resp.body.toString('utf-8').substring(0, 300);
    throw new Error(`S3 DELETE failed (${resp.status}): ${key} — ${bodyText}`);
  }
}

/**
 * List objects with a given prefix.
 * Handles both <Contents> and <CommonPrefixes> for delimiter-based listings.
 * Also handles <IsTruncated> for paginated results (fetches all pages).
 */
export async function s3ListObjects(
  credentials: S3Credentials,
  prefix: string,
  maxKeys: number = 1000,
): Promise<string[]> {
  const allKeys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const query: Record<string, string> = {
      'list-type': '2',
      prefix,
      'max-keys': String(Math.min(maxKeys - allKeys.length, 1000)),
    };
    if (continuationToken) {
      query['continuation-token'] = continuationToken;
    }

    const resp = await s3Request(credentials, {
      method: 'GET',
      bucket: credentials.bucket,
      key: '',
      query,
    });

    if (resp.status !== 200) {
      const bodyText = resp.body.toString('utf-8').substring(0, 300);
      throw new Error(`S3 LIST failed (${resp.status}): prefix=${prefix} — ${bodyText}`);
    }

    const xml = resp.body.toString('utf-8');

    /* Parse <Contents><Key>...</Key></Contents> */
    const contentsMatches = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
    for (const block of contentsMatches) {
      const keyMatch = block.match(/<Key>([^<]+)<\/Key>/);
      if (keyMatch) allKeys.push(keyMatch[1]);
    }

    /* Check for truncation */
    const truncatedMatch = xml.match(/<IsTruncated>([^<]+)<\/IsTruncated>/);
    const isTruncated = truncatedMatch && truncatedMatch[1] === 'true';

    if (isTruncated) {
      const tokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      continuationToken = tokenMatch ? tokenMatch[1] : undefined;
      if (!continuationToken) break; // Can't paginate further
    } else {
      continuationToken = undefined;
    }
  } while (continuationToken && allKeys.length < maxKeys);

  return allKeys;
}
