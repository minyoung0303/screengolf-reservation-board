import { spawn } from 'node:child_process';
import process from 'node:process';

/** 개발용: esbuild 감시 + Vite 개발 서버 + Electron 을 함께 띄운다. */

const isWin = process.platform === 'win32';
const children = [];

function run(command, args, label) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: isWin,
    env: process.env,
  });
  child.on('exit', (code) => {
    if (label === 'electron') stopAll(code ?? 0);
  });
  children.push(child);
  return child;
}

function stopAll(code) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => stopAll(0));

async function waitForPort(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true;
    } catch {
      /* 아직 준비되지 않음 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

await new Promise((resolve, reject) => {
  const build = spawn('node', ['scripts/build-node.mjs'], { stdio: 'inherit', shell: isWin });
  build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('빌드 실패'))));
});

run('node', ['scripts/build-node.mjs', '--watch'], 'esbuild');
run('npx', ['vite'], 'vite');

const ready = await waitForPort('http://localhost:5173');
if (!ready) {
  console.error('Vite 개발 서버가 준비되지 않았습니다.');
  stopAll(1);
}

run('npx', ['electron', '.'], 'electron');
