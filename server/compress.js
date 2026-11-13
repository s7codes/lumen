import { promisify } from 'node:util';
import { brotliCompress, brotliCompressSync, constants, gzip, gzipSync } from 'node:zlib';

/**
 * HTTP response compression on node:zlib, shared by the JSON API and the
 * static file server. Brotli and gzip only: every browser Lumen supports
 * speaks both, and deflate's framing ambiguity is not worth carrying.
 */

/** Bodies at or under this size go out as they are: the framing would eat the gain. */
export const COMPRESSION_THRESHOLD_BYTES = 1024;
export const COMPRESSIBLE_TYPE = /^(?:text\/|application\/(?:json|javascript|xml|manifest\+json)|image\/svg\+xml)/i;

// Node caps a request's headers at 16 KB; a coding list is a few dozen bytes.
const MAX_ACCEPT_ENCODING_CHARS = 4096;
// Dynamic JSON is compressed per response on the request path, so it trades a
// little ratio for speed; static files are compressed once, off the event loop.
const DYNAMIC = Object.freeze({ brotli: 5, gzip: 6 });
const STATIC = Object.freeze({ brotli: 11, gzip: 9 });

function qValue(params) {
  let q = 1;
  for (const param of params) {
    const eq = param.indexOf('=');
    if (eq === -1 || param.slice(0, eq).trim().toLowerCase() !== 'q') continue;
    const value = Number(param.slice(eq + 1).trim());
    q = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  }
  return q;
}

/**
 * Picks `'br'`, `'gzip'` or null from an Accept-Encoding header, honouring
 * q-values and `*` (RFC 9110 section 12.5.3). Brotli wins a tie. One linear
 * scan with no regular expression, so a hostile header costs O(n).
 */
export function negotiateEncoding(header) {
  if (typeof header !== 'string' || header.length === 0) return null;
  let br;
  let gz;
  let any;
  for (const part of header.slice(0, MAX_ACCEPT_ENCODING_CHARS).split(',')) {
    const [rawName, ...params] = part.split(';');
    const name = rawName.trim().toLowerCase();
    if (name === 'br') br = qValue(params);
    else if (name === 'gzip' || name === 'x-gzip') gz = qValue(params);
    else if (name === '*') any = qValue(params);
  }
  const qBr = br ?? any ?? 0;
  const qGzip = gz ?? any ?? 0;
  if (qBr <= 0 && qGzip <= 0) return null;
  return qBr >= qGzip ? 'br' : 'gzip';
}

/** True when a response of this type and size is worth compressing. */
export function isCompressible(contentType, byteLength) {
  return byteLength > COMPRESSION_THRESHOLD_BYTES && typeof contentType === 'string' && COMPRESSIBLE_TYPE.test(contentType);
}

function brotliOptions(size, quality) {
  return {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: quality,
      [constants.BROTLI_PARAM_SIZE_HINT]: size,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    },
  };
}

/** Synchronous: for API JSON on the request path, which the 64 KB body cap keeps small. */
export function compressSync(buffer, encoding) {
  return encoding === 'br' ? brotliCompressSync(buffer, brotliOptions(buffer.length, DYNAMIC.brotli)) : gzipSync(buffer, { level: DYNAMIC.gzip });
}

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** On the libuv threadpool at maximum ratio: for static files, compressed once and cached. */
export function compressStatic(buffer, encoding) {
  return encoding === 'br' ? brotliAsync(buffer, brotliOptions(buffer.length, STATIC.brotli)) : gzipAsync(buffer, { level: STATIC.gzip });
}
