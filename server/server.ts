import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { resolveSession, type Session } from './auth';
import { AppError } from './engine';

export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  session: Session | null;
  ip: string;
  isLocal: boolean;
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** true 면 인증 없이 접근 가능 (PIN 화면, 상태 확인 용도) */
  public?: boolean;
  /** SSE 처럼 직접 응답을 쓰는 핸들러는 undefined 를 반환한다 */
  handler: (ctx: Ctx) => unknown | Promise<unknown>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  // 안드로이드 크롬은 이 형식이 맞아야 "홈 화면에 추가"를 앱처럼 처리한다
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const MAX_BODY = 256 * 1024;

function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const routeParts = route.path.split('/');
    const pathParts = pathname.split('/');
    if (routeParts.length !== pathParts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < routeParts.length; i += 1) {
      const rp = routeParts[i];
      if (rp.startsWith(':')) {
        params[rp.slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (rp !== pathParts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new AppError(413, 'TOO_LARGE', '요청이 너무 커요.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new AppError(400, 'BAD_JSON', '요청 형식이 올바르지 않아요.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const text = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

function clientIp(req: http.IncomingMessage): string {
  return (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
}

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

/**
 * 다른 웹사이트가 이 프로그램의 주소로 몰래 요청을 보내는 것(CSRF)을 막는다.
 * 브라우저는 다른 사이트에서 보낸 요청에 Origin 헤더를 붙이므로, 우리 주소가 아니면 거부한다.
 * 프로그램·폰 브라우저에서 정상적으로 접속한 경우에는 Origin 이 같거나 없다.
 */
function originAllowed(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const from = new URL(origin);
    const host = (req.headers.host ?? '').split(':')[0];
    if (from.hostname === host) return true;
    return isLoopback(from.hostname) && isLoopback(host);
  } catch {
    return false;
  }
}

/* ------------------------------- SSE ------------------------------- */

const sseClients = new Set<http.ServerResponse>();

export function sseHandler(ctx: Ctx): undefined {
  const { res } = ctx;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
  sseClients.add(res);
  ctx.req.on('close', () => {
    sseClients.delete(res);
  });
  return undefined;
}

export function broadcast(payload: unknown): void {
  const text = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(text);
    } catch {
      sseClients.delete(client);
    }
  }
}

let pingTimer: NodeJS.Timeout | null = null;

/* ------------------------------ 정적 파일 ------------------------------ */

function serveStatic(staticDir: string, pathname: string, res: http.ServerResponse): void {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(staticDir, rel);
  // 디렉터리 밖으로 나가는 경로 요청 차단
  if (!target.startsWith(path.resolve(staticDir))) {
    res.writeHead(403).end('forbidden');
    return;
  }
  let file = target;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(staticDir, 'index.html'); // SPA 라우팅 대응
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const isHtml = ext === '.html';
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

/* ------------------------------ 서버 시작 ------------------------------ */

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

export async function startServer(options: {
  port: number;
  routes: Route[];
  staticDir: string | null;
  host?: string;
}): Promise<ServerHandle> {
  const { routes, staticDir } = options;

  const server = http.createServer((req, res) => {
    const ip = clientIp(req);
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = (req.method ?? 'GET').toUpperCase();

    if (!url.pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405).end('method not allowed');
        return;
      }
      if (staticDir) serveStatic(staticDir, url.pathname, res);
      else sendJson(res, 404, { error: 'DEV', message: '개발 모드에서는 Vite(5173)로 접속하세요.' });
      return;
    }

    void handleApi(req, res, url, method, ip, routes);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? '0.0.0.0', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  pingTimer = setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(': ping\n\n');
      } catch {
        sseClients.delete(client);
      }
    }
  }, 25_000);

  return {
    port: (server.address() as { port: number }).port,
    close: () =>
      new Promise<void>((resolve) => {
        if (pingTimer) clearInterval(pingTimer);
        for (const client of sseClients) client.end();
        sseClients.clear();
        server.close(() => resolve());
      }),
  };
}

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  method: string,
  ip: string,
  routes: Route[],
): Promise<void> {
  try {
    if (method !== 'GET' && !originAllowed(req)) {
      sendJson(res, 403, { error: 'BAD_ORIGIN', message: '허용되지 않은 요청이에요.' });
      return;
    }

    const found = matchRoute(routes, method, url.pathname);
    if (!found) {
      sendJson(res, 404, { error: 'NO_ROUTE', message: '없는 주소예요.' });
      return;
    }

    const headerToken = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    const token = headerToken || url.searchParams.get('token');
    const session = resolveSession(token || null);

    if (!found.route.public && !session) {
      sendJson(res, 401, { error: 'UNAUTHORIZED', message: 'PIN 확인이 필요해요.' });
      return;
    }

    const body = method === 'GET' || method === 'DELETE' ? {} : await readBody(req);

    const ctx: Ctx = {
      req,
      res,
      url,
      params: found.params,
      body,
      session,
      ip,
      isLocal: isLoopback(ip),
    };

    const result = await found.route.handler(ctx);
    if (res.writableEnded || res.headersSent) return; // SSE 등 직접 응답한 경우
    sendJson(res, 200, result ?? { ok: true });
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof AppError) {
      sendJson(res, error.status, {
        error: error.code,
        message: error.message,
        quote: error.quote,
      });
      return;
    }
    console.error('[server]', error);
    sendJson(res, 500, {
      error: 'INTERNAL',
      message: '처리 중 문제가 생겼어요. 프로그램을 다시 켜보고, 계속 그러면 알려주세요.',
    });
  }
}
