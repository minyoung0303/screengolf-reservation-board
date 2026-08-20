import { todayISO } from '@shared/time';
import type { ReservationInput, ResStatus, Room, Settings } from '@shared/types';
import {
  changePin,
  isPinSet,
  login,
  logout,
  resolveSession,
  setupPin,
} from './auth';
import { backupNow, lanUrls, listBackups } from './backup';
import {
  countRemoteSessions,
  deleteRemoteSessions,
  getDurationRules,
  getRooms,
  getSettings,
  saveDurationRules,
  saveRooms,
  saveSettings,
  searchReservations,
} from './db';
import {
  AppError,
  buildDay,
  createReservation,
  deleteReservation,
  extendReservation,
  quote,
  scanDay,
  setStatus,
  slotSummary,
  updateReservation,
} from './engine';
import { broadcast, sseHandler, type Ctx, type Route } from './server';

export interface ApiEnv {
  userDataDir: string;
  version: string;
  getPort: () => number;
}

function num(value: unknown, fallback = NaN): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function int(value: unknown, fallback = NaN): number {
  const n = num(value, fallback);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function str(value: unknown, max = 200): string {
  return String(value ?? '').slice(0, max);
}

function requireDate(value: unknown): string {
  const date = str(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError(400, 'BAD_DATE', '날짜 형식이 올바르지 않아요.');
  }
  return date;
}

function actorOf(ctx: Ctx): string {
  return ctx.session?.label ?? '알수없음';
}

function requireDesktop(ctx: Ctx): void {
  // PIN 설정/변경은 카운터 PC 에서만 가능하게 한다. 폰에서 남의 PIN 을 바꿔버리는 상황 방지.
  // 폰/태블릿 세션은 접속 위치와 무관하게 항상 거부한다.
  if (ctx.session?.kind === 'remote') {
    throw new AppError(403, 'DESKTOP_ONLY', 'PIN 설정은 카운터 컴퓨터에서만 바꿀 수 있어요.');
  }
  if (ctx.session?.kind === 'desktop') return;
  // 최초 PIN 설정은 아직 세션이 없는 상태이므로, 이 컴퓨터에서 온 요청만 허용한다.
  if (ctx.isLocal) return;
  throw new AppError(403, 'DESKTOP_ONLY', 'PIN 설정은 카운터 컴퓨터에서만 바꿀 수 있어요.');
}

function notifyChange(date: string): void {
  broadcast({ type: 'changed', date, at: new Date().toISOString() });
}

export function createRoutes(env: ApiEnv): Route[] {
  return [
    /* ------------------------------ 상태/인증 ------------------------------ */
    {
      method: 'GET',
      path: '/api/health',
      public: true,
      handler: () => ({
        ok: true,
        pinSet: isPinSet(),
        version: env.version,
        requirePinOnDesktop: Boolean(getSettings().requirePinOnDesktop),
      }),
    },
    {
      method: 'POST',
      path: '/api/auth/setup-pin',
      public: true,
      handler: (ctx) => {
        requireDesktop(ctx);
        setupPin(str(ctx.body.pin, 8));
        return { ok: true };
      },
    },
    {
      method: 'POST',
      path: '/api/auth/login',
      public: true,
      handler: (ctx) => {
        const session = login(str(ctx.body.pin, 8), ctx.ip, str(ctx.body.label, 30));
        return { token: session.token, kind: session.kind, label: session.label };
      },
    },
    {
      method: 'GET',
      path: '/api/auth/me',
      handler: (ctx) => ({ kind: ctx.session?.kind, label: ctx.session?.label }),
    },
    {
      method: 'POST',
      path: '/api/auth/logout',
      handler: (ctx) => {
        if (ctx.session && ctx.session.kind === 'remote') logout(ctx.session.token);
        return { ok: true };
      },
    },
    {
      method: 'POST',
      path: '/api/auth/change-pin',
      public: true,
      handler: (ctx) => {
        // 카운터 PC 에서만 가능. PIN 을 잊었을 때도 이 경로로 다시 정할 수 있다.
        requireDesktop(ctx);
        changePin(str(ctx.body.currentPin, 8), str(ctx.body.newPin, 8), true);
        return { ok: true, devicesRevoked: true };
      },
    },
    {
      method: 'GET',
      path: '/api/devices',
      handler: () => ({ remoteCount: countRemoteSessions() }),
    },
    {
      method: 'POST',
      path: '/api/devices/revoke',
      handler: (ctx) => {
        requireDesktop(ctx);
        deleteRemoteSessions();
        return { ok: true };
      },
    },

    /* -------------------------------- 조회 -------------------------------- */
    {
      method: 'GET',
      path: '/api/bootstrap',
      handler: () => ({
        settings: getSettings(),
        rooms: getRooms(true),
        durationRules: getDurationRules(),
        lanUrls: lanUrls(env.getPort()),
        serverTime: new Date().toISOString(),
        version: env.version,
        pinSet: isPinSet(),
        remoteCount: countRemoteSessions(),
      }),
    },
    {
      method: 'GET',
      path: '/api/day',
      handler: (ctx) => buildDay(requireDate(ctx.url.searchParams.get('date') ?? todayISO())),
    },
    {
      method: 'GET',
      path: '/api/summary',
      handler: (ctx) => ({
        date: requireDate(ctx.url.searchParams.get('date') ?? todayISO()),
        slots: slotSummary(requireDate(ctx.url.searchParams.get('date') ?? todayISO())),
      }),
    },
    {
      method: 'GET',
      path: '/api/search',
      handler: (ctx) => {
        const q = str(ctx.url.searchParams.get('q') ?? '', 40).trim();
        if (q.length < 2) return { results: [] };
        return { results: searchReservations(q) };
      },
    },
    {
      method: 'POST',
      path: '/api/scan',
      handler: (ctx) =>
        scanDay({
          date: requireDate(ctx.body.date),
          partySize: int(ctx.body.partySize),
          gameCount: int(ctx.body.gameCount),
          excludeId: int(ctx.body.excludeId, 0),
        }),
    },
    {
      method: 'POST',
      path: '/api/quote',
      handler: (ctx) =>
        quote({
          date: requireDate(ctx.body.date),
          startMin: int(ctx.body.startMin),
          partySize: int(ctx.body.partySize),
          gameCount: int(ctx.body.gameCount),
          excludeId: int(ctx.body.excludeId, 0),
        }),
    },

    /* -------------------------------- 예약 -------------------------------- */
    {
      method: 'POST',
      path: '/api/reservations',
      handler: (ctx) => {
        const input: ReservationInput = {
          date: requireDate(ctx.body.date),
          roomId: ctx.body.roomId === null || ctx.body.roomId === undefined ? null : int(ctx.body.roomId),
          name: str(ctx.body.name, 30),
          phone: str(ctx.body.phone, 20),
          partySize: int(ctx.body.partySize),
          gameCount: int(ctx.body.gameCount),
          startMin: int(ctx.body.startMin),
          isWalkin: Boolean(ctx.body.isWalkin),
          memo: str(ctx.body.memo, 200),
        };
        const created = createReservation(input, actorOf(ctx));
        notifyChange(created.date);
        return created;
      },
    },
    {
      method: 'PATCH',
      path: '/api/reservations/:id',
      handler: (ctx) => {
        const id = int(ctx.params.id);
        const updated = updateReservation(
          id,
          {
            roomId: ctx.body.roomId === undefined ? undefined : int(ctx.body.roomId),
            name: ctx.body.name === undefined ? undefined : str(ctx.body.name, 30),
            phone: ctx.body.phone === undefined ? undefined : str(ctx.body.phone, 20),
            partySize: ctx.body.partySize === undefined ? undefined : int(ctx.body.partySize),
            gameCount: ctx.body.gameCount === undefined ? undefined : int(ctx.body.gameCount),
            startMin: ctx.body.startMin === undefined ? undefined : int(ctx.body.startMin),
            memo: ctx.body.memo === undefined ? undefined : str(ctx.body.memo, 200),
            playMinOverride:
              ctx.body.playMinOverride === undefined || ctx.body.playMinOverride === null
                ? null
                : int(ctx.body.playMinOverride),
            keepPlayMin: Boolean(ctx.body.keepPlayMin),
          },
          actorOf(ctx),
        );
        notifyChange(updated.date);
        return updated;
      },
    },
    {
      method: 'POST',
      path: '/api/reservations/:id/status',
      handler: (ctx) => {
        const updated = setStatus(int(ctx.params.id), str(ctx.body.status, 20) as ResStatus, actorOf(ctx));
        notifyChange(updated.date);
        return updated;
      },
    },
    {
      method: 'POST',
      path: '/api/reservations/:id/extend',
      handler: (ctx) => {
        const updated = extendReservation(
          int(ctx.params.id),
          {
            addMin: ctx.body.addMin === undefined ? undefined : int(ctx.body.addMin),
            addGames: ctx.body.addGames === undefined ? undefined : int(ctx.body.addGames),
          },
          actorOf(ctx),
        );
        notifyChange(updated.date);
        return updated;
      },
    },
    {
      method: 'DELETE',
      path: '/api/reservations/:id',
      handler: (ctx) => {
        deleteReservation(int(ctx.params.id), actorOf(ctx));
        notifyChange(todayISO());
        return { ok: true };
      },
    },

    /* -------------------------------- 설정 -------------------------------- */
    {
      method: 'GET',
      path: '/api/settings',
      handler: () => ({
        settings: getSettings(),
        rooms: getRooms(true),
        durationRules: getDurationRules(),
        backups: listBackups(env.userDataDir),
        lanUrls: lanUrls(env.getPort()),
        remoteCount: countRemoteSessions(),
        pinSet: isPinSet(),
      }),
    },
    {
      method: 'PUT',
      path: '/api/settings',
      handler: (ctx) => {
        const patch = (ctx.body.settings ?? {}) as Partial<Settings>;
        const current = getSettings();
        const openMin = patch.openMin === undefined ? current.openMin : int(patch.openMin);
        const closeMin = patch.closeMin === undefined ? current.closeMin : int(patch.closeMin);
        const lastEntryMin =
          patch.lastEntryMin === undefined ? current.lastEntryMin : int(patch.lastEntryMin);

        if (openMin < 0 || openMin > 1439) throw new AppError(400, 'BAD_TIME', '영업 시작 시간이 올바르지 않아요.');
        if (closeMin <= openMin) throw new AppError(400, 'BAD_TIME', '영업 종료가 시작보다 빠를 수 없어요.');
        if (lastEntryMin < openMin || lastEntryMin > closeMin) {
          throw new AppError(400, 'BAD_TIME', '마지막 입장 시간은 영업 시간 안에 있어야 해요.');
        }

        const clean: Partial<Settings> = {
          storeName: patch.storeName === undefined ? undefined : str(patch.storeName, 30),
          openMin,
          closeMin,
          lastEntryMin,
          bufferMin:
            patch.bufferMin === undefined
              ? undefined
              : Math.min(120, Math.max(0, int(patch.bufferMin))),
          slotMin: patch.slotMin === undefined ? undefined : ([10, 15, 30, 60].includes(int(patch.slotMin)) ? int(patch.slotMin) : current.slotMin),
          maxGames:
            patch.maxGames === undefined ? undefined : Math.min(20, Math.max(1, int(patch.maxGames))),
          maxParty:
            patch.maxParty === undefined ? undefined : Math.min(50, Math.max(1, int(patch.maxParty))),
          retentionDays:
            patch.retentionDays === undefined
              ? undefined
              : Math.min(3650, Math.max(0, int(patch.retentionDays))),
          backupDir: patch.backupDir === undefined ? undefined : str(patch.backupDir, 300),
          requirePinOnDesktop:
            patch.requirePinOnDesktop === undefined ? undefined : patch.requirePinOnDesktop ? 1 : 0,
        };
        for (const key of Object.keys(clean) as (keyof Settings)[]) {
          if (clean[key] === undefined) delete clean[key];
        }
        const settings = saveSettings(clean);

        if (Array.isArray(ctx.body.durationRules)) {
          saveDurationRules(ctx.body.durationRules as { partySize: number; minutesPerGame: number }[]);
        }
        if (Array.isArray(ctx.body.rooms)) {
          saveRooms(ctx.body.rooms as Room[]);
        }

        broadcast({ type: 'settings', at: new Date().toISOString() });
        return {
          settings,
          rooms: getRooms(true),
          durationRules: getDurationRules(),
        };
      },
    },

    /* -------------------------------- 백업 -------------------------------- */
    {
      method: 'POST',
      path: '/api/backup',
      handler: () => {
        const result = backupNow(env.userDataDir);
        return { ...result, backups: listBackups(env.userDataDir) };
      },
    },
    {
      method: 'GET',
      path: '/api/backups',
      handler: () => ({ backups: listBackups(env.userDataDir) }),
    },

    /* ------------------------------ 실시간 갱신 ------------------------------ */
    {
      method: 'GET',
      path: '/api/events',
      handler: (ctx) => sseHandler(ctx),
    },
  ];
}

export { resolveSession };
