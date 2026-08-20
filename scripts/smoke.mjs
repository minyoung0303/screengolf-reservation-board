/**
 * 자동 점검: 서버를 실제로 띄우고 API 를 호출해서 핵심 규칙을 확인한다.
 * - 소요시간 계산 (인원 × 게임 × 30분)
 * - 중복 예약 차단 (같은 타석 시간 겹침)
 * - 자리가 없을 때 대안 시간 제시
 * - PIN 잠금, 시도 횟수 제한, 인증 없는 접근 차단
 *
 * 실행: node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
const DESKTOP_TOKEN = 'smoke-desktop-token';
const DATE = '2026-09-01';
const dataDir = path.join(os.tmpdir(), `yeyakbo-smoke-${Date.now()}`);

let pass = 0;
let fail = 0;

function ok(label) {
  pass += 1;
  console.log(`  \u2713 ${label}`);
}

function bad(label, detail) {
  fail += 1;
  console.error(`  \u2717 ${label}`);
  if (detail !== undefined) console.error(`      ${detail}`);
}

function check(label, condition, detail) {
  if (condition) ok(label);
  else bad(label, detail);
}

async function call(method, url, body, token = DESKTOP_TOKEN) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

const server = spawn(
  process.execPath,
  [
    'dist/main/standalone.js',
    '--data',
    dataDir,
    '--port',
    String(PORT),
    '--token',
    DESKTOP_TOKEN,
    '--static',
    'dist/renderer',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

server.stdout.on('data', (d) => process.stdout.write(`    [server] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`    [server:err] ${d}`));

async function waitReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* 아직 안 뜸 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function cleanup() {
  server.kill();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* 무시 */
  }
}

try {
  if (!(await waitReady())) throw new Error('서버가 시작되지 않았습니다.');

  console.log('\n[1] 인증과 PIN');
  {
    const health = await call('GET', '/api/health', undefined, '');
    check('PIN 설정 전에는 pinSet=false', health.body.pinSet === false, JSON.stringify(health.body));

    const noAuth = await call('GET', '/api/day?date=' + DATE, undefined, '');
    check('토큰 없이 조회하면 401', noAuth.status === 401, `status=${noAuth.status}`);

    const early = await call('POST', '/api/auth/login', { pin: '1379' }, '');
    check('PIN 설정 전 로그인은 503', early.status === 503, `status=${early.status}`);

    const weak1 = await call('POST', '/api/auth/setup-pin', { pin: '0000' }, '');
    check('0000 은 거부', weak1.status === 400 && weak1.body.error === 'WEAK_PIN', JSON.stringify(weak1.body));

    const weak2 = await call('POST', '/api/auth/setup-pin', { pin: '1234' }, '');
    check('1234 는 거부', weak2.status === 400 && weak2.body.error === 'WEAK_PIN', JSON.stringify(weak2.body));

    const short = await call('POST', '/api/auth/setup-pin', { pin: '12' }, '');
    check('2자리는 거부', short.status === 400, JSON.stringify(short.body));

    const setup = await call('POST', '/api/auth/setup-pin', { pin: '7392' }, '');
    check('PIN 설정 성공', setup.status === 200, JSON.stringify(setup.body));

    const again = await call('POST', '/api/auth/setup-pin', { pin: '7392' }, '');
    check('이미 설정된 PIN 재설정은 거부', again.status === 409, `status=${again.status}`);

    const wrong = await call('POST', '/api/auth/login', { pin: '9999' }, '');
    check('틀린 PIN 은 403', wrong.status === 403, JSON.stringify(wrong.body));

    const login = await call('POST', '/api/auth/login', { pin: '7392', label: '태블릿' }, '');
    check('맞는 PIN 으로 토큰 발급', login.status === 200 && typeof login.body.token === 'string');

    if (login.body.token) {
      const me = await call('GET', '/api/auth/me', undefined, login.body.token);
      check('발급된 토큰으로 조회 가능', me.status === 200 && me.body.kind === 'remote', JSON.stringify(me.body));

      const pinChange = await call(
        'POST',
        '/api/auth/change-pin',
        { currentPin: '7392', newPin: '5150' },
        login.body.token,
      );
      check('폰에서 PIN 변경은 거부', pinChange.status === 403, `status=${pinChange.status}`);
    }
  }

  console.log('\n[2] 기본 설정');
  let rooms = [];
  {
    const boot = await call('GET', '/api/bootstrap');
    rooms = boot.body.rooms ?? [];
    check('타석 10개 자동 생성', rooms.length === 10, `rooms=${rooms.length}`);
    check('전 타석 최대 6명', rooms.every((r) => r.capacity === 6));
    check('영업 08:30 ~ 21:00', boot.body.settings.openMin === 510 && boot.body.settings.closeMin === 1260,
      JSON.stringify(boot.body.settings));
    check('마지막 입장 21:00', boot.body.settings.lastEntryMin === 1260);
    check('여유시간 10분', boot.body.settings.bufferMin === 10);
    check('1인 1게임 30분 규칙 6줄', (boot.body.durationRules ?? []).length === 6);
  }

  console.log('\n[3] 소요시간 계산');
  {
    const q1 = await call('POST', '/api/quote', { date: DATE, startMin: 840, partySize: 2, gameCount: 2 });
    check('2명 2게임 = 120분', q1.body.playMin === 120, `playMin=${q1.body.playMin}`);
    check('14:00 시작이면 16:00 종료', q1.body.endMin === 960, `endMin=${q1.body.endMin}`);
    check('정리 10분 포함 16:10 까지 점유', q1.body.blockEndMin === 970, `blockEnd=${q1.body.blockEndMin}`);

    const q2 = await call('POST', '/api/quote', { date: DATE, startMin: 840, partySize: 1, gameCount: 2 });
    check('1명 2게임 = 60분', q2.body.playMin === 60, `playMin=${q2.body.playMin}`);

    const q3 = await call('POST', '/api/quote', { date: DATE, startMin: 840, partySize: 4, gameCount: 2 });
    check('4명 2게임 = 240분', q3.body.playMin === 240, `playMin=${q3.body.playMin}`);

    const q4 = await call('POST', '/api/quote', { date: DATE, startMin: 1260, partySize: 2, gameCount: 2 });
    check('21:00 예약은 영업종료 초과 경고', q4.body.warnings.length > 0, JSON.stringify(q4.body.warnings));

    const bad1 = await call('POST', '/api/quote', { date: DATE, startMin: 840, partySize: 7, gameCount: 1 });
    check('7명은 입력 거부(최대 6명)', bad1.status === 400, `status=${bad1.status}`);

    const bad2 = await call('POST', '/api/quote', { date: '2026-9-1', startMin: 840, partySize: 2, gameCount: 1 });
    check('잘못된 날짜 형식 거부', bad2.status === 400, `status=${bad2.status}`);
  }

  console.log('\n[4] 예약 저장과 중복 차단');
  let first = null;
  {
    const created = await call('POST', '/api/reservations', {
      date: DATE,
      roomId: null,
      name: '김민수',
      phone: '010-1234-5678',
      partySize: 2,
      gameCount: 2,
      startMin: 840,
      isWalkin: false,
      memo: '',
    });
    first = created.body;
    check('자동 배정으로 예약 생성', created.status === 200 && first.id > 0, JSON.stringify(created.body));
    check('1번 타석에 배정', first.roomId === 1, `roomId=${first.roomId}`);
    check('종료 16:00 / 점유 16:10', first.endMin === 960 && first.blockEndMin === 970);

    const sameRoom = await call('POST', '/api/reservations', {
      date: DATE,
      roomId: 1,
      name: '겹침',
      phone: '',
      partySize: 2,
      gameCount: 1,
      startMin: 900,
      isWalkin: false,
      memo: '',
    });
    check('같은 타석 겹치는 시간은 409', sameRoom.status === 409, `status=${sameRoom.status}`);

    const adjacent = await call('POST', '/api/reservations', {
      date: DATE,
      roomId: 1,
      name: '바로 다음',
      phone: '',
      partySize: 1,
      gameCount: 1,
      startMin: 970,
      isWalkin: false,
      memo: '',
    });
    check('정리시간 직후(16:10) 시작은 허용', adjacent.status === 200, JSON.stringify(adjacent.body));

    const oneMinBefore = await call('POST', '/api/reservations', {
      date: DATE,
      roomId: 1,
      name: '10분 전',
      phone: '',
      partySize: 1,
      gameCount: 1,
      startMin: 960,
      isWalkin: false,
      memo: '',
    });
    check('정리시간과 겹치면 거부(16:00 시작)', oneMinBefore.status === 409, `status=${oneMinBefore.status}`);
  }

  console.log('\n[5] 자리가 다 찼을 때');
  {
    // 2~10번 타석을 14:00 로 모두 채운다 (1번은 이미 사용중)
    for (let roomId = 2; roomId <= 10; roomId += 1) {
      const res = await call('POST', '/api/reservations', {
        date: DATE,
        roomId,
        name: `손님${roomId}`,
        phone: '',
        partySize: 2,
        gameCount: 2,
        startMin: 840,
        isWalkin: false,
        memo: '',
      });
      if (res.status !== 200) bad(`${roomId}번 타석 채우기`, JSON.stringify(res.body));
    }
    ok('2~10번 타석 14:00 로 채움');

    const full = await call('POST', '/api/reservations', {
      date: DATE,
      roomId: null,
      name: '늦은 손님',
      phone: '',
      partySize: 2,
      gameCount: 2,
      startMin: 840,
      isWalkin: false,
      memo: '',
    });
    check('전 타석 마감이면 409 FULL', full.status === 409 && full.body.error === 'FULL', JSON.stringify(full.body));
    check('마감이면 대안 시간을 함께 알려줌', (full.body.quote?.alternatives ?? []).length > 0,
      JSON.stringify(full.body.quote?.alternatives));

    const q = await call('POST', '/api/quote', { date: DATE, startMin: 840, partySize: 2, gameCount: 2 });
    check('14:00 조회 결과 ok=false', q.body.ok === false);
    check('빈 타석 0개', (q.body.freeRoomIds ?? []).length === 0);

    const scan = await call('POST', '/api/scan', { date: DATE, partySize: 2, gameCount: 2 });
    const slot840 = (scan.body.slots ?? []).find((s) => s.startMin === 840);
    check('스캔 결과에 14:00 자리 없음 표시', slot840 && slot840.freeRoomIds.length === 0);
    // 08:30 부터 21:00 까지 30분 간격 = 26칸 (양 끝 포함)
    check('스캔은 영업시간 전체(26칸)', (scan.body.slots ?? []).length === 26, `slots=${scan.body.slots?.length}`);
  }

  console.log('\n[6] 취소하면 자리가 다시 열린다');
  {
    const cancel = await call('POST', `/api/reservations/${first.id}/status`, { status: 'cancelled' });
    check('예약 취소 처리', cancel.status === 200 && cancel.body.status === 'cancelled');

    const q = await call('POST', '/api/quote', { date: DATE, startMin: 840, partySize: 2, gameCount: 2 });
    check('취소한 1번 타석이 다시 비어 보임', q.body.ok === true && q.body.freeRoomIds.includes(1),
      JSON.stringify(q.body.freeRoomIds));

    const revive = await call('POST', `/api/reservations/${first.id}/status`, { status: 'booked' });
    check('취소한 예약 되살리기', revive.status === 200 && revive.body.status === 'booked');
  }

  console.log('\n[7] 연장과 이동');
  {
    const target = await call('POST', '/api/reservations', {
      date: DATE,
      roomId: 1,
      name: '연장 대상',
      phone: '',
      partySize: 1,
      gameCount: 1,
      startMin: 1100,
      isWalkin: false,
      memo: '',
    });
    check('18:20 예약 생성', target.status === 200, JSON.stringify(target.body));

    const extended = await call('POST', `/api/reservations/${target.body.id}/extend`, { addMin: 30 });
    check('30분 연장 반영', extended.body.playMin === 60, `playMin=${extended.body.playMin}`);

    const games = await call('POST', `/api/reservations/${target.body.id}/extend`, { addGames: 1 });
    check('1게임 추가 시 재계산(1명 2게임=60분)', games.body.playMin === 60 && games.body.gameCount === 2,
      JSON.stringify({ playMin: games.body.playMin, gameCount: games.body.gameCount }));

    const moved = await call('PATCH', `/api/reservations/${target.body.id}`, { roomId: 5, startMin: 1130 });
    check('다른 타석으로 이동', moved.status === 200 && moved.body.roomId === 5 && moved.body.startMin === 1130,
      JSON.stringify(moved.body));

    const collide = await call('PATCH', `/api/reservations/${target.body.id}`, { startMin: 840 });
    check('이동 시에도 겹침 검사', collide.status === 409, `status=${collide.status}`);
  }

  console.log('\n[8] 동시 저장 (두 기기에서 같은 자리)');
  {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call('POST', '/api/reservations', {
          date: DATE,
          roomId: 3,
          name: '동시',
          phone: '',
          partySize: 1,
          gameCount: 1,
          startMin: 1200,
          isWalkin: false,
          memo: '',
        }),
      ),
    );
    const okCount = results.filter((r) => r.status === 200).length;
    check('동시에 5번 시도해도 1건만 저장', okCount === 1, `성공=${okCount}`);
  }

  console.log('\n[9] 목록·검색·요약');
  {
    const day = await call('GET', `/api/day?date=${DATE}`);
    check('하루 조회 정상', day.status === 200 && Array.isArray(day.body.reservations));
    check('예약판 시작이 08:30', day.body.gridStartMin === 510, `grid=${day.body.gridStartMin}`);

    const search = await call('GET', '/api/search?q=5678');
    check('전화 뒷자리로 검색', (search.body.results ?? []).some((r) => r.name === '김민수'),
      JSON.stringify(search.body.results?.length));

    const byName = await call('GET', '/api/search?q=김민수');
    check('이름으로 검색', (byName.body.results ?? []).length > 0);

    const summary = await call('GET', `/api/summary?date=${DATE}`);
    check('시간대별 요약 반환', (summary.body.slots ?? []).length === 26, `slots=${summary.body.slots?.length}`);
  }

  console.log('\n[10] 워크인과 삭제');
  {
    const walkin = await call('POST', '/api/reservations', {
      date: DATE,
      roomId: null,
      name: '',
      phone: '',
      partySize: 3,
      gameCount: 1,
      startMin: 630,
      isWalkin: true,
      memo: '현장',
    });
    check('워크인 등록 시 바로 이용중 상태', walkin.body.status === 'checked_in', JSON.stringify(walkin.body.status));
    check('워크인 3명 1게임 = 90분', walkin.body.playMin === 90, `playMin=${walkin.body.playMin}`);

    const removed = await call('DELETE', `/api/reservations/${walkin.body.id}`);
    check('완전 삭제', removed.status === 200);

    const gone = await call('POST', `/api/reservations/${walkin.body.id}/status`, { status: 'booked' });
    check('삭제된 예약은 404', gone.status === 404, `status=${gone.status}`);
  }

  console.log('\n[11] 설정 변경');
  {
    const saved = await call('PUT', '/api/settings', {
      settings: { bufferMin: 20, storeName: '테스트점' },
      durationRules: [{ partySize: 6, minutesPerGame: 15 }],
    });
    check('설정 저장', saved.status === 200 && saved.body.settings.bufferMin === 20,
      JSON.stringify(saved.body.settings?.bufferMin));

    const q = await call('POST', '/api/quote', { date: DATE, startMin: 630, partySize: 6, gameCount: 2 });
    check('6명 규칙 15분으로 바꾸면 2게임 = 180분', q.body.playMin === 180, `playMin=${q.body.playMin}`);
    check('바뀐 여유시간 20분 반영', q.body.bufferMin === 20, `buffer=${q.body.bufferMin}`);

    const badTime = await call('PUT', '/api/settings', { settings: { openMin: 1300, closeMin: 600 } });
    check('영업 종료가 시작보다 빠르면 거부', badTime.status === 400, `status=${badTime.status}`);

    await call('PUT', '/api/settings', {
      settings: { bufferMin: 10 },
      durationRules: [{ partySize: 6, minutesPerGame: 30 }],
    });
  }

  console.log('\n[12] 백업');
  {
    const backup = await call('POST', '/api/backup');
    check('백업 파일 생성', backup.status === 200 && fs.existsSync(backup.body.file), JSON.stringify(backup.body.file));
    check('백업 목록 조회', (backup.body.backups ?? []).length >= 1);
  }

  console.log('\n[13] PIN 재설정과 외부 요청 차단');
  {
    // 카운터 PC(127.0.0.1)에서는 현재 PIN 을 몰라도 새로 정할 수 있어야 한다 (PIN 분실 대비)
    const reset = await call('POST', '/api/auth/change-pin', { currentPin: '', newPin: '2846' }, '');
    check('카운터 PC 에서 현재 PIN 없이 재설정', reset.status === 200, JSON.stringify(reset.body));

    const oldLogin = await call('POST', '/api/auth/login', { pin: '7392' }, '');
    check('이전 PIN 은 더이상 안 통함', oldLogin.status === 403, `status=${oldLogin.status}`);

    const newLogin = await call('POST', '/api/auth/login', { pin: '2846', label: '폰' }, '');
    check('새 PIN 으로 로그인', newLogin.status === 200 && Boolean(newLogin.body.token));

    // 다른 웹사이트가 몰래 보내는 요청(CSRF)은 막혀야 한다
    const evil = await fetch(`${BASE}/api/auth/change-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'http://evil.example.com' },
      body: JSON.stringify({ newPin: '9182' }),
    });
    check('외부 사이트에서 온 요청 차단', evil.status === 403, `status=${evil.status}`);

    const stillWorks = await call('POST', '/api/auth/login', { pin: '2846' }, '');
    check('차단 후에도 PIN 은 그대로', stillWorks.status === 200);
  }

  console.log('\n[14] 폰·태블릿 홈 화면 설정 (안드로이드 / 아이폰)');
  {
    const page = await fetch(`${BASE}/`);
    const html = await page.text();
    check('접속 첫 화면 열림', page.status === 200 && html.includes('<div id="root">'));
    check(
      '아이폰 홈 화면 설정 포함',
      html.includes('apple-mobile-web-app-capable') && html.includes('apple-touch-icon'),
    );
    check('안드로이드 홈 화면 설정 포함', html.includes('manifest.webmanifest'));

    const manifest = await fetch(`${BASE}/manifest.webmanifest`);
    const type = manifest.headers.get('content-type') ?? '';
    check(
      '앱 정보 파일이 올바른 형식으로 전달됨',
      manifest.status === 200 && type.includes('application/manifest+json'),
      `status=${manifest.status} type=${type}`,
    );
    const parsed = await manifest.json().catch(() => ({}));
    check('앱 이름이 예약보드', parsed.name === '예약보드', JSON.stringify(parsed.name));
    check('주소창 없이 앱처럼 열리는 설정', parsed.display === 'standalone');
    check('아이콘 4종 등록', (parsed.icons ?? []).length === 4, `icons=${parsed.icons?.length}`);

    for (const icon of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'favicon-32.png']) {
      const res = await fetch(`${BASE}/${icon}`);
      const buf = await res.arrayBuffer();
      check(
        `${icon} 전달`,
        res.status === 200 &&
          (res.headers.get('content-type') ?? '').includes('image/png') &&
          buf.byteLength > 300,
        `status=${res.status} size=${buf.byteLength}`,
      );
    }
  }

  console.log('\n[15] PIN 시도 횟수 제한');
  {
    let locked = false;
    for (let i = 0; i < 6; i += 1) {
      const res = await call('POST', '/api/auth/login', { pin: '1357' }, '');
      if (res.status === 429) locked = true;
    }
    check('여러 번 틀리면 잠시 잠김(429)', locked);
  }
} catch (error) {
  bad('점검 중 오류', error instanceof Error ? error.stack : String(error));
} finally {
  cleanup();
}

console.log(`\n결과: 성공 ${pass}건 / 실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
