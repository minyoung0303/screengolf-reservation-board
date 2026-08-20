import { createContext, useContext } from 'react';
import type { DayPayload, DurationRule, Reservation, Room, Settings } from '@shared/types';

export type Tab = 'board' | 'list' | 'search' | 'settings' | 'print';

/** 예약 등록/수정 창을 열 때 넘기는 초기값 */
export interface DialogSeed {
  startMin?: number;
  roomId?: number | null;
  isWalkin?: boolean;
  edit?: Reservation;
}

export interface AppState {
  date: string;
  setDate: (date: string) => void;
  day: DayPayload | null;
  loadingDay: boolean;
  reloadDay: () => Promise<void>;
  settings: Settings;
  rooms: Room[];
  rules: DurationRule[];
  lanUrls: string[];
  remoteCount: number;
  reloadBootstrap: () => Promise<void>;
  toast: (text: string, kind?: 'ok' | 'err' | 'info') => void;
  isDesktopApp: boolean;
  live: boolean;
  openCreate: (seed?: DialogSeed) => void;
  openDetail: (reservation: Reservation) => void;
  /** 폰·태블릿 접속 방법(QR 코드) 창 열기 */
  openConnect: () => void;
  tab: Tab;
  setTab: (tab: Tab) => void;
}

export const AppCtx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(AppCtx);
  if (!value) throw new Error('AppProvider 안에서만 쓸 수 있습니다.');
  return value;
}
