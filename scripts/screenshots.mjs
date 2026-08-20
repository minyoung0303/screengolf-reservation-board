/**
 * 문서용 화면 캡처. 시범 데이터로 실제 화면을 찍어 docs/images 에 저장한다.
 * 실제 손님 정보는 들어가지 않는다 (scripts/demo.mjs 가 만든 가짜 데이터).
 *
 * 실행: node scripts/demo.mjs  후에  npx electron scripts/screenshots.mjs
 */
import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 5196;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = path.join(os.tmpdir(), 'yeyakbo-demo');
const OUT = path.join('docs', 'images');
const PIN = '4739';

const DESKTOP = { width: 1240, height: 940 };
const PHONE = { width: 390, height: 844 };

const server = spawn(
  process.execPath,
  ['dist/main/standalone.js', '--data', DATA, '--port', String(PORT), '--static', 'dist/renderer'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* 대기 */
    }
    await wait(200);
  }
  throw new Error('서버가 시작되지 않았습니다.');
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let win;
  try {
    await ready();
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN, label: '문서용' }),
    }).then((r) => r.json());

    console.log(`  로그인 토큰: ${login.token ? '발급됨' : JSON.stringify(login)}`);

    win = new BrowserWindow({ ...DESKTOP, show: false, webPreferences: { offscreen: true } });
    win.webContents.on('console-message', (_e, _level, message) => {
      if (!message.includes('DevTools')) console.log(`    [화면] ${message}`);
    });

    /** 화면 요소가 실제로 그려질 때까지 기다린다 (로딩 중 화면이 찍히는 것 방지) */
    const waitFor = async (selector, timeout = 15000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const found = await win.webContents.executeJavaScript(
          `!!document.querySelector(${JSON.stringify(selector)})`,
        );
        if (found) return true;
        await wait(200);
      }
      throw new Error(`화면 요소를 찾지 못했습니다: ${selector}`);
    };

    const shot = async (name, selector) => {
      await waitFor(selector);
      await wait(500); // 글꼴·그림자까지 그려질 여유
      const png = (await win.webContents.capturePage()).toPNG();
      const file = path.join(OUT, `${name}.png`);
      fs.writeFileSync(file, png);
      console.log(`  ${file}  ${(png.length / 1024).toFixed(0)} KB`);
    };

    const signIn = async () => {
      await win.webContents.executeJavaScript(
        `localStorage.setItem('yeyakbo.token', ${JSON.stringify(login.token)}); true`,
      );
      await win.loadURL(BASE);
      const seen = await win.webContents.executeJavaScript(
        `[localStorage.getItem('yeyakbo.token') ? 'token있음' : 'token없음', document.querySelector('.pin-card') ? 'PIN화면' : '예약판'].join(' / ')`,
      );
      console.log(`    상태: ${seen}`);
    };

    const signOut = async () => {
      await win.webContents.executeJavaScript(`localStorage.clear(); true`);
      await win.loadURL(BASE);
    };

    /* ---------------------------- 카운터 화면 ---------------------------- */
    const clickByText = async (selector, text) => {
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(${JSON.stringify(selector)})]
           .find(b => b.textContent.trim() === ${JSON.stringify(text)})?.click(); true`,
      );
    };

    const closeModal = async () => {
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.modal-foot .btn')].find(b => b.textContent.trim() === '닫기' || b.textContent.trim() === '취소')?.click(); true`,
      );
      await wait(400);
    };

    win.setSize(DESKTOP.width, DESKTOP.height);
    await win.loadURL(BASE);
    await signIn();
    await shot('board', '.timeline .blk');

    await clickByText('.topbar .btn', '+ 예약 등록');
    await shot('new-reservation', '.modal .quote-box');
    await closeModal();

    await clickByText('.topbar .btn', '폰 연결');
    await shot('connect-qr', '.modal svg[role="img"]');
    await closeModal();

    /* ------------------------------ 폰 화면 ------------------------------ */
    win.setSize(PHONE.width, PHONE.height);

    await signOut();
    await shot('phone-pin', '.pin-card .keypad');

    await signIn();
    await shot('phone-slots', '.m-slots .m-slot');

    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.bottom-tabs button')].find(b => b.textContent.includes('예약 목록'))?.click(); true`,
    );
    await shot('phone-list', '.card .badge');

    await win.webContents.executeJavaScript(`document.querySelector('.fab')?.click(); true`);
    await shot('phone-new', '.modal .quote-box');

    console.log('완료');
  } catch (error) {
    console.error('실패:', error);
  } finally {
    win?.destroy();
    server.kill();
    app.exit(0);
  }
});
