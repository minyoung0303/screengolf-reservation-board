import type {
  Bootstrap,
  DayPayload,
  DurationRule,
  Quote,
  Reservation,
  Room,
  Settings,
} from '@shared/types';

const TOKEN_KEY = 'yeyakbo.token';

let token = localStorage.getItem(TOKEN_KEY) ?? '';
let isDesktopSession = false;

export class ApiFail extends Error {
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

export function getToken(): string {
  return token;
}

export function setToken(next: string, opts: { desktop?: boolean; persist?: boolean } = {}): void {
  token = next;
  isDesktopSession = Boolean(opts.desktop);
  if (opts.persist ?? !opts.desktop) {
    if (next) localStorage.setItem(TOKEN_KEY, next);
    else localStorage.removeItem(TOKEN_KEY);
  }
}

export function clearToken(): void {
  token = '';
  localStorage.removeItem(TOKEN_KEY);
}

export function isDesktop(): boolean {
  return isDesktopSession;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    throw new ApiFail(
      res.status,
      String(data.error ?? 'ERROR'),
      String(data.message ?? '요청을 처리하지 못했어요.'),
      data.quote as Quote | undefined,
    );
  }
  return data as T;
}

export interface HealthPayload {
  ok: boolean;
  pinSet: boolean;
  version: string;
  requirePinOnDesktop: boolean;
}

export interface SettingsPayload {
  settings: Settings;
  rooms: Room[];
  durationRules: DurationRule[];
  backups: { name: string; size: number; at: string }[];
  lanUrls: string[];
  remoteCount: number;
  pinSet: boolean;
}

export const api = {
  health: () => request<HealthPayload>('GET', '/api/health'),
  login: (pin: string, label: string) =>
    request<{ token: string; kind: string; label: string }>('POST', '/api/auth/login', { pin, label }),
  setupPin: (pin: string) => request<{ ok: boolean }>('POST', '/api/auth/setup-pin', { pin }),
  changePin: (currentPin: string, newPin: string) =>
    request<{ ok: boolean }>('POST', '/api/auth/change-pin', { currentPin, newPin }),
  me: () => request<{ kind: string; label: string }>('GET', '/api/auth/me'),
  logout: () => request<{ ok: boolean }>('POST', '/api/auth/logout'),

  bootstrap: () => request<Bootstrap & { remoteCount: number }>('GET', '/api/bootstrap'),
  day: (date: string) => request<DayPayload>('GET', `/api/day?date=${date}`),
  summary: (date: string) =>
    request<{ date: string; slots: { startMin: number; freeCount: number; totalCount: number }[] }>(
      'GET',
      `/api/summary?date=${date}`,
    ),
  quote: (input: {
    date: string;
    startMin: number;
    partySize: number;
    gameCount: number;
    excludeId?: number;
  }) => request<Quote>('POST', '/api/quote', input),
  scan: (input: { date: string; partySize: number; gameCount: number; excludeId?: number }) =>
    request<{ playMin: number; bufferMin: number; slots: { startMin: number; freeRoomIds: number[] }[] }>(
      'POST',
      '/api/scan',
      input,
    ),

  create: (input: {
    date: string;
    roomId: number | null;
    name: string;
    phone: string;
    partySize: number;
    gameCount: number;
    startMin: number;
    isWalkin: boolean;
    memo: string;
  }) => request<Reservation>('POST', '/api/reservations', input),
  update: (id: number, patch: Record<string, unknown>) =>
    request<Reservation>('PATCH', `/api/reservations/${id}`, patch),
  setStatus: (id: number, status: string) =>
    request<Reservation>('POST', `/api/reservations/${id}/status`, { status }),
  extend: (id: number, opts: { addMin?: number; addGames?: number }) =>
    request<Reservation>('POST', `/api/reservations/${id}/extend`, opts),
  remove: (id: number) => request<{ ok: boolean }>('DELETE', `/api/reservations/${id}`),
  search: (q: string) =>
    request<{ results: Reservation[] }>('GET', `/api/search?q=${encodeURIComponent(q)}`),

  settings: () => request<SettingsPayload>('GET', '/api/settings'),
  saveSettings: (payload: {
    settings?: Partial<Settings>;
    durationRules?: DurationRule[];
    rooms?: Room[];
  }) =>
    request<{ settings: Settings; rooms: Room[]; durationRules: DurationRule[] }>(
      'PUT',
      '/api/settings',
      payload,
    ),
  backupNow: () =>
    request<{ file: string; dir: string; backups: { name: string; size: number; at: string }[] }>(
      'POST',
      '/api/backup',
    ),
  devices: () => request<{ remoteCount: number }>('GET', '/api/devices'),
  revokeDevices: () => request<{ ok: boolean }>('POST', '/api/devices/revoke'),
};

/** 다른 기기에서 예약을 바꾸면 즉시 화면을 갱신하기 위한 연결 */
export function subscribe(onChange: (payload: { type: string; date?: string }) => void): () => void {
  let source: EventSource | null = null;
  let stopped = false;
  let retry: number | undefined;

  const connect = (): void => {
    if (stopped || !token) return;
    source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    source.onmessage = (event) => {
      try {
        onChange(JSON.parse(event.data));
      } catch {
        /* 무시 */
      }
    };
    source.onerror = () => {
      source?.close();
      source = null;
      if (!stopped) retry = window.setTimeout(connect, 3000);
    };
  };

  connect();

  return () => {
    stopped = true;
    if (retry) window.clearTimeout(retry);
    source?.close();
  };
}

/* -------------------- Electron(카운터 PC) 전용 기능 -------------------- */

interface DesktopBridge {
  getInfo: () => Promise<{
    token: string;
    isDesktop: boolean;
    version: string;
    port: number;
    userDataDir: string;
    backupDir: string;
    lanUrls: string[];
  }>;
  openBackupFolder: () => Promise<string>;
  print: () => Promise<boolean>;
}

export function desktopBridge(): DesktopBridge | null {
  return (window as unknown as { yeyakbo?: DesktopBridge }).yeyakbo ?? null;
}
