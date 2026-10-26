// Local-only HTTP server for the usage dashboard.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuery, ValidationError } from './lib/validate.js';
import { COMMANDS, getReport, CcusageError } from './lib/ccusage.js';

const HOST = '127.0.0.1';
const PORT = parsePort(process.env.PORT);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');

function parsePort(value) {
  if (value === undefined || value === '') return 4317;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error('Invalid PORT, must be 1-65535');
    process.exit(1);
  }
  return n;
}

// Explicit static whitelist: URL path -> [file, content type].
// No URL segment is ever joined into a filesystem path.
const STATIC = {
  '/': [path.join(PUBLIC, 'index.html'), 'text/html'],
  '/styles.css': [path.join(PUBLIC, 'styles.css'), 'text/css'],
  '/app.js': [path.join(PUBLIC, 'app.js'), 'text/javascript'],
  '/format.js': [path.join(PUBLIC, 'format.js'), 'text/javascript'],
  '/peak.js': [path.join(PUBLIC, 'peak.js'), 'text/javascript'],
  '/theme.js': [path.join(PUBLIC, 'theme.js'), 'text/javascript'],
  '/data.js': [path.join(PUBLIC, 'data.js'), 'text/javascript'],
  '/vendor/chart.umd.min.js': [
    path.join(ROOT, 'node_modules', 'chart.js', 'dist',
      'chart.umd.min.js'),
    'text/javascript',
  ],
};

const ALLOWED_HOSTS = new Set([
  `127.0.0.1:${PORT}`,
  `localhost:${PORT}`,
]);

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

function send(res, status, body, type, extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    ...BASE_HEADERS,
    'Content-Type': `${type}; charset=utf-8`,
    'Content-Length': buf.length,
    ...extra,
  });
  res.end(res.req.method === 'HEAD' ? undefined : buf);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json', {
    'Cache-Control': 'no-store',
  });
}

async function handleApi(res, name, params) {
  if (!Object.hasOwn(COMMANDS, name)) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  try {
    const opts = parseQuery(params);
    const data = await getReport(name, opts);
    sendJson(res, 200, data);
  } catch (err) {
    if (err instanceof ValidationError) {
      sendJson(res, 400, { error: err.message });
    } else if (err instanceof CcusageError) {
      sendJson(res, err.status, { error: err.message });
    } else {
      console.error('Unexpected error:', err?.message);
      sendJson(res, 500, { error: 'Internal error' });
    }
  }
}

async function handle(req, res) {
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) {
    sendJson(res, 403, { error: 'Forbidden host' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host}`);
  } catch {
    sendJson(res, 400, { error: 'Bad request' });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    await handleApi(res, url.pathname.slice(5), url.searchParams);
    return;
  }

  const entry = Object.hasOwn(STATIC, url.pathname)
    ? STATIC[url.pathname] : null;
  if (!entry) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  try {
    const body = await readFile(entry[0]);
    send(res, 200, body, entry[1], { 'Cache-Control': 'no-cache' });
  } catch {
    sendJson(res, 500, { error: 'Internal error' });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard: http://${HOST}:${PORT}`);
});
