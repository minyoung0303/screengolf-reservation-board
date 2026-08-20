import { useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  JSX,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { DayPayload, Reservation, Room, Settings } from '@shared/types';
import { fmtTime, floorTo } from '@shared/time';

interface Props {
  day: DayPayload;
  settings: Settings;
  showVoid: boolean;
  pxPerMin: number;
  nowMinutes: number | null;
  onEmpty: (roomId: number, startMin: number) => void;
  onBlock: (reservation: Reservation) => void;
  onMove: (reservation: Reservation, roomId: number, startMin: number) => void;
}

const ROW_H = 46;
const LABEL_W = 78;

export default function Timeline({
  day,
  settings,
  showVoid,
  pxPerMin,
  nowMinutes,
  onEmpty,
  onBlock,
  onMove,
}: Props): JSX.Element {
  const [drag, setDrag] = useState<{ id: number; dxMin: number } | null>(null);
  const dragState = useRef<{
    id: number;
    startX: number;
    startY: number;
    moved: boolean;
    reservation: Reservation;
  } | null>(null);

  const gridStart = day.gridStartMin;
  const gridEnd = day.gridEndMin;
  const totalMin = Math.max(60, gridEnd - gridStart);
  const width = totalMin * pxPerMin;

  const visibleRooms = useMemo<Room[]>(() => {
    const used = new Set(day.reservations.map((r) => r.roomId));
    return day.rooms.filter((room) => room.active === 1 || used.has(room.id));
  }, [day.rooms, day.reservations]);

  const byRoom = useMemo(() => {
    const map = new Map<number, Reservation[]>();
    for (const reservation of day.reservations) {
      const voided = reservation.status === 'cancelled' || reservation.status === 'no_show';
      if (voided && !showVoid) continue;
      const list = map.get(reservation.roomId) ?? [];
      list.push(reservation);
      map.set(reservation.roomId, list);
    }
    return map;
  }, [day.reservations, showVoid]);

  const ticks = useMemo(() => {
    const out: { min: number; hour: boolean }[] = [];
    const step = settings.slotMin;
    for (let t = floorTo(gridStart, step); t <= gridEnd; t += step) {
      if (t < gridStart) continue;
      out.push({ min: t, hour: t % 60 === 0 });
    }
    return out;
  }, [gridStart, gridEnd, settings.slotMin]);

  const x = (min: number): number => (min - gridStart) * pxPerMin;

  const handleTrackClick = (roomId: number, event: ReactMouseEvent<HTMLDivElement>): void => {
    if (dragState.current?.moved) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = gridStart + (event.clientX - rect.left) / pxPerMin;
    onEmpty(roomId, Math.max(gridStart, floorTo(raw, settings.slotMin)));
  };

  const startDrag = (reservation: Reservation, event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (reservation.status === 'cancelled' || reservation.status === 'no_show') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      id: reservation.id,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      reservation,
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const state = dragState.current;
    if (!state) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
    state.moved = true;
    const stepped = Math.round(dx / pxPerMin / settings.slotMin) * settings.slotMin;
    setDrag({ id: state.id, dxMin: stepped });
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const state = dragState.current;
    dragState.current = null;
    setDrag(null);
    if (!state) return;
    if (!state.moved) {
      onBlock(state.reservation);
      return;
    }
    const dx = event.clientX - state.startX;
    const stepped = Math.round(dx / pxPerMin / settings.slotMin) * settings.slotMin;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest('[data-room-id]') as HTMLElement | null;
    const roomId = target ? Number(target.dataset.roomId) : state.reservation.roomId;
    const startMin = Math.max(0, state.reservation.startMin + stepped);
    if (roomId === state.reservation.roomId && startMin === state.reservation.startMin) return;
    onMove(state.reservation, roomId, startMin);
  };

  return (
    <div
      className="timeline"
      style={{ '--label-w': `${LABEL_W}px`, '--row-h': `${ROW_H}px` } as CSSProperties}
    >
      <div className="tl-inner" style={{ width: width + LABEL_W }}>
        <div className="tl-head">
          <div className="tl-corner">타석</div>
          <div className="tl-times" style={{ width }}>
            {ticks.map((tick) => (
              <div
                key={tick.min}
                className={`tl-tick ${tick.hour ? 'hour' : ''}`}
                style={{ left: x(tick.min) }}
              >
                {tick.hour || pxPerMin > 1.6 ? fmtTime(tick.min) : ''}
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          {nowMinutes !== null && nowMinutes >= gridStart && nowMinutes <= gridEnd && (
            <div className="tl-now" style={{ left: LABEL_W + x(nowMinutes) }} />
          )}

          {visibleRooms.map((room) => (
            <div className={`tl-row ${room.active === 0 ? 'off' : ''}`} key={room.id}>
              <div className="tl-label">
                <span>{room.name}</span>
                <span className="cap">{room.active === 0 ? '미사용' : `${room.capacity}인`}</span>
              </div>
              <div
                className="tl-track"
                data-room-id={room.id}
                style={{ width }}
                onClick={(event) => handleTrackClick(room.id, event)}
                role="presentation"
              >
                <div className="tl-grid">
                  {ticks.map((tick) => (
                    <div
                      key={tick.min}
                      className={`tl-gline ${tick.hour ? 'hour' : ''}`}
                      style={{ left: x(tick.min) }}
                    />
                  ))}
                  {gridEnd > settings.closeMin && (
                    <div
                      className="tl-closed"
                      style={{ left: x(settings.closeMin), width: (gridEnd - settings.closeMin) * pxPerMin }}
                    />
                  )}
                </div>

                {(byRoom.get(room.id) ?? []).map((reservation) => {
                  const voided =
                    reservation.status === 'cancelled' || reservation.status === 'no_show';
                  const dragging = drag?.id === reservation.id;
                  const offset = dragging ? (drag?.dxMin ?? 0) : 0;
                  const left = x(reservation.startMin + offset);
                  const blockWidth = Math.max(
                    18,
                    (reservation.blockEndMin - reservation.startMin) * pxPerMin - 2,
                  );
                  const cls = voided
                    ? 'blk-void'
                    : reservation.status === 'done'
                      ? 'blk-done'
                      : reservation.isWalkin === 1 && reservation.status === 'checked_in'
                        ? 'blk-walkin'
                        : `blk-${reservation.status}`;
                  const label =
                    reservation.name || (reservation.isWalkin === 1 ? '워크인' : '예약');
                  return (
                    <button
                      key={reservation.id}
                      type="button"
                      className={`blk ${cls} ${dragging ? 'dragging' : ''}`}
                      style={{ left, width: blockWidth }}
                      onPointerDown={(event) => startDrag(reservation, event)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onClick={(event) => event.stopPropagation()}
                      title={`${label} · ${reservation.partySize}명 ${reservation.gameCount}게임 · ${fmtTime(
                        reservation.startMin,
                      )}~${fmtTime(reservation.endMin)}`}
                    >
                      <span className="b1">{label}</span>
                      {blockWidth > 96 && (
                        <span className="b2">
                          {reservation.partySize}명 {reservation.gameCount}게임 ·{' '}
                          {fmtTime(reservation.startMin)}~{fmtTime(reservation.endMin)}
                        </span>
                      )}
                      {reservation.bufferMin > 0 && (
                        <span
                          className="buf"
                          style={{ width: Math.min(blockWidth - 2, reservation.bufferMin * pxPerMin) }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
