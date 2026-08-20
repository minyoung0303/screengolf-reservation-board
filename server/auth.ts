import crypto from 'node:crypto';
import {
  deleteRemoteSessions,
  deleteSession,
  findSession,
  getSecurity,
  getSettings,
  insertSession,
  logChange,
  setSecurity,
  touchSession,
} from './db';
import { AppError } from './engine';

/**
 * 매장 와이파이를 손님과 함께 쓰기 때문에 PIN 잠금은 필수다.
 * 같은 와이파이에 있는 누구나 주소만 알면 접속할 수 있으므로,
 * PIN 이 설정되기 전에는 원격(폰/태블릿) 접속을 아예 막는다.
 */

const SCRYPT_KEYLEN = 32;
const MAX_FAILS_BEFORE_LOCK = 5;

interface Attempt {
  fails: number;
  lockedUntil: number;
}

const attempts = new Map<string, Attempt>();

let desktopToken = '';

export function setDesktopToken(token: string): void {
  desktopToken = token;
}

export function isPinSet(): boolean {
  return Boolean(getSecurity('pinHash') && getSecurity('pinSalt'));
}

function hashPin(pin: string, salt: string): Buffer {
  return crypto.scryptSync(pin.normalize('NFKC'), salt, SCRYPT_KEYLEN);
}

/** PIN 규칙: 숫자 4~8자리. 0000 처럼 전부 같은 숫자나 1234 같은 연속 숫자는 거부한다. */
export function validatePinFormat(pin: string): void {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new AppError(400, 'BAD_PIN', 'PIN은 숫자 4~8자리로 정해주세요.');
  }
  if (/^(\d)\1+$/.test(pin)) {
    throw new AppError(400, 'WEAK_PIN', '같은 숫자만 반복되는 PIN은 쓸 수 없어요. (예: 0000)');
  }
  const digits = pin.split('').map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10);
  const descending = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10);
  if (ascending || descending) {
    throw new AppError(400, 'WEAK_PIN', '1234 처럼 연속된 숫자는 쓸 수 없어요.');
  }
}

export function setupPin(pin: string): void {
  if (isPinSet()) throw new AppError(409, 'PIN_EXISTS', 'PIN이 이미 설정되어 있어요.');
  validatePinFormat(pin);
  const salt = crypto.randomBytes(16).toString('hex');
  setSecurity('pinSalt', salt);
  setSecurity('pinHash', hashPin(pin, salt).toString('hex'));
  logChange('pin_setup', null, 'desktop', {});
}

export function verifyPin(pin: string): boolean {
  const salt = getSecurity('pinSalt');
  const stored = getSecurity('pinHash');
  if (!salt || !stored) return false;
  const expected = Buffer.from(stored, 'hex');
  const actual = hashPin(pin, salt);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * PIN 변경. 카운터 PC(loopback 접속)는 이미 데이터 전체를 볼 수 있는 위치이므로
 * 현재 PIN 없이도 다시 정할 수 있게 한다(allowReset). PIN 을 잊어버려도 매장에서
 * 직접 풀 수 있어야 하기 때문이다. 폰·태블릿에서는 아예 호출할 수 없다.
 */
export function changePin(currentPin: string, newPin: string, allowReset = false): void {
  if (!isPinSet()) {
    setupPin(newPin);
    return;
  }
  if (!(allowReset && currentPin.length === 0) && !verifyPin(currentPin)) {
    throw new AppError(403, 'WRONG_PIN', '현재 PIN이 맞지 않아요.');
  }
  validatePinFormat(newPin);
  const salt = crypto.randomBytes(16).toString('hex');
  setSecurity('pinSalt', salt);
  setSecurity('pinHash', hashPin(newPin, salt).toString('hex'));
  // PIN 을 바꾸면 폰/태블릿에 남아 있던 접속 권한을 모두 끊는다.
  deleteRemoteSessions();
  logChange('pin_change', null, 'desktop', {});
}

/* --------------------------- 시도 횟수 제한 --------------------------- */

export function checkLock(ip: string): void {
  const entry = attempts.get(ip);
  if (!entry) return;
  const remain = entry.lockedUntil - Date.now();
  if (remain > 0) {
    const seconds = Math.ceil(remain / 1000);
    throw new AppError(
      429,
      'LOCKED',
      seconds > 60
        ? `PIN을 여러 번 틀렸어요. ${Math.ceil(seconds / 60)}분 후에 다시 시도해주세요.`
        : `PIN을 여러 번 틀렸어요. ${seconds}초 후에 다시 시도해주세요.`,
    );
  }
}

function recordFail(ip: string): void {
  const entry = attempts.get(ip) ?? { fails: 0, lockedUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= MAX_FAILS_BEFORE_LOCK) {
    const step = Math.floor(entry.fails / MAX_FAILS_BEFORE_LOCK);
    const lockMs = step === 1 ? 60_000 : step === 2 ? 300_000 : 1_800_000;
    entry.lockedUntil = Date.now() + lockMs;
  }
  attempts.set(ip, entry);
  logChange('pin_fail', null, ip, { fails: entry.fails });
}

function clearFails(ip: string): void {
  attempts.delete(ip);
}

/** 남은 시도 횟수 (화면 안내용) */
export function remainingTries(ip: string): number {
  const entry = attempts.get(ip);
  if (!entry) return MAX_FAILS_BEFORE_LOCK;
  return Math.max(0, MAX_FAILS_BEFORE_LOCK - (entry.fails % MAX_FAILS_BEFORE_LOCK));
}

/* ------------------------------- 세션 ------------------------------- */

export interface Session {
  token: string;
  kind: 'desktop' | 'remote';
  label: string;
}

export function login(pin: string, ip: string, label: string): Session {
  checkLock(ip);
  if (!isPinSet()) {
    throw new AppError(
      503,
      'NO_PIN',
      '아직 PIN이 설정되지 않았어요. 카운터 컴퓨터에서 먼저 PIN을 정해주세요.',
    );
  }
  if (!verifyPin(pin)) {
    recordFail(ip);
    throw new AppError(
      403,
      'WRONG_PIN',
      `PIN이 맞지 않아요. (남은 시도 ${remainingTries(ip)}회)`,
    );
  }
  clearFails(ip);
  const token = crypto.randomBytes(24).toString('base64url');
  const deviceLabel = label.trim().slice(0, 30) || '기기';
  insertSession(token, 'remote', deviceLabel, ip);
  logChange('login', null, deviceLabel, { ip });
  return { token, kind: 'remote', label: deviceLabel };
}

export function logout(token: string): void {
  deleteSession(token);
}

/** 요청의 토큰을 확인한다. 인증되지 않으면 null. */
export function resolveSession(token: string | null): Session | null {
  if (!token) return null;

  if (desktopToken && token === desktopToken) {
    // 카운터 PC 자체는 물리적으로 접근이 통제되므로 기본적으로 PIN 없이 쓴다.
    // 설정에서 "카운터 PC에서도 PIN 요구"를 켜면 이 통로를 막는다.
    if (getSettings().requirePinOnDesktop) return null;
    return { token, kind: 'desktop', label: '카운터 PC' };
  }

  const row = findSession(token);
  if (!row) return null;
  touchSession(token);
  return { token: row.token, kind: row.kind === 'desktop' ? 'desktop' : 'remote', label: row.label };
}

export function isLocalAddress(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/, '');
  return clean === '127.0.0.1' || clean === '::1' || clean === 'localhost';
}
