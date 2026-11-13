import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { compressStatic, isCompressible, negotiateEncoding } from './compress.js';

/**
 * Static file server for the Vite build, for `npm run server` in production.
 *
 * Cache policy: Vite fingerprints every file under /assets/ with a content
 * hash, so those are immutable for a year. index.html, the SPA fallback and
 * the unhashed root files revalidate on every use (`no-cache`) against a
 * strong ETag, a SHA-256 of the bytes, and answer 304 on an If-None-Match
 * hit. Text files over 1 KB go out as Brotli or gzip, compressed once on the
 * libuv threadpool and cached beside the original; each coding carries its
 * own ETag, as RFC 9110 asks of distinct representations.
 */

export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const REVALIDATE_CACHE_CONTROL = 'no-cache';

const ASSET_PREFIX = '/assets/';
const SHELL_FILE = 'index.html';
const ETAG_HASH_CHARS = 27;
const MAX_PATH_CHARS = 1024;
const MAX_PATH_SEGMENTS = 16;

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
});

const STATIC_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
});

function plain(req, res, status, message, headers = {}) {
  const body = Buffer.from(`${message}\n`, 'utf8');
  res.writeHead(status, {
    ...STATIC_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** If-None-Match uses the weak comparison (RFC 9110 section 13.1.2): `W/` prefixes are ignored, `*` matches. */
export function etagMatches(header, etag) {
  if (typeof header !== 'string' || header.length === 0) return false;
  for (const part of header.split(',')) {
    const tag = part.trim();
    if (tag === '*') return true;
    if ((tag.startsWith('W/') ? tag.slice(2) : tag) === etag) return true;
  }
  return false;
}

/**
 * Maps a request path to a file under `rootDir`, or null. A build path is a
 * few segments and well under 100 characters, so anything over 1 KB or 16
 * segments is refused before any decoding work. Decoding happens once; dot
 * segments, dotfiles, backslashes, colons (drive letters and NTFS streams)
 * and NUL are refused outright, and the resolved path must still sit inside
 * the root.
 */
export function resolveStaticPath(rootDir, pathname) {
  if (typeof pathname !== 'string' || pathname.length > MAX_PATH_CHARS) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter((segment) => segment.length > 0);
  if (segments.length > MAX_PATH_SEGMENTS) return null;
  if (segments.some((segment) => segment.startsWith('.') || segment.includes(':'))) return null;
  const target = resolve(rootDir, ...segments);
  const rel = relative(rootDir, target);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

/**
 * `(req, res) => Promise<void>` serving the build at `root`, with `warm()` to
 * precompress every text file in the background after the server starts.
 */
export function createStaticHandler({ root }) {
  const rootDir = resolve(root);
  // Absolute path -> { mtimeMs, size, body, type, hash, etag, encoded: Map<coding, Promise<{ body, etag }>> }
  const files = new Map();

  async function load(file) {
    let info;
    try {
      info = await stat(file);
    } catch {
      files.delete(file);
      return null;
    }
    if (!info.isFile()) return null;
    const cached = files.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;
    const body = await readFile(file);
    const hash = createHash('sha256').update(body).digest('base64url').slice(0, ETAG_HASH_CHARS);
    const entry = {
      mtimeMs: info.mtimeMs,
      size: body.length,
      body,
      type: MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      hash,
      etag: `"${hash}"`,
      encoded: new Map(),
    };
    files.set(file, entry);
    return entry;
  }

  function encodedVariant(entry, encoding) {
    let pending = entry.encoded.get(encoding);
    if (!pending) {
      const suffix = encoding === 'br' ? 'br' : 'gz';
      pending = compressStatic(entry.body, encoding).then((body) => ({ body, etag: `"${entry.hash}-${suffix}"` }));
      entry.encoded.set(encoding, pending);
      pending.catch(() => entry.encoded.delete(encoding));
    }
    return pending;
  }

  async function serveStatic(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        plain(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
        return;
      }
      let pathname;
      try {
        pathname = new URL(req.url, 'http://lumen.invalid').pathname;
      } catch {
        plain(req, res, 400, 'Bad Request');
        return;
      }
      const target = resolveStaticPath(rootDir, pathname);
      if (!target) {
        plain(req, res, 404, 'Not Found');
        return;
      }

      const isAsset = pathname.startsWith(ASSET_PREFIX);
      let entry = pathname.endsWith('/') ? null : await load(target);
      let cacheControl = isAsset ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL;
      if (!entry) {
        // An extensionless path outside /assets/ is a client route: the SPA shell answers it.
        // A missing asset or file stays a 404, so a stale chunk never parses HTML as script.
        if (isAsset || extname(pathname) !== '') {
          plain(req, res, 404, 'Not Found');
          return;
        }
        entry = await load(join(rootDir, SHELL_FILE));
        cacheControl = REVALIDATE_CACHE_CONTROL;
        if (!entry) {
          plain(req, res, 404, 'Not Found');
          return;
        }
      }

      const compressible = isCompressible(entry.type, entry.size);
      const encoding = compressible ? negotiateEncoding(req.headers['accept-encoding']) : null;
      const { body, etag } = encoding ? await encodedVariant(entry, encoding) : entry;
      const headers = { ...STATIC_HEADERS, 'Content-Type': entry.type, 'Cache-Control': cacheControl, ETag: etag };
      if (compressible) headers.Vary = 'Accept-Encoding';
      if (etagMatches(req.headers['if-none-match'], etag)) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      if (encoding) headers['Content-Encoding'] = encoding;
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      console.error('[lumen-cloud] static', error);
      plain(req, res, 500, 'Internal Server Error');
    }
  }

  /** Compresses every text file of the build once, one file at a time, so requests keep threadpool room. */
  serveStatic.warm = async function warm() {
    const entries = await readdir(rootDir, { recursive: true, withFileTypes: true });
    for (const dirent of entries) {
      if (!dirent.isFile() || dirent.name.startsWith('.')) continue;
      const entry = await load(join(dirent.parentPath ?? dirent.path, dirent.name));
      if (!entry || !isCompressible(entry.type, entry.size)) continue;
      await encodedVariant(entry, 'br');
      await encodedVariant(entry, 'gzip');
    }
  };

  serveStatic.root = rootDir;
  return serveStatic;
}
