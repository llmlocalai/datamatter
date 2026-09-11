#!/usr/bin/env node
/**
 * The thing that stands between the public internet and Ollama.
 *
 * Tailscale Funnel puts a port on this machine on the public internet, and
 * Ollama has no authentication of its own: anyone who learns the funnel URL can
 * use the models, and `POST /api/pull` on an open endpoint is a stranger filling
 * the disk. So the funnel points HERE, and this forwards to Ollama only when
 * three things hold.
 *
 *   1. The request carries the shared secret. Either `Authorization: Bearer
 *      <secret>` or `X-LLM-Secret: <secret>`; the site sends both, because which
 *      one a proxy reads should not be a code change in the site.
 *   2. The path is on the allowlist. Reading tags and chatting, nothing else:
 *      pull, push, create, copy and delete are how a model server gets used as
 *      somebody else's disk and somebody else's GPU.
 *   3. The method matches the path. A GET cannot start a generation and a POST
 *      cannot enumerate.
 *
 * It also rewrites the Host header. Ollama refuses a request whose Host is not
 * local (its own protection against DNS rebinding), and a funnelled request
 * arrives carrying the ts.net name.
 *
 * Nothing here logs a prompt or a completion — only method, path, status and
 * duration, which is what you need to see whether it is working and nothing
 * about what was asked.
 *
 *   LLM_SHARED_SECRET=... node scripts/llm_funnel_proxy.js
 *
 * Environment:
 *   LLM_SHARED_SECRET   required; the same value the site sends
 *   PROXY_PORT          default 11435 — what the funnel points at
 *   OLLAMA_URL          default http://127.0.0.1:11434
 *   PROXY_LOG           set to 0 to silence the request log entirely
 */
const http = require('http');
const { URL } = require('url');

const SECRET = process.env.LLM_SHARED_SECRET || '';
const PORT = Number(process.env.PROXY_PORT || 11435);
const UPSTREAM = new URL(process.env.OLLAMA_URL || 'http://127.0.0.1:11434');
const LOG = process.env.PROXY_LOG !== '0';

if (!SECRET || SECRET.length < 16) {
  console.error('LLM_SHARED_SECRET must be set and at least 16 characters.');
  console.error('Generate one:  openssl rand -base64 32');
  process.exit(2);
}

// Path -> methods allowed. Everything else is 404, which is the right answer to
// give the internet: a 403 confirms the endpoint exists.
const ALLOW = new Map([
  ['/api/tags', ['GET']],
  ['/api/chat', ['POST']],
  ['/api/show', ['POST']],
  ['/v1/models', ['GET']],
  ['/v1/chat/completions', ['POST']],
]);

/** Constant-time-ish compare; these are short strings and this is not a keystore. */
function secretOk(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const alt = req.headers['x-llm-secret'] || '';
  const given = bearer || alt;
  if (given.length !== SECRET.length) return false;
  let diff = 0;
  for (let i = 0; i < SECRET.length; i++) diff |= given.charCodeAt(i) ^ SECRET.charCodeAt(i);
  return diff === 0;
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  const path = (req.url || '').split('?')[0];
  const done = (code) => {
    if (LOG) {
      console.log(`${new Date().toISOString()} ${req.method} ${path} -> ${code} `
        + `${Date.now() - started}ms`);
    }
  };

  if (!secretOk(req)) { res.writeHead(401); res.end('unauthorized'); return done(401); }

  const methods = ALLOW.get(path);
  if (!methods || !methods.includes(req.method || '')) {
    res.writeHead(404); res.end('not found'); return done(404);
  }

  // Node throws ERR_HTTP_INVALID_HEADER_VALUE on a header set to undefined, so
  // the ones that must not go upstream are DELETED rather than blanked.
  const headers = { ...req.headers };
  delete headers.authorization;
  delete headers['x-llm-secret'];
  delete headers['cf-access-client-id'];
  delete headers['cf-access-client-secret'];
  // Ollama rejects a foreign Host header (its protection against DNS
  // rebinding); a funnelled request arrives carrying the ts.net name.
  headers.host = `${UPSTREAM.hostname}:${UPSTREAM.port || 80}`;

  const upstream = http.request({
    hostname: UPSTREAM.hostname,
    port: UPSTREAM.port || 80,
    path: req.url,
    method: req.method,
    headers,
  }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
    up.on('end', () => done(up.statusCode || 502));
  });

  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'the model server did not answer' }));
    done(502);
  });

  req.pipe(upstream);
});

// A generation on a 27B model takes minutes; the default two-minute socket
// timeout would cut the answer off mid-sentence and look like a model fault.
server.headersTimeout = 10 * 60 * 1000;
server.requestTimeout = 15 * 60 * 1000;
server.setTimeout(15 * 60 * 1000);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`llm funnel proxy on 127.0.0.1:${PORT} -> ${UPSTREAM.origin}`);
  console.log(`allowed: ${[...ALLOW.keys()].join(', ')}`);
});
