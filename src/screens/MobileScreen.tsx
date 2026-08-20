import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Reservation } from '@shared/types';
import { STATUS_LABEL } from '@shared/types';
import { addDays, fmtDateKo, fmtPhone, fmtTime, fmtTimeKo, nowMin, todayISO } from '@shared/time';
import { ApiFail, api } from '../lib/api';
import { useApp } from '../lib/appContext';
import { useDebounced, useNow } from '../lib/hooks';

type MobileTab = 'slots' | 'list' | 'search';

/** 폰·태블릿용 화면. 가로로 긴 예약판 대신 시간대별 잔여석과 목록으로 보여준다. */
export default function MobileScreen(): JSX.Element {
  const { date, setDate, day, rooms, live, openCreate, openDetail, toast, reloadDay } = useApp();
  const [tab, setTab] = useState<MobileTab>('slots');
  const [slots, setSlots] = useState<{ startMin: number; freeCount: number; totalCount: number }[]>([]);
  const now = useNow(30_000);

  useEffect(() => {
    let alive = true;
    api
      .summary(date)
      .then((res) => {
        if (alive) setSlots(res.slots);
      })
      .catch(() => {
        if (alive) setSlots([]);
      });
    return () => {
      alive = false;
    };
  }, [date, day]);

  const list = [...(day?.reservations ?? [])].sort(
    (a, b) => a.startMin - b.startMin || a.roomId - b.roomId,
  );
  const roomName = (id: number): string => rooms.find((r) => r.id === id)?.name ?? `${id}번`;
  const currentMin = date === todayISO() ? nowMin(now) : null;

  const quick = async (reservation: Reservation, status: string, message: string): Promise<void> => {
    try {
      await api.setStatus(reservation.id, status);
      toast(message, 'ok');
      void reloadDay();
    } catch (error) {
      toast(error instanceof ApiFail ? error.message : String(error), 'err');
    }
  };

  return (
    <div style={{ paddingBottom: 80 }}>
      <div
        className="row"
        style={{
          position: 'sticky',
          top: -12,
          zIndex: 10,
          background: 'var(--bg)',
          padding: '8px 0',
          marginBottom: 8,
        }}
      >
        <button className="btn btn-sm" onClick={() => setDate(addDays(date, -1))} aria-label="어제">
          ◀
        </button>
        <b style={{ flex: 1, textAlign: 'center' }}>
          {fmtDateKo(date)}
          {date === todayISO() ? ' · 오늘' : ''}
        </b>
        <button className="btn btn-sm" onClick={() => setDate(addDays(date, 1))} aria-label="내일">
          ▶
        </button>
        <span className={`dot ${live ? 'live' : ''}`} title={live ? '실시간 연결됨' : '연결 확인 중'} />
      </div>

      {tab === 'slots' && (
        <div className="stack">
          <div className="small muted">시간을 누르면 그 시간으로 예약을 등록해요. (30분 기준 잔여 타석)</div>
          <div className="m-slots">
            {slots.map((slot) => (
              <button
                key={slot.startMin}
                className={`m-slot ${slot.freeCount === 0 ? 'full' : ''}`}
                onClick={() => openCreate({ startMin: slot.startMin })}
              >
                <div className="t">{fmtTime(slot.startMin)}</div>
                <div className="c">{slot.freeCount === 0 ? '마감' : `잔여 ${slot.freeCount}`}</div>
              </button>
            ))}
          </div>
          {slots.length === 0 && <div className="panel sec muted">시간표를 불러오는 중...</div>}
        </div>
      )}

      {tab === 'list' && (
        <div className="stack">
          {list.length === 0 && <div className="panel sec muted">예약이 없어요.</div>}
          {list.map((reservation) => {
            const voided = reservation.status === 'cancelled' || reservation.status === 'no_show';
            const running =
              currentMin !== null &&
              reservation.startMin <= currentMin &&
              reservation.blockEndMin > currentMin &&
              !voided;
            return (
              <div
                className="card"
                key={reservation.id}
                style={{
                  opacity: voided ? 0.55 : 1,
                  borderColor: running ? '#5aab77' : 'var(--line)',
                  borderWidth: running ? 2 : 1,
                }}
                onClick={() => openDetail(reservation)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') openDetail(reservation);
                }}
              >
                <div className="head">
                  <span className="time">
                    {fmtTime(reservation.startMin)} ~ {fmtTimeKo(reservation.endMin)}
                  </span>
                  <span className="chip">{roomName(reservation.roomId)}</span>
                  <div className="spacer" />
                  <span className={`badge badge-${reservation.status}`}>
                    {STATUS_LABEL[reservation.status]}
                  </span>
                </div>
                <div className="small">
                  {reservation.name || (reservation.isWalkin === 1 ? '워크인' : '이름 없음')} ·{' '}
                  {reservation.partySize}명 {reservation.gameCount}게임
                  {reservation.phone ? ` · ${fmtPhone(reservation.phone)}` : ''}
                </div>
                {reservation.memo && <div className="tiny muted">{reservation.memo}</div>}
                <div className="row" style={{ marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                  {reservation.status === 'booked' && (
                    <button
                      className="btn btn-sm"
                      onClick={() => void quick(reservation, 'checked_in', '체크인했어요.')}
                    >
                      체크인
                    </button>
                  )}
                  {reservation.status === 'checked_in' && (
                    <button
                      className="btn btn-sm"
                      onClick={() => void quick(reservation, 'done', '완료 처리했어요.')}
                    >
                      완료
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'search' && <MobileSearch />}

      <button className="fab" onClick={() => openCreate({})}>
        + 예약
      </button>

      <nav
        className="bottom-tabs"
        style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 15 }}
      >
        <button className={tab === 'slots' ? 'on' : ''} onClick={() => setTab('slots')}>
          시간표
        </button>
        <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>
          예약 목록
        </button>
        <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>
          찾기
        </button>
      </nav>
    </div>
  );
}

function MobileSearch(): JSX.Element {
  const { rooms, openDetail } = useApp();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);
  const [results, setResults] = useState<Reservation[]>([]);

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    api
      .search(debounced.trim())
      .then((res) => {
        if (alive) setResults(res.results);
      })
      .catch(() => {
        if (alive) setResults([]);
      });
    return () => {
      alive = false;
    };
  }, [debounced]);

  const roomName = (id: number): string => rooms.find((r) => r.id === id)?.name ?? `${id}번`;

  return (
    <div className="stack">
      <input
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름 또는 전화 뒷자리"
        aria-label="예약 검색"
      />
      {results.map((reservation) => (
        <div className="card" key={reservation.id} onClick={() => openDetail(reservation)} role="button" tabIndex={0}>
          <div className="head">
            <span className="time">{fmtDateKo(reservation.date)}</span>
            <span className="chip">{roomName(reservation.roomId)}</span>
            <div className="spacer" />
            <span className={`badge badge-${reservation.status}`}>
              {STATUS_LABEL[reservation.status]}
            </span>
          </div>
          <div className="small">
            {fmtTime(reservation.startMin)} ~ {fmtTimeKo(reservation.endMin)} ·{' '}
            {reservation.name || '이름 없음'} · {reservation.partySize}명 {reservation.gameCount}게임
          </div>
        </div>
      ))}
      {debounced.trim().length >= 2 && results.length === 0 && (
        <div className="panel sec muted">찾는 예약이 없어요.</div>
      )}
    </div>
  );
}
