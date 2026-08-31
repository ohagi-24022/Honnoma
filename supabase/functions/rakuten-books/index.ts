// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const RAKUTEN_API_BASE_URL = 'https://openapi.rakuten.co.jp/services/api';
const DEFAULT_REFERER = 'https://github.com/ohagi-24022/BookNest';
const PROXY_VERSION = '2026-07-29-envelope-status';
const RAW_TLS_TIMEOUT_MS = 10_000;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = Number(Deno.env.get('RAKUTEN_PROXY_RATE_LIMIT_MAX_REQUESTS') ?? '120');

declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
  connectTls: (options: {
    hostname: string;
    port: number;
  }) => Promise<{
    read: (buffer: Uint8Array) => Promise<number | null>;
    write: (buffer: Uint8Array) => Promise<number>;
    close: () => void;
  }>;
};

type RakutenProxyRequest = {
  path?: string;
  params?: Record<string, string>;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const startedAt = Date.now();
    const appId = Deno.env.get('RAKUTEN_APP_ID');
    const accessKey = Deno.env.get('RAKUTEN_ACCESS_KEY');
    const referer = Deno.env.get('RAKUTEN_REFERER') ?? DEFAULT_REFERER;
    const callerKey = getCallerKey(request);

    if (!(await isWithinRateLimit(callerKey, request))) {
      await writeOperationLog({
        durationMs: Date.now() - startedAt,
        metadata: { callerKey, reason: 'rate-limit' },
        operation: 'external-api-proxy',
        provider: 'Rakuten Books',
        status: 'error',
      });
      return jsonResponse({
        ok: false,
        status: 429,
        body: { error: 'RATE_LIMITED', message: 'Too many Rakuten Books requests. Please try again later.' },
      });
    }

    if (!appId || !accessKey) {
      await writeOperationLog({
        durationMs: Date.now() - startedAt,
        metadata: { callerKey, reason: 'missing-rakuten-secrets' },
        operation: 'external-api-proxy',
        provider: 'Rakuten Books',
        status: 'error',
      });
      return jsonResponse({
        ok: false,
        status: 500,
        body: { error: 'RAKUTEN_APP_ID and RAKUTEN_ACCESS_KEY are required.' },
      });
    }

    const payload = (await request.json()) as RakutenProxyRequest;
    const path = payload.path;
    if (!path || !/^Books(?:Book|Total)\/Search\/20170404$/.test(path)) {
      await writeOperationLog({
        durationMs: Date.now() - startedAt,
        metadata: { callerKey, path },
        operation: 'external-api-proxy',
        provider: 'Rakuten Books',
        status: 'error',
      });
      return jsonResponse({
        ok: false,
        status: 400,
        body: { error: 'Invalid Rakuten API path.' },
      });
    }

    const params = new URLSearchParams(payload.params ?? {});
    params.set('applicationId', appId);
    params.set('accessKey', accessKey);
    params.set('format', 'json');

    const response = await fetchRakuten(
      `${RAKUTEN_API_BASE_URL}/${path}?${params.toString()}`,
      referer,
    );
    await writeOperationLog({
      durationMs: Date.now() - startedAt,
      metadata: {
        callerKey,
        path,
        proxyVersion: PROXY_VERSION,
        refererConfigured: Boolean(referer),
        status: response.status,
      },
      operation: 'external-api-proxy',
      provider: 'Rakuten Books',
      status: response.status >= 200 && response.status < 300 ? 'ok' : 'error',
    });
    const text = response.text;
    let body: unknown = text;

    try {
      body = JSON.parse(text);
    } catch {
      // Preserve non-JSON error bodies for troubleshooting failed proxy calls.
    }

    return jsonResponse({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      body,
      proxy: {
        version: PROXY_VERSION,
        transport: 'raw-tls',
        refererConfigured: Boolean(referer),
      },
    });
  } catch (error) {
    await writeOperationLog({
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
      operation: 'external-api-proxy',
      provider: 'Rakuten Books',
      status: 'error',
    });
    return jsonResponse({
      ok: false,
      status: 500,
      body: { error: error instanceof Error ? error.message : 'Unknown error' },
      proxy: {
        version: PROXY_VERSION,
        transport: 'raw-tls',
        refererConfigured: false,
      },
    });
  }
});

function fetchRakuten(url: string, referer: string): Promise<{ status: number; text: string }> {
  return fetchRakutenOverRawTls(url, referer);
}

async function isWithinRateLimit(callerKey: string, request: Request) {
  if (getJwtRoleFromRequest(request) === 'service_role') return true;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return true;

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from('server_operation_logs')
    .select('id', { count: 'exact', head: true })
    .eq('operation', 'external-api-proxy')
    .eq('provider', 'Rakuten Books')
    .gte('created_at', since)
    .contains('metadata', { callerKey });
  if (error) return true;
  return (count ?? 0) < RATE_LIMIT_MAX_REQUESTS;
}

function getCallerKey(request: Request) {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const subject = decodeJwt(token)?.sub;
  if (subject) return `user:${subject}`;
  return `anon:${request.headers.get('x-forwarded-for') ?? 'unknown'}`;
}

function getJwtRoleFromRequest(request: Request) {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return decodeJwt(token)?.role;
}

function decodeJwt(token: string) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as { role?: string; sub?: string };
  } catch {
    return undefined;
  }
}

async function writeOperationLog(input: {
  durationMs?: number;
  metadata?: Record<string, unknown>;
  operation: string;
  provider?: string;
  requestCount?: number;
  status: 'ok' | 'error' | 'skipped';
}) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
    await supabase.from('server_operation_logs').insert({
      duration_ms: input.durationMs ?? null,
      metadata: input.metadata ?? null,
      operation: input.operation,
      provider: input.provider ?? null,
      request_count: input.requestCount ?? 1,
      status: input.status,
    });
  } catch {
    // Logging must not block metadata lookup.
  }
}

async function fetchRakutenOverRawTls(
  urlString: string,
  referer: string,
): Promise<{ status: number; text: string }> {
  const url = new URL(urlString);
  const connection = await withTimeout(
    Deno.connectTls({
      hostname: url.hostname,
      port: 443,
    }),
    'Rakuten API connection timed out.',
  );

  try {
    const requestText = [
      `GET ${url.pathname}${url.search} HTTP/1.1`,
      `Host: ${url.hostname}`,
      `Referer: ${referer}`,
      `Origin: ${new URL(referer).origin}`,
      'Accept: application/json',
      'Accept-Encoding: identity',
      'Connection: close',
      '',
      '',
    ].join('\r\n');
    await withTimeout(
      writeAll(connection, new TextEncoder().encode(requestText)),
      'Rakuten API request timed out.',
    );

    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    const buffer = new Uint8Array(16 * 1024);

    while (true) {
      const bytesRead = await withTimeout(
        connection.read(buffer),
        'Rakuten API response timed out.',
      );
      if (bytesRead === null) break;
      totalLength += bytesRead;
      if (totalLength > 5 * 1024 * 1024) {
        throw new Error('Rakuten API response exceeded 5 MB.');
      }
      chunks.push(buffer.slice(0, bytesRead));
    }

    const responseBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      responseBytes.set(chunk, offset);
      offset += chunk.length;
    }

    return parseRawHttpResponse(responseBytes);
  } finally {
    connection.close();
  }
}

function parseRawHttpResponse(rawResponse: Uint8Array): { status: number; text: string } {
  const headerEnd = findSequence(rawResponse, [13, 10, 13, 10]);
  if (headerEnd < 0) {
    throw new Error('Rakuten API returned an invalid HTTP response.');
  }

  const headerText = new TextDecoder().decode(rawResponse.slice(0, headerEnd));
  const bodyBytes = rawResponse.slice(headerEnd + 4);
  const headerLines = headerText.split('\r\n');
  const status = Number(headerLines[0]?.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/)?.[1] ?? 500);
  const isChunked = headerLines.some((line) => /^transfer-encoding:\s*chunked/i.test(line));

  return {
    status,
    text: new TextDecoder().decode(isChunked ? decodeChunkedBody(bodyBytes) : bodyBytes),
  };
}

function decodeChunkedBody(body: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  let offset = 0;

  while (offset < body.length) {
    const lineEnd = findSequence(body, [13, 10], offset);
    if (lineEnd < 0) break;
    const sizeLine = new TextDecoder().decode(body.slice(offset, lineEnd));
    const chunkSize = Number.parseInt(sizeLine.split(';')[0], 16);
    if (!Number.isFinite(chunkSize)) {
      throw new Error('Rakuten API returned an invalid chunked response.');
    }
    if (chunkSize === 0) break;

    const chunkStart = lineEnd + 2;
    const chunk = body.slice(chunkStart, chunkStart + chunkSize);
    chunks.push(chunk);
    totalLength += chunk.length;
    offset = chunkStart + chunkSize + 2;
  }

  const decoded = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const chunk of chunks) {
    decoded.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  return decoded;
}

async function writeAll(
  connection: { write: (buffer: Uint8Array) => Promise<number> },
  bytes: Uint8Array,
) {
  let offset = 0;
  while (offset < bytes.length) {
    offset += await connection.write(bytes.subarray(offset));
  }
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), RAW_TLS_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function findSequence(bytes: Uint8Array, sequence: number[], start = 0) {
  outer: for (let index = start; index <= bytes.length - sequence.length; index += 1) {
    for (let sequenceIndex = 0; sequenceIndex < sequence.length; sequenceIndex += 1) {
      if (bytes[index + sequenceIndex] !== sequence[sequenceIndex]) continue outer;
    }
    return index;
  }
  return -1;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

