/** 예약 상태. cancelled / no_show 는 중복 검사에서 제외된다. */
export type ResStatus = 'booked' | 'checked_in' | 'done' | 'no_show' | 'cancelled';

export const STATUS_LABEL: Record<ResStatus, string> = {
  booked: '예약',
  checked_in: '이용중',
  done: '완료',
  no_show: '노쇼',
  cancelled: '취소',
};

/** 중복 검사에 포함되는 상태 (자리를 실제로 점유하는 상태) */
export const ACTIVE_STATUSES: ResStatus[] = ['booked', 'checked_in', 'done'];

export interface Room {
  id: number;
  name: string;
  capacity: number;
  sortOrder: number;
  active: number; // 0 | 1
}

export interface Reservation {
  id: number;
  date: string; // YYYY-MM-DD
  roomId: number;
  name: string;
  phone: string;
  partySize: number;
  gameCount: number;
  startMin: number; // 자정 기준 분
  playMin: number; // 실제 이용 시간
  bufferMin: number; // 정리 여유 시간
  endMin: number; // startMin + playMin (손님에게 안내하는 종료 시각)
  blockEndMin: number; // endMin + bufferMin (중복 검사에 쓰는 점유 종료)
  isWalkin: number; // 0 | 1
  status: ResStatus;
  memo: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface Settings {
  storeName: string;
  openMin: number;
  closeMin: number;
  lastEntryMin: number;
  bufferMin: number;
  slotMin: number;
  maxGames: number;
  maxParty: number;
  retentionDays: number;
  backupDir: string;
  requirePinOnDesktop: number; // 0 | 1
}

export interface DurationRule {
  partySize: number;
  minutesPerGame: number;
}

export interface Alternative {
  startMin: number;
  endMin: number;
  freeRoomIds: number[];
}

export interface Quote {
  ok: boolean;
  startMin: number;
  playMin: number;
  endMin: number;
  blockEndMin: number;
  bufferMin: number;
  minutesPerGame: number;
  freeRoomIds: number[];
  busyRoomIds: number[];
  alternatives: Alternative[];
  warnings: string[];
}

export interface DayPayload {
  date: string;
  rooms: Room[];
  reservations: Reservation[];
  gridStartMin: number;
  gridEndMin: number;
}

export interface Bootstrap {
  settings: Settings;
  rooms: Room[];
  durationRules: DurationRule[];
  lanUrls: string[];
  serverTime: string;
  version: string;
  pinSet: boolean;
}

export interface ReservationInput {
  date: string;
  roomId: number | null; // null = 자동 배정
  name: string;
  phone: string;
  partySize: number;
  gameCount: number;
  startMin: number;
  isWalkin: boolean;
  memo: string;
  bufferMin?: number;
  playMinOverride?: number | null;
}

export interface ApiError {
  error: string;
  message: string;
  quote?: Quote;
}
