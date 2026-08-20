import { ceilTo, fmtTime } from '@shared/time';
import type {
  Alternative,
  DayPayload,
  Quote,
  Reservation,
  ReservationInput,
  ResStatus,
} from '@shared/types';
import {
  getDb,
  getReservation,
  getReservationsByDate,
  getRooms,
  getSettings,
  logChange,
  minutesPerGameFor,
} from './db';

/** 자리를 실제로 점유하는 상태. 취소/노쇼는 빈자리로 본다. */
const ACTIVE_SQL = "('booked','checked_in','done')";

export class AppError extends Error {
  status: number;
  code: string;
  quote?: Quote;

  constructor(status: number, code: string, message: string, quote?: Quote) {
    super(message);
    this.status = status;
    this.code = code;
    this.quote = quote;
  }
}

/**
 * 소요시간 = 인원 × 게임수 × (인원별) 1인 1게임 시간
 * 예: 2명 2게임 × 30분 = 120분. 1명 2게임 = 60분.
 */
export function computePlayMin(partySize: number, gameCount: number): number {
  return partySize * gameCount * minutesPerGameFor(partySize);
}

function validateBasics(partySize: number, gameCount: number, startMin: number): void {
  const settings = getSettings();
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > settings.maxParty) {
    throw new AppError(400, 'BAD_PARTY', `인원은 1~${settings.maxParty}명까지 입력할 수 있어요.`);
  }
  if (!Number.isInteger(gameCount) || gameCount < 1 || gameCount > settings.maxGames) {
    throw new AppError(400, 'BAD_GAMES', `게임 수는 1~${settings.maxGames}까지 입력할 수 있어요.`);
  }
  if (!Number.isInteger(startMin) || startMin < 0 || startMin > 1740) {
    throw new AppError(400, 'BAD_TIME', '시작 시각이 올바르지 않아요.');
  }
}

/** 같은 타석에서 시간이 겹치는 예약을 찾는다. 끝과 시작이 맞닿는 경우는 겹치지 않는다. */
export function findConflicts(
  date: string,
  roomId: number,
  startMin: number,
  blockEndMin: number,
  excludeId = 0,
): Reservation[] {
  return getDb()
    .prepare(
      `SELECT id, date, roomId, name, phone, partySize, gameCount, startMin, playMin, bufferMin,
              endMin, blockEndMin, isWalkin, status, memo, createdAt, updatedAt, createdBy
         FROM reservations
        WHERE date = ? AND roomId = ? AND status IN ${ACTIVE_SQL} AND id <> ?
          AND startMin < ? AND blockEndMin > ?
        ORDER BY startMin`,
    )
    .all(date, roomId, excludeId, blockEndMin, startMin) as unknown as Reservation[];
}

function freeRoomsAt(
  date: string,
  startMin: number,
  blockEndMin: number,
  excludeId = 0,
): { free: number[]; busy: number[] } {
  const free: number[] = [];
  const busy: number[] = [];
  for (const room of getRooms()) {
    if (findConflicts(date, room.id, startMin, blockEndMin, excludeId).length === 0) free.push(room.id);
    else busy.push(room.id);
  }
  return { free, busy };
}

function suggestAlternatives(
  date: string,
  playMin: number,
  bufferMin: number,
  requestedStart: number,
  excludeId: number,
  limit = 3,
): Alternative[] {
  const settings = getSettings();
  const found: Alternative[] = [];
  for (let start = settings.openMin; start <= settings.lastEntryMin; start += settings.slotMin) {
    if (start === requestedStart) continue;
    const { free } = freeRoomsAt(date, start, start + playMin + bufferMin, excludeId);
    if (free.length > 0) found.push({ startMin: start, endMin: start + playMin, freeRoomIds: free });
  }
  return found
    .sort((a, b) => Math.abs(a.startMin - requestedStart) - Math.abs(b.startMin - requestedStart))
    .slice(0, limit)
    .sort((a, b) => a.startMin - b.startMin);
}

export interface QuoteParams {
  date: string;
  startMin: number;
  partySize: number;
  gameCount: number;
  excludeId?: number;
  playMinOverride?: number | null;
  bufferMin?: number;
}

export function quote(params: QuoteParams): Quote {
  const { date, startMin, partySize, gameCount } = params;
  validateBasics(partySize, gameCount, startMin);
  const settings = getSettings();
  const excludeId = params.excludeId ?? 0;

  const minutesPerGame = minutesPerGameFor(partySize);
  const playMin =
    params.playMinOverride && params.playMinOverride > 0
      ? Math.round(params.playMinOverride)
      : computePlayMin(partySize, gameCount);
  const bufferMin = params.bufferMin ?? settings.bufferMin;
  const endMin = startMin + playMin;
  const blockEndMin = endMin + bufferMin;

  const { free, busy } = freeRoomsAt(date, startMin, blockEndMin, excludeId);

  const warnings: string[] = [];
  if (startMin < settings.openMin) {
    warnings.push(`영업 시작(${fmtTime(settings.openMin)}) 전 시간이에요.`);
  }
  if (startMin > settings.lastEntryMin) {
    warnings.push(`마지막 입장 시간(${fmtTime(settings.lastEntryMin)})을 넘겼어요.`);
  }
  if (endMin > settings.closeMin) {
    warnings.push(
      `종료가 ${fmtTime(endMin)}이라 영업 종료(${fmtTime(settings.closeMin)})를 넘겨요.`,
    );
  }

  return {
    ok: free.length > 0,
    startMin,
    playMin,
    endMin,
    blockEndMin,
    bufferMin,
    minutesPerGame,
    freeRoomIds: free,
    busyRoomIds: busy,
    alternatives:
      free.length > 0 ? [] : suggestAlternatives(date, playMin, bufferMin, startMin, excludeId),
    warnings,
  };
}

/* ------------------------------ 쓰기 작업 ------------------------------ */

function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 이미 롤백된 경우 무시 */
    }
    throw error;
  }
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function createReservation(input: ReservationInput, actor: string): Reservation {
  const q = quote({
    date: input.date,
    startMin: input.startMin,
    partySize: input.partySize,
    gameCount: input.gameCount,
    playMinOverride: input.playMinOverride ?? null,
    bufferMin: input.bufferMin,
  });

  const rooms = getRooms();
  if (rooms.length === 0) throw new AppError(400, 'NO_ROOM', '사용 가능한 타석이 없어요. 설정에서 타석을 켜주세요.');

  const requestedRoom = input.roomId ?? null;
  if (requestedRoom !== null && !rooms.some((r) => r.id === requestedRoom)) {
    throw new AppError(400, 'NO_ROOM', '선택한 타석을 찾을 수 없어요.');
  }

  const capacityRoom = rooms.find((r) => r.id === requestedRoom);
  if (capacityRoom && input.partySize > capacityRoom.capacity) {
    throw new AppError(
      400,
      'OVER_CAPACITY',
      `${capacityRoom.name} 타석은 최대 ${capacityRoom.capacity}명까지예요.`,
    );
  }

  return tx(() => {
    // 트랜잭션 안에서 다시 확인한다. 두 기기에서 동시에 같은 자리를 잡아도 한쪽만 저장된다.
    let roomId = requestedRoom;
    if (roomId === null) {
      const candidate = rooms.find(
        (room) =>
          room.capacity >= input.partySize &&
          findConflicts(input.date, room.id, q.startMin, q.blockEndMin).length === 0,
      );
      if (!candidate) {
        throw new AppError(
          409,
          'FULL',
          `${fmtTime(q.startMin)}에는 빈 타석이 없어요.`,
          quote({
            date: input.date,
            startMin: input.startMin,
            partySize: input.partySize,
            gameCount: input.gameCount,
          }),
        );
      }
      roomId = candidate.id;
    } else if (findConflicts(input.date, roomId, q.startMin, q.blockEndMin).length > 0) {
      throw new AppError(
        409,
        'CONFLICT',
        '그 타석은 해당 시간에 이미 예약이 있어요.',
        quote({
          date: input.date,
          startMin: input.startMin,
          partySize: input.partySize,
          gameCount: input.gameCount,
        }),
      );
    }

    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `INSERT INTO reservations
           (date, roomId, name, phone, partySize, gameCount, startMin, playMin, bufferMin,
            endMin, blockEndMin, isWalkin, status, memo, createdAt, updatedAt, createdBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.date,
        roomId,
        cleanText(input.name, 30),
        cleanText(input.phone, 20),
        input.partySize,
        input.gameCount,
        q.startMin,
        q.playMin,
        q.bufferMin,
        q.endMin,
        q.blockEndMin,
        input.isWalkin ? 1 : 0,
        input.isWalkin ? 'checked_in' : 'booked',
        cleanText(input.memo, 200),
        now,
        now,
        actor,
      );

    const id = Number(result.lastInsertRowid);
    logChange('create', id, actor, { date: input.date, roomId, startMin: q.startMin });
    return getReservation(id)!;
  });
}

export interface UpdatePatch {
  roomId?: number;
  name?: string;
  phone?: string;
  partySize?: number;
  gameCount?: number;
  startMin?: number;
  memo?: string;
  bufferMin?: number;
  playMinOverride?: number | null;
  keepPlayMin?: boolean;
}

export function updateReservation(id: number, patch: UpdatePatch, actor: string): Reservation {
  const before = getReservation(id);
  if (!before) throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없어요.');

  const partySize = patch.partySize ?? before.partySize;
  const gameCount = patch.gameCount ?? before.gameCount;
  const startMin = patch.startMin ?? before.startMin;
  const roomId = patch.roomId ?? before.roomId;
  const bufferMin = patch.bufferMin ?? before.bufferMin;

  validateBasics(partySize, gameCount, startMin);

  const room = getRooms(true).find((r) => r.id === roomId);
  if (!room) throw new AppError(400, 'NO_ROOM', '타석을 찾을 수 없어요.');
  if (partySize > room.capacity) {
    throw new AppError(400, 'OVER_CAPACITY', `${room.name} 타석은 최대 ${room.capacity}명까지예요.`);
  }

  let playMin: number;
  if (patch.playMinOverride !== undefined && patch.playMinOverride !== null) {
    playMin = Math.max(10, Math.round(patch.playMinOverride));
  } else if (patch.keepPlayMin) {
    playMin = before.playMin;
  } else {
    playMin = computePlayMin(partySize, gameCount);
  }

  const endMin = startMin + playMin;
  const blockEndMin = endMin + bufferMin;

  return tx(() => {
    const conflicts = findConflicts(before.date, roomId, startMin, blockEndMin, id);
    if (conflicts.length > 0) {
      const other = conflicts[0];
      throw new AppError(
        409,
        'CONFLICT',
        `${room.name} 타석 ${fmtTime(other.startMin)}~${fmtTime(other.endMin)} 예약과 겹쳐요.`,
        quote({ date: before.date, startMin, partySize, gameCount, excludeId: id }),
      );
    }

    getDb()
      .prepare(
        `UPDATE reservations SET roomId = ?, name = ?, phone = ?, partySize = ?, gameCount = ?,
           startMin = ?, playMin = ?, bufferMin = ?, endMin = ?, blockEndMin = ?, memo = ?, updatedAt = ?
         WHERE id = ?`,
      )
      .run(
        roomId,
        cleanText(patch.name ?? before.name, 30),
        cleanText(patch.phone ?? before.phone, 20),
        partySize,
        gameCount,
        startMin,
        playMin,
        bufferMin,
        endMin,
        blockEndMin,
        cleanText(patch.memo ?? before.memo, 200),
        new Date().toISOString(),
        id,
      );

    logChange('update', id, actor, {
      before: { roomId: before.roomId, startMin: before.startMin, endMin: before.endMin },
      after: { roomId, startMin, endMin },
    });
    return getReservation(id)!;
  });
}

export function setStatus(id: number, status: ResStatus, actor: string): Reservation {
  const before = getReservation(id);
  if (!before) throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없어요.');

  const allowed: ResStatus[] = ['booked', 'checked_in', 'done', 'no_show', 'cancelled'];
  if (!allowed.includes(status)) throw new AppError(400, 'BAD_STATUS', '알 수 없는 상태예요.');

  // 취소/노쇼 상태에서 되살릴 때는 자리가 비어 있는지 다시 확인한다.
  if (
    (before.status === 'cancelled' || before.status === 'no_show') &&
    (status === 'booked' || status === 'checked_in' || status === 'done')
  ) {
    const conflicts = findConflicts(
      before.date,
      before.roomId,
      before.startMin,
      before.blockEndMin,
      id,
    );
    if (conflicts.length > 0) {
      throw new AppError(409, 'CONFLICT', '그 자리에 이미 다른 예약이 들어갔어요. 시간을 옮겨주세요.');
    }
  }

  getDb()
    .prepare('UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
  logChange('status', id, actor, { from: before.status, to: status });
  return getReservation(id)!;
}

export function extendReservation(
  id: number,
  opts: { addMin?: number; addGames?: number },
  actor: string,
): Reservation {
  const before = getReservation(id);
  if (!before) throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없어요.');

  let playMin = before.playMin;
  let gameCount = before.gameCount;

  if (opts.addGames) {
    gameCount = Math.max(1, before.gameCount + opts.addGames);
    playMin = computePlayMin(before.partySize, gameCount);
  }
  if (opts.addMin) {
    playMin = Math.max(10, playMin + opts.addMin);
  }

  return updateReservation(
    id,
    { gameCount, playMinOverride: opts.addMin ? playMin : null },
    actor,
  );
}

export function deleteReservation(id: number, actor: string): void {
  const before = getReservation(id);
  if (!before) throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없어요.');
  getDb().prepare('DELETE FROM reservations WHERE id = ?').run(id);
  logChange('delete', id, actor, before);
}

/* ------------------------------ 조회 ------------------------------ */

export function buildDay(date: string): DayPayload {
  const settings = getSettings();
  const rooms = getRooms(true);
  const reservations = getReservationsByDate(date);
  const latest = reservations.reduce((max, r) => Math.max(max, r.blockEndMin), settings.closeMin);
  return {
    date,
    rooms,
    reservations,
    gridStartMin: settings.openMin,
    gridEndMin: Math.max(settings.closeMin, ceilTo(latest, settings.slotMin)),
  };
}

/**
 * 요청한 인원·게임수 그대로 하루 전체를 훑어서, 시작 가능한 시각을 알려준다.
 * 예약 등록 화면의 시간 버튼 색을 칠하는 데 쓴다. (30분 기준 잔여석이 아니라
 * "이 조건으로 정말 들어갈 수 있는 시간"이라 오안내가 생기지 않는다.)
 */
export function scanDay(params: {
  date: string;
  partySize: number;
  gameCount: number;
  excludeId?: number;
}): {
  playMin: number;
  bufferMin: number;
  slots: { startMin: number; freeRoomIds: number[] }[];
} {
  const settings = getSettings();
  validateBasics(params.partySize, params.gameCount, settings.openMin);
  const playMin = computePlayMin(params.partySize, params.gameCount);
  const bufferMin = settings.bufferMin;
  const excludeId = params.excludeId ?? 0;
  const slots: { startMin: number; freeRoomIds: number[] }[] = [];
  for (let start = settings.openMin; start <= settings.lastEntryMin; start += settings.slotMin) {
    const { free } = freeRoomsAt(params.date, start, start + playMin + bufferMin, excludeId);
    slots.push({ startMin: start, freeRoomIds: free });
  }
  return { playMin, bufferMin, slots };
}

/** 시간대별 남은 타석 수 (폰 화면 요약용) */
export function slotSummary(date: string): { startMin: number; freeCount: number; totalCount: number }[] {
  const settings = getSettings();
  const rooms = getRooms();
  const out: { startMin: number; freeCount: number; totalCount: number }[] = [];
  for (let start = settings.openMin; start <= settings.lastEntryMin; start += settings.slotMin) {
    const end = start + settings.slotMin;
    let freeCount = 0;
    for (const room of rooms) {
      if (findConflicts(date, room.id, start, end).length === 0) freeCount += 1;
    }
    out.push({ startMin: start, freeCount, totalCount: rooms.length });
  }
  return out;
}
