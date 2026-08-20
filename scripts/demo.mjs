/**
 * 시범용 데이터 만들기. 실제 매장 데이터와 섞이지 않도록 별도 폴더에 만든다.
 * 실행: node scripts/demo.mjs   ->  안내 문구에 나온 명령으로 프로그램을 열어 확인
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'demo-desktop-token';
const DEMO_PIN = '4739';
const dataDir = path.join(os.tmpdir(), 'yeyakbo-demo');

const pad = (n) => String(n).padStart(2, '0');
const today = new Date();
const DATE = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

fs.rmSync(dataDir, { recursive: true, force: true });

const server = spawn(
  process.execPath,
  ['dist/main/standalone.js', '--data', dataDir, '--port', String(PORT), '--token', TOKEN],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

async function call(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${TOKEN}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function waitReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return true;
    } catch {
      /* 대기 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('서버가 시작되지 않았습니다.');
}

const M = (h, m) => h * 60 + m;

const rows = [
  { start: M(9, 0), party: 2, games: 2, name: '박서준', phone: '01023451234', status: 'done' },
  { start: M(9, 30), party: 1, games: 2, name: '이하늘', phone: '01044445555', status: 'done' },
  { start: M(10, 30), party: 3, games: 1, name: '최윤아', phone: '01088887777', status: 'checked_in' },
  { start: M(11, 0), party: 2, games: 2, name: '정민호', phone: '01033332222', status: 'checked_in' },
  { start: M(12, 0), party: 1, games: 1, name: '', phone: '', walkin: true },
  { start: M(13, 0), party: 2, games: 2, name: '김도윤', phone: '01099991111', memo: '초보, 안내 필요' },
  { start: M(13, 30), party: 2, games: 2, name: '한지우', phone: '01012123434' },
  { start: M(14, 0), party: 4, games: 2, name: '오세영', phone: '01055556666', memo: '단체 · 생일' },
  { start: M(14, 0), party: 2, games: 1, name: '문가영', phone: '01077778888' },
  { start: M(14, 30), party: 1, games: 2, name: '류현진', phone: '01066667777' },
  { start: M(15, 0), party: 2, games: 2, name: '배수지', phone: '01021213434' },
  { start: M(16, 0), party: 3, games: 2, name: '신동엽', phone: '01031415926' },
  { start: M(17, 0), party: 2, games: 2, name: '고아라', phone: '01027182818' },
  { start: M(18, 0), party: 2, games: 2, name: '남주혁', phone: '01016180339', status: 'no_show' },
  { start: M(19, 0), party: 1, games: 2, name: '홍길동', phone: '01014142135' },
  { start: M(19, 30), party: 2, games: 2, name: '서지수', phone: '01011235813' },
];

try {
  await waitReady();
  await call('POST', '/api/auth/setup-pin', { pin: DEMO_PIN });

  let made = 0;
  for (const row of rows) {
    const res = await call('POST', '/api/reservations', {
      date: DATE,
      roomId: null,
      name: row.name ?? '',
      phone: row.phone ?? '',
      partySize: row.party,
      gameCount: row.games,
      startMin: row.start,
      isWalkin: Boolean(row.walkin),
      memo: row.memo ?? '',
    });
    if (res.status !== 200) {
      console.log(`  건너뜀 ${Math.floor(row.start / 60)}:${pad(row.start % 60)} ${row.name} → ${res.body.message ?? res.status}`);
      continue;
    }
    made += 1;
    if (row.status && row.status !== 'booked') {
      await call('POST', `/api/reservations/${res.body.id}/status`, { status: row.status });
    }
  }

  const day = await call('GET', `/api/day?date=${DATE}`);
  console.log(`\n시범 데이터 ${made}건 생성 (${DATE})`);
  console.log(`데이터 폴더: ${dataDir}`);
  console.log(`시범용 PIN: ${DEMO_PIN}`);
  console.log(`예약판 범위: ${day.body.gridStartMin} ~ ${day.body.gridEndMin} 분`);
  console.log('\n확인용 실행 명령 (실제 매장 데이터와 분리됨):');
  console.log(`  $env:YB_DATA_DIR="${dataDir}"; $env:YB_PORT="5190"; .\\release\\win-unpacked\\YeyakBo.exe`);
} finally {
  server.kill();
}
