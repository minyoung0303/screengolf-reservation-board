import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { Bootstrap, DayPayload, Reservation, Settings } from '@shared/types';
import { addDays, fmtDateKo, fmtTime, nowMin, todayISO } from '@shared/time';
import { ApiFail, api, clearToken, desktopBridge, getToken, setToken, subscribe } from './lib/api';
import { useMedia, useNow, useToasts } from './lib/hooks';
import { AppCtx, type AppState, type DialogSeed, type Tab } from './lib/appContext';
import PinScreen from './screens/PinScreen';
import BoardScreen from './screens/BoardScreen';
import ListScreen from './screens/ListScreen';
import SearchScreen from './screens/SearchScreen';
import SettingsScreen from './screens/SettingsScreen';
import MobileScreen from './screens/MobileScreen';
import PrintSheet from './screens/PrintSheet';
import ReservationDialog from './components/ReservationDialog';
import DetailDialog from './components/DetailDialog';
import ConnectDialog from './components/ConnectDialog';

type Phase = 'loading' | 'setup' | 'login' | 'ready' | 'error';

export default function App(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading');
  const [pinSet, setPinSet] = useState(false);
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const [fatal, setFatal] = useState('');
  const desktopTokenRef = useRef('');

  const init = useCallback(async () => {
    try {
      const health = await api.health();
      setPinSet(health.pinSet);

      const bridge = desktopBridge();
      if (bridge) {
        const info = await bridge.getInfo();
        desktopTokenRef.current = info.token;
        setIsDesktopApp(true);
        if (!health.pinSet) {
          setPhase('setup');
          return;
        }
        if (!health.requirePinOnDesktop) {
          setToken(info.token, { desktop: true, persist: false });
          setPhase('ready');
          return;
        }
      }

      if (getToken()) {
        try {
          await api.me();
          setPhase('ready');
          return;
        } catch {
          clearToken();
        }
      }
      setPhase('login');
    } catch (error) {
      setFatal(error instanceof Error ? error.message : String(error));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void init();
  }, [init]);

  if (phase === 'loading') {
    return <CenterNote>불러오는 중...</CenterNote>;
  }

  if (phase === 'error') {
    return (
      <CenterNote>
        <b>프로그램에 연결할 수 없어요.</b>
        <div className="small muted" style={{ marginTop: 8 }}>{fatal}</div>
        <button className="btn" style={{ marginTop: 14 }} onClick={() => void init()}>
          다시 시도
        </button>
      </CenterNote>
    );
  }

  if (phase === 'setup' || phase === 'login') {
    return (
      <PinScreen
        mode={phase === 'setup' ? 'setup' : 'login'}
        pinSet={pinSet}
        isDesktopApp={isDesktopApp}
        onDone={() => {
          if (phase === 'setup' && desktopTokenRef.current) {
            setToken(desktopTokenRef.current, { desktop: true, persist: false });
            setPinSet(true);
            setPhase('ready');
            return;
          }
          setPhase('ready');
        }}
      />
    );
  }

  return (
    <Shell
      isDesktopApp={isDesktopApp}
      onSignedOut={() => {
        clearToken();
        setPhase('login');
      }}
    />
  );
}

function CenterNote({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div>{children}</div>
    </div>
  );
}

function Shell({
  isDesktopApp,
  onSignedOut,
}: {
  isDesktopApp: boolean;
  onSignedOut: () => void;
}): JSX.Element {
  const [date, setDate] = useState(todayISO());
  const [boot, setBoot] = useState<(Bootstrap & { remoteCount: number }) | null>(null);
  const [day, setDay] = useState<DayPayload | null>(null);
  const [loadingDay, setLoadingDay] = useState(true);
  const [tab, setTab] = useState<Tab>('board');
  const [live, setLive] = useState(false);
  const [seed, setSeed] = useState<DialogSeed | null>(null);
  const [detail, setDetail] = useState<Reservation | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const { toasts, push } = useToasts();
  const now = useNow(15_000);
  const isPhone = useMedia('(max-width: 860px)');

  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiFail) {
        if (error.status === 401) {
          onSignedOut();
          return;
        }
        push(error.message, 'err');
        return;
      }
      push(error instanceof Error ? error.message : String(error), 'err');
    },
    [onSignedOut, push],
  );

  const reloadBootstrap = useCallback(async () => {
    try {
      setBoot(await api.bootstrap());
    } catch (error) {
      handleError(error);
    }
  }, [handleError]);

  const reloadDay = useCallback(async () => {
    try {
      setDay(await api.day(date));
    } catch (error) {
      handleError(error);
    } finally {
      setLoadingDay(false);
    }
  }, [date, handleError]);

  useEffect(() => {
    void reloadBootstrap();
  }, [reloadBootstrap]);

  useEffect(() => {
    setLoadingDay(true);
    void reloadDay();
  }, [reloadDay]);

  // 다른 기기에서 예약이 바뀌면 즉시 반영한다.
  useEffect(() => {
    const stop = subscribe((payload) => {
      setLive(true);
      if (payload.type === 'settings') {
        void reloadBootstrap();
        void reloadDay();
        return;
      }
      if (payload.type === 'changed') void reloadDay();
    });
    return stop;
  }, [reloadBootstrap, reloadDay]);

  // 연결이 끊겼을 때를 대비한 보조 갱신
  useEffect(() => {
    const timer = window.setInterval(() => void reloadDay(), 60_000);
    const onFocus = (): void => void reloadDay();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [reloadDay]);

  const state = useMemo<AppState>(
    () => ({
      date,
      setDate,
      day,
      loadingDay,
      reloadDay,
      settings: boot?.settings ?? FALLBACK_SETTINGS,
      rooms: boot?.rooms ?? [],
      rules: boot?.durationRules ?? [],
      lanUrls: boot?.lanUrls ?? [],
      remoteCount: boot?.remoteCount ?? 0,
      reloadBootstrap,
      toast: push,
      isDesktopApp,
      live,
      openCreate: (next) => setSeed(next ?? {}),
      openDetail: (reservation) => setDetail(reservation),
      openConnect: () => setConnectOpen(true),
      tab,
      setTab,
    }),
    [date, day, loadingDay, reloadDay, boot, reloadBootstrap, push, isDesktopApp, live, tab],
  );

  const body = ((): JSX.Element => {
    if (isPhone) return <MobileScreen />;
    switch (tab) {
      case 'list':
        return <ListScreen />;
      case 'search':
        return <SearchScreen />;
      case 'settings':
        return <SettingsScreen onSignedOut={onSignedOut} />;
      case 'print':
        return <PrintSheet />;
      default:
        return <BoardScreen />;
    }
  })();

  return (
    <AppCtx.Provider value={state}>
      <div className="app">
        {!isPhone && (
          <header className="topbar no-print">
            <div className="brand">
              예약보드
              {boot?.settings.storeName ? <small>{boot.settings.storeName}</small> : null}
            </div>

            <div className="datenav">
              <button className="btn btn-sm" onClick={() => setDate(addDays(date, -1))} title="어제">
                ◀
              </button>
              <div className="date">
                {fmtDateKo(date)}
                {date === todayISO() ? ' · 오늘' : ''}
              </div>
              <button className="btn btn-sm" onClick={() => setDate(addDays(date, 1))} title="내일">
                ▶
              </button>
              <input
                className="input"
                style={{ width: 150 }}
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                aria-label="날짜 선택"
              />
              {date !== todayISO() && (
                <button className="btn btn-sm" onClick={() => setDate(todayISO())}>
                  오늘로
                </button>
              )}
            </div>

            <div className="spacer" />

            <nav className="tabs">
              <TabButton tab="board" current={tab} onClick={setTab}>
                예약판
              </TabButton>
              <TabButton tab="list" current={tab} onClick={setTab}>
                목록
              </TabButton>
              <TabButton tab="search" current={tab} onClick={setTab}>
                검색
              </TabButton>
              <TabButton tab="print" current={tab} onClick={setTab}>
                인쇄
              </TabButton>
              <TabButton tab="settings" current={tab} onClick={setTab}>
                설정
              </TabButton>
            </nav>

            <div className="row" style={{ gap: 6 }}>
              <span className={`dot ${live ? 'live' : ''}`} title={live ? '실시간 연결됨' : '연결 확인 중'} />
              <span className="clock">{fmtTime(nowMin(now))}</span>
            </div>

            <button className="btn btn-primary btn-lg" onClick={() => setSeed({})}>
              + 예약 등록
            </button>
            <button
              className="btn"
              onClick={() => setSeed({ isWalkin: true, startMin: nowMin(now) })}
              title="예약 없이 온 손님"
            >
              워크인
            </button>
            <button
              className="btn"
              onClick={() => setConnectOpen(true)}
              title="폰·태블릿에서 접속하는 방법 (QR 코드)"
            >
              폰 연결
            </button>
          </header>
        )}

        <main className="content">{body}</main>

        {seed && (
          <ReservationDialog
            seed={seed}
            onClose={() => setSeed(null)}
            onSaved={(message) => {
              setSeed(null);
              push(message, 'ok');
              void reloadDay();
            }}
          />
        )}

        {connectOpen && <ConnectDialog onClose={() => setConnectOpen(false)} />}

        {detail && (
          <DetailDialog
            reservation={detail}
            onClose={() => setDetail(null)}
            onChanged={(message) => {
              push(message, 'ok');
              void reloadDay();
            }}
            onEdit={(reservation) => {
              setDetail(null);
              setSeed({ edit: reservation });
            }}
          />
        )}

        <div className="toast-wrap" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast ${toast.kind === 'info' ? '' : toast.kind}`}>
              {toast.text}
            </div>
          ))}
        </div>
      </div>
    </AppCtx.Provider>
  );
}

function TabButton({
  tab,
  current,
  onClick,
  children,
}: {
  tab: Tab;
  current: Tab;
  onClick: (tab: Tab) => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button className={`tab ${current === tab ? 'on' : ''}`} onClick={() => onClick(tab)}>
      {children}
    </button>
  );
}

const FALLBACK_SETTINGS: Settings = {
  storeName: '',
  openMin: 510,
  closeMin: 1260,
  lastEntryMin: 1260,
  bufferMin: 10,
  slotMin: 30,
  maxGames: 5,
  maxParty: 6,
  retentionDays: 365,
  backupDir: '',
  requirePinOnDesktop: 0,
};
