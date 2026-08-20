import { useMemo } from 'react';
import type { JSX } from 'react';
import type { Reservation } from '@shared/types';
import { fmtTime, nowMin, todayISO } from '@shared/time';
import { ApiFail, api } from '../lib/api';
import { useApp } from '../lib/appContext';
import { useLocalStorage, useNow } from '../lib/hooks';
import Timeline from '../components/Timeline';

export default function BoardScreen(): JSX.Element {
  const { day, date, settings, loadingDay, openCreate, openDetail, toast, reloadDay } = useApp();
  const [zoom, setZoom] = useLocalStorage('yeyakbo.zoom', 2);
  const [showVoid, setShowVoid] = useLocalStorage('yeyakbo.showVoid', false);
  const now = useNow(20_000);

  const isToday = date === todayISO();
  const currentMin = isToday ? nowMin(now) : null;

  const stats = useMemo(() => {
    const list = day?.reservations ?? [];
    const live = list.filter((r) => r.status !== 'cancelled' && r.status !== 'no_show');
    const using = live.filter((r) => r.status === 'checked_in').length;
    const heads = live.reduce((sum, r) => sum + r.partySize, 0);
    const games = live.reduce((sum, r) => sum + r.gameCount * r.partySize, 0);
    const activeRooms = (day?.rooms ?? []).filter((r) => r.active === 1);
    const freeNow =
      currentMin === null
        ? null
        : activeRooms.filter(
            (room) =>
              !live.some(
                (r) =>
                  r.roomId === room.id && r.startMin <= currentMin && r.blockEndMin > currentMin,
              ),
          ).length;
    return { count: live.length, using, heads, games, freeNow, roomCount: activeRooms.length };
  }, [day, currentMin]);

  const move = async (reservation: Reservation, roomId: number, startMin: number): Promise<void> => {
    try {
      await api.update(reservation.id, { roomId, startMin, keepPlayMin: true });
      toast('예약을 옮겼어요.', 'ok');
      void reloadDay();
    } catch (error) {
      toast(error instanceof ApiFail ? error.message : String(error), 'err');
      void reloadDay();
    }
  };

  return (
    <div>
      <div className="board-toolbar no-print">
        <div className="row" style={{ gap: 12 }}>
          <span className="chip">
            예약 <b style={{ marginLeft: 4 }}>{stats.count}건</b>
          </span>
          <span className="chip">
            이용중 <b style={{ marginLeft: 4 }}>{stats.using}팀</b>
          </span>
          <span className="chip">
            인원 <b style={{ marginLeft: 4 }}>{stats.heads}명</b>
          </span>
          {stats.freeNow !== null && (
            <span className="chip" style={{ borderColor: '#9cc0f4', color: '#16357f' }}>
              지금 빈 타석{' '}
              <b style={{ marginLeft: 4 }}>
                {stats.freeNow}/{stats.roomCount}
              </b>
            </span>
          )}
        </div>

        <div className="spacer" />

        <div className="legend" aria-hidden="true">
          <span>
            <i style={{ background: '#dbe7fe', borderColor: '#7ba3ef' }} />
            예약
          </span>
          <span>
            <i style={{ background: '#d9f5e3', borderColor: '#5aab77' }} />
            이용중
          </span>
          <span>
            <i style={{ background: '#ffe9d1', borderColor: '#e0994c' }} />
            워크인
          </span>
          <span>
            <i style={{ background: '#eceff4', borderColor: '#b4bfcd' }} />
            완료
          </span>
        </div>

        <label className="chip" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} />
          취소·노쇼 표시
        </label>

        <div className="row" style={{ gap: 2 }}>
          <button
            className="btn btn-sm"
            onClick={() => setZoom(Math.max(1, Number((zoom - 0.4).toFixed(1))))}
            title="가로 축소"
          >
            −
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setZoom(Math.min(4, Number((zoom + 0.4).toFixed(1))))}
            title="가로 확대"
          >
            ＋
          </button>
        </div>
      </div>

      {day ? (
        <>
          <Timeline
            day={day}
            settings={settings}
            showVoid={showVoid}
            pxPerMin={zoom}
            nowMinutes={currentMin}
            onEmpty={(roomId, startMin) => openCreate({ roomId, startMin })}
            onBlock={(reservation) => openDetail(reservation)}
            onMove={(reservation, roomId, startMin) => void move(reservation, roomId, startMin)}
          />
          <div className="tiny muted" style={{ marginTop: 8 }}>
            빈 곳을 누르면 그 타석·시간으로 예약창이 열려요. 예약 블록은 눌러서 상세를 보고, 끌어서 시간과
            타석을 옮길 수 있어요. 사선 무늬는 정리 시간 {settings.bufferMin}분,
            {' '}회색 구역은 영업 종료({fmtTime(settings.closeMin)}) 이후예요.
          </div>
        </>
      ) : (
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          {loadingDay ? '불러오는 중...' : '예약을 불러올 수 없어요.'}
        </div>
      )}
    </div>
  );
}
