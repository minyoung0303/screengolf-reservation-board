import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { DurationRule, Reservation, Room, Settings } from '@shared/types';

/**
 * Node 24 에 내장된 node:sqlite 를 쓴다. 네이티브 모듈 컴파일이 필요 없어서
 * 다른 PC 에 설치할 때 빌드 도구(Visual Studio 등)를 요구하지 않는다.
 */

let db: DatabaseSync;
let dbFilePath = '';

const DEFAULT_SETTINGS: Settings = {
  storeName: '',
  openMin: 8 * 60 + 30, // 08:30
  closeMin: 21 * 60, // 21:00
  lastEntryMin: 21 * 60, // 21:00 마지막 입장
  bufferMin: 10, // 예약 사이 여유 10분
  slotMin: 30,
  maxGames: 5,
  maxParty: 6,
  retentionDays: 365,
  backupDir: '',
  requirePinOnDesktop: 0,
};

export function getDb(): DatabaseSync {
  if (!db) throw new Error('DB가 아직 열리지 않았습니다.');
  return db;
}

export function getDbPath(): string {
  return dbFilePath;
}

export function openDatabase(filePath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  dbFilePath = filePath;
  db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 4000');
  migrate();
  return db;
}

function migrate(): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  const version = Number(row?.user_version ?? 0);

  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id        INTEGER PRIMARY KEY,
        name      TEXT    NOT NULL,
        capacity  INTEGER NOT NULL DEFAULT 6,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        active    INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        date        TEXT    NOT NULL,
        roomId      INTEGER NOT NULL REFERENCES rooms(id),
        name        TEXT    NOT NULL DEFAULT '',
        phone       TEXT    NOT NULL DEFAULT '',
        partySize   INTEGER NOT NULL,
        gameCount   INTEGER NOT NULL,
        startMin    INTEGER NOT NULL,
        playMin     INTEGER NOT NULL,
        bufferMin   INTEGER NOT NULL DEFAULT 0,
        endMin      INTEGER NOT NULL,
        blockEndMin INTEGER NOT NULL,
        isWalkin    INTEGER NOT NULL DEFAULT 0,
        status      TEXT    NOT NULL DEFAULT 'booked',
        memo        TEXT    NOT NULL DEFAULT '',
        createdAt   TEXT    NOT NULL,
        updatedAt   TEXT    NOT NULL,
        createdBy   TEXT    NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idxResDateRoom ON reservations (date, roomId, status);
      CREATE INDEX IF NOT EXISTS idxResPhone    ON reservations (phone);
      CREATE INDEX IF NOT EXISTS idxResName     ON reservations (name);

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS durationRules (
        partySize      INTEGER PRIMARY KEY,
        minutesPerGame INTEGER NOT NULL
      );

      /* PIN 해시는 설정과 분리해서 보관한다. 설정 조회 API 로 새어나가지 않게 하려는 목적. */
      CREATE TABLE IF NOT EXISTS security (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        label      TEXT NOT NULL DEFAULT '',
        ip         TEXT NOT NULL DEFAULT '',
        createdAt  TEXT NOT NULL,
        lastSeenAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS changeLog (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        at            TEXT NOT NULL,
        action        TEXT NOT NULL,
        reservationId INTEGER,
        actor         TEXT NOT NULL DEFAULT '',
        detail        TEXT NOT NULL DEFAULT ''
      );
    `);
    db.exec('PRAGMA user_version = 1');
  }

  seed();
}

function seed(): void {
  const roomCount = Number((db.prepare('SELECT COUNT(*) AS c FROM rooms').get() as { c: number }).c);
  if (roomCount === 0) {
    const insert = db.prepare(
      'INSERT INTO rooms (id, name, capacity, sortOrder, active) VALUES (?, ?, ?, ?, 1)',
    );
    for (let i = 1; i <= 10; i += 1) insert.run(i, `${i}번`, 6, i);
  }

  const ruleCount = Number(
    (db.prepare('SELECT COUNT(*) AS c FROM durationRules').get() as { c: number }).c,
  );
  if (ruleCount === 0) {
    const insert = db.prepare('INSERT INTO durationRules (partySize, minutesPerGame) VALUES (?, ?)');
    // 1인 1게임 30분 기준. 인원이 많을 때 실제 소요시간이 다르면 설정에서 조정한다.
    for (let p = 1; p <= 6; p += 1) insert.run(p, 30);
  }

  const insertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(key, String(value));
  }
}

/* ------------------------------- 설정 ------------------------------- */

export function getSettings(): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as unknown as {
    key: string;
    value: string;
  }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULT_SETTINGS } as Record<string, string | number>;
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const raw = map.get(key);
    if (raw === undefined) continue;
    out[key] = typeof fallback === 'number' ? Number(raw) : raw;
  }
  return out as unknown as Settings;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    if (value === undefined || value === null) continue;
    stmt.run(key, String(value));
  }
  return getSettings();
}

/* --------------------------- 소요시간 규칙 --------------------------- */

export function getDurationRules(): DurationRule[] {
  return db
    .prepare('SELECT partySize, minutesPerGame FROM durationRules ORDER BY partySize')
    .all() as unknown as DurationRule[];
}

export function saveDurationRules(rules: DurationRule[]): DurationRule[] {
  const stmt = db.prepare(
    'INSERT INTO durationRules (partySize, minutesPerGame) VALUES (?, ?) ON CONFLICT(partySize) DO UPDATE SET minutesPerGame = excluded.minutesPerGame',
  );
  for (const rule of rules) {
    const size = Math.round(Number(rule.partySize));
    const minutes = Math.round(Number(rule.minutesPerGame));
    if (!Number.isFinite(size) || size < 1 || size > 20) continue;
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) continue;
    stmt.run(size, minutes);
  }
  return getDurationRules();
}

export function minutesPerGameFor(partySize: number): number {
  const row = db
    .prepare('SELECT minutesPerGame FROM durationRules WHERE partySize = ?')
    .get(partySize) as { minutesPerGame: number } | undefined;
  if (row) return Number(row.minutesPerGame);
  const max = db
    .prepare('SELECT minutesPerGame FROM durationRules ORDER BY partySize DESC LIMIT 1')
    .get() as { minutesPerGame: number } | undefined;
  return Number(max?.minutesPerGame ?? 30);
}

/* -------------------------------- 타석 -------------------------------- */

export function getRooms(includeInactive = false): Room[] {
  const sql = includeInactive
    ? 'SELECT id, name, capacity, sortOrder, active FROM rooms ORDER BY sortOrder, id'
    : 'SELECT id, name, capacity, sortOrder, active FROM rooms WHERE active = 1 ORDER BY sortOrder, id';
  return db.prepare(sql).all() as unknown as Room[];
}

export function saveRooms(rooms: Room[]): Room[] {
  const upsert = db.prepare(
    `INSERT INTO rooms (id, name, capacity, sortOrder, active) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, capacity = excluded.capacity,
       sortOrder = excluded.sortOrder, active = excluded.active`,
  );
  for (const room of rooms) {
    const id = Math.round(Number(room.id));
    if (!Number.isFinite(id) || id < 1) continue;
    upsert.run(
      id,
      String(room.name ?? `${id}번`).slice(0, 20),
      Math.min(50, Math.max(1, Math.round(Number(room.capacity) || 6))),
      Math.round(Number(room.sortOrder) || id),
      room.active ? 1 : 0,
    );
  }
  return getRooms(true);
}

/* ------------------------------- 예약 ------------------------------- */

const RES_COLUMNS = `id, date, roomId, name, phone, partySize, gameCount, startMin, playMin,
  bufferMin, endMin, blockEndMin, isWalkin, status, memo, createdAt, updatedAt, createdBy`;

export function getReservationsByDate(date: string): Reservation[] {
  return db
    .prepare(`SELECT ${RES_COLUMNS} FROM reservations WHERE date = ? ORDER BY startMin, roomId`)
    .all(date) as unknown as Reservation[];
}

export function getReservation(id: number): Reservation | undefined {
  return db.prepare(`SELECT ${RES_COLUMNS} FROM reservations WHERE id = ?`).get(id) as unknown as
    | Reservation
    | undefined;
}

export function searchReservations(query: string, limit = 60): Reservation[] {
  const digits = query.replace(/\D/g, '');
  const like = `%${query.trim()}%`;
  if (digits.length >= 2) {
    return db
      .prepare(
        `SELECT ${RES_COLUMNS} FROM reservations
         WHERE replace(replace(phone, '-', ''), ' ', '') LIKE ? OR name LIKE ?
         ORDER BY date DESC, startMin DESC LIMIT ?`,
      )
      .all(`%${digits}%`, like, limit) as unknown as Reservation[];
  }
  return db
    .prepare(
      `SELECT ${RES_COLUMNS} FROM reservations WHERE name LIKE ? OR memo LIKE ?
       ORDER BY date DESC, startMin DESC LIMIT ?`,
    )
    .all(like, like, limit) as unknown as Reservation[];
}

export function logChange(
  action: string,
  reservationId: number | null,
  actor: string,
  detail: unknown,
): void {
  db.prepare(
    'INSERT INTO changeLog (at, action, reservationId, actor, detail) VALUES (?, ?, ?, ?, ?)',
  ).run(
    new Date().toISOString(),
    action,
    reservationId,
    actor,
    typeof detail === 'string' ? detail : JSON.stringify(detail ?? {}),
  );
}

/** 오래된 예약 정리. retentionDays 가 0 이면 삭제하지 않는다. */
export function purgeOldReservations(): number {
  const { retentionDays } = getSettings();
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const iso = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(
    cutoff.getDate(),
  ).padStart(2, '0')}`;
  const result = db.prepare('DELETE FROM reservations WHERE date < ?').run(iso);
  db.prepare('DELETE FROM changeLog WHERE at < ?').run(cutoff.toISOString());
  return Number(result.changes ?? 0);
}

/* ------------------------------ 보안/세션 ------------------------------ */

export function getSecurity(key: string): string | null {
  const row = db.prepare('SELECT value FROM security WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSecurity(key: string, value: string): void {
  db.prepare(
    'INSERT INTO security (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function insertSession(
  token: string,
  kind: 'desktop' | 'remote',
  label: string,
  ip: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO sessions (token, kind, label, ip, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(token, kind, label, ip, now, now);
}

export function findSession(
  token: string,
): { token: string; kind: string; label: string; ip: string; createdAt: string } | undefined {
  return db
    .prepare('SELECT token, kind, label, ip, createdAt FROM sessions WHERE token = ?')
    .get(token) as never;
}

export function touchSession(token: string): void {
  db.prepare('UPDATE sessions SET lastSeenAt = ? WHERE token = ?').run(
    new Date().toISOString(),
    token,
  );
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** PIN 을 바꾸면 기존 원격 세션은 모두 끊는다. */
export function deleteRemoteSessions(): void {
  db.prepare("DELETE FROM sessions WHERE kind = 'remote'").run();
}

export function deleteExpiredSessions(days = 30): void {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  db.prepare('DELETE FROM sessions WHERE lastSeenAt < ?').run(cutoff.toISOString());
}

export function countRemoteSessions(): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE kind = 'remote'").get() as {
    c: number;
  };
  return Number(row.c);
}

/** WAL 을 본 파일에 반영한다. 백업 직전에 호출해야 최신 데이터가 복사된다. */
export function checkpoint(): void {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* 체크포인트 실패는 치명적이지 않다 */
  }
}

export function closeDatabase(): void {
  if (!db) return;
  checkpoint();
  db.close();
}
