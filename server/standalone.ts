/**
 * Electron 없이 서버만 띄우는 진입점. 자동 점검(smoke test)과 문제 진단에 쓴다.
 * 사용법: node dist/main/standalone.js --data <폴더> --port 5181 [--static dist/renderer]
 */
import path from 'node:path';
import os from 'node:os';
import { createRoutes } from './api';
import { setDesktopToken } from './auth';
import { openDatabase, purgeOldReservations } from './db';
import { startServer } from './server';

function arg(name: string, fallback = ''): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const dataDir = arg('data', path.join(os.tmpdir(), 'yeyakbo-standalone'));
const port = Number(arg('port', '5181'));
const staticDir = arg('static', '');
const desktopToken = arg('token', 'standalone-desktop-token');

async function boot(): Promise<void> {
  openDatabase(path.join(dataDir, 'data.db'));
  purgeOldReservations();
  setDesktopToken(desktopToken);

  const handle = await startServer({
    port,
    routes: createRoutes({ userDataDir: dataDir, version: '0.0.0-standalone', getPort: () => port }),
    staticDir: staticDir ? path.resolve(staticDir) : null,
  });

  console.log(`[standalone] http://127.0.0.1:${handle.port} (data: ${dataDir})`);
}

void boot();
