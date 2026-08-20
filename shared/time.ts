/**
 * 시간은 전부 "자정 기준 분(정수)"으로 다룬다.
 * 08:30 -> 510, 21:00 -> 1260. 자정을 넘기면 1440 이상 값을 그대로 쓴다 (24:10 -> 1450).
 * 소수점이나 시간대 계산이 끼어들 여지를 없애기 위한 선택이다.
 */

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 510 -> "08:30", 1450 -> "24:10" */
export function fmtTime(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 자정을 넘기면 "익일 00:10" 형태로 표기 */
export function fmtTimeKo(min: number): string {
  if (min >= 1440) return `익일 ${fmtTime(min - 1440)}`;
  return fmtTime(min);
}

/** "08:30" -> 510, 잘못된 값이면 null */
export function parseHHMM(text: string): number | null {
  const m = /^(\d{1,2})\s*[:시]?\s*(\d{1,2})?\s*분?$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = m[2] === undefined ? 0 : Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 29 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/** 130 -> "2시간 10분", 40 -> "40분", 120 -> "2시간" */
export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

export function todayISO(now: Date = new Date()): string {
  return isoOf(now);
}

export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function dateFromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, days: number): string {
  const d = dateFromISO(iso);
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/** "2026-08-18" -> "8월 18일 (화)" */
export function fmtDateKo(iso: string): string {
  const d = dateFromISO(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[d.getDay()]})`;
}

/** "2026-08-18" -> "2026년 8월 18일 (화)" */
export function fmtDateKoFull(iso: string): string {
  const d = dateFromISO(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[d.getDay()]})`;
}

export function nowMin(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** step 단위로 내림 (14:47, 30 -> 14:30) */
export function floorTo(min: number, step: number): number {
  return Math.floor(min / step) * step;
}

/** step 단위로 올림 */
export function ceilTo(min: number, step: number): number {
  return Math.ceil(min / step) * step;
}

/** 가장 가까운 step 으로 반올림 */
export function roundTo(min: number, step: number): number {
  return Math.round(min / step) * step;
}

/** 두 구간이 겹치는지. 끝과 시작이 맞닿는 경우는 겹치지 않는다. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** 전화번호를 010-1234-5678 형태로 정리 (숫자만 남기고 하이픈 삽입) */
export function fmtPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) {
    if (d.startsWith('02')) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 9 && d.startsWith('02')) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return raw.trim();
}
