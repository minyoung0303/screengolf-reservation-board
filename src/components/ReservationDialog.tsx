import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Quote } from '@shared/types';
import {
  fmtDateKo,
  fmtDuration,
  fmtTime,
  fmtTimeKo,
  nowMin,
  parseHHMM,
  roundTo,
  todayISO,
} from '@shared/time';
import { ApiFail, api } from '../lib/api';
import { useApp } from '../lib/appContext';
import type { DialogSeed } from '../lib/appContext';
import { useDebounced } from '../lib/hooks';

interface Props {
  seed: DialogSeed;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export default function ReservationDialog({ seed, onClose, onSaved }: Props): JSX.Element {
  const { date, settings, rooms, reloadDay } = useApp();
  const edit = seed.edit;
  const activeRooms = useMemo(() => rooms.filter((r) => r.active === 1), [rooms]);

  const initialStart = (): number => {
    if (edit) return edit.startMin;
    if (seed.startMin !== undefined) return seed.startMin;
    if (date === todayISO()) {
      return Math.min(settings.lastEntryMin, Math.max(settings.openMin, roundTo(nowMin(), settings.slotMin)));
    }
    return settings.openMin;
  };

  const [startMin, setStartMin] = useState(initialStart);
  const [partySize, setPartySize] = useState(edit?.partySize ?? 2);
  const [gameCount, setGameCount] = useState(edit?.gameCount ?? 2);
  const [roomId, setRoomId] = useState<number | null>(edit?.roomId ?? seed.roomId ?? null);
  const [name, setName] = useState(edit?.name ?? '');
  const [phone, setPhone] = useState(edit?.phone ?? '');
  const [memo, setMemo] = useState(edit?.memo ?? '');
  const [isWalkin, setIsWalkin] = useState(Boolean(seed.isWalkin || edit?.isWalkin));
  const [customTime, setCustomTime] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [scan, setScan] = useState<{ startMin: number; freeRoomIds: number[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const excludeId = edit?.id ?? 0;
  const debouncedKey = useDebounced(`${startMin}|${partySize}|${gameCount}`, 180);

  /* 시간 버튼에 "이 조건으로 들어갈 수 있는지"를 표시하기 위한 하루 전체 조회 */
  useEffect(() => {
    let alive = true;
    api
      .scan({ date, partySize, gameCount, excludeId })
      .then((result) => {
        if (alive) setScan(result.slots);
      })
      .catch(() => {
        if (alive) setScan([]);
      });
    return () => {
      alive = false;
    };
  }, [date, partySize, gameCount, excludeId]);

  /* 선택한 시간에 대한 정확한 판정 */
  useEffect(() => {
    let alive = true;
    api
      .quote({ date, startMin, partySize, gameCount, excludeId })
      .then((result) => {
        if (alive) setQuote(result);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiFail ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
    // debouncedKey 로 조회 횟수를 줄인다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey, date, excludeId]);

  useEffect(() => {
    if (!edit && !isWalkin) nameRef.current?.focus();
  }, [edit, isWalkin]);

  const scanMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const slot of scan) map.set(slot.startMin, slot.freeRoomIds.length);
    return map;
  }, [scan]);

  const slotList = useMemo(() => {
    const list: number[] = [];
    for (let t = settings.openMin; t <= settings.lastEntryMin; t += settings.slotMin) list.push(t);
    if (!list.includes(startMin)) list.push(startMin);
    return list.sort((a, b) => a - b);
  }, [settings.openMin, settings.lastEntryMin, settings.slotMin, startMin]);

  const freeRoomSet = useMemo(() => new Set(quote?.freeRoomIds ?? []), [quote]);

  const save = useCallback(async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (edit) {
        await api.update(edit.id, {
          roomId: roomId ?? edit.roomId,
          name,
          phone,
          partySize,
          gameCount,
          startMin,
          memo,
        });
        onSaved('예약을 수정했어요.');
      } else {
        const created = await api.create({
          date,
          roomId,
          name,
          phone,
          partySize,
          gameCount,
          startMin,
          isWalkin,
          memo,
        });
        const room = activeRooms.find((r) => r.id === created.roomId);
        onSaved(
          `${room?.name ?? ''} ${fmtTime(created.startMin)}~${fmtTimeKo(created.endMin)} 저장했어요.`,
        );
      }
      void reloadDay();
    } catch (err) {
      if (err instanceof ApiFail) {
        setError(err.message);
        if (err.quote) setQuote(err.quote);
      } else {
        setError(String(err));
      }
    } finally {
      setBusy(false);
    }
  }, [
    activeRooms,
    busy,
    date,
    edit,
    gameCount,
    isWalkin,
    memo,
    name,
    onSaved,
    partySize,
    phone,
    reloadDay,
    roomId,
    startMin,
  ]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, save]);

  const roomOk = roomId === null || freeRoomSet.has(roomId);
  const canSave = Boolean(quote?.ok && roomOk && !busy);
  const title = edit ? '예약 수정' : isWalkin ? '워크인 등록' : '예약 등록';

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <span className="chip">{fmtDateKo(date)}</span>
          {!edit && (
            <label className="chip" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isWalkin}
                onChange={(e) => setIsWalkin(e.target.checked)}
              />
              워크인(현장)
            </label>
          )}
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>1. 시작 시각</label>
            <div className="pickers">
              {slotList.map((slot) => {
                const free = scanMap.get(slot);
                const known = free !== undefined;
                return (
                  <button
                    key={slot}
                    type="button"
                    className={`pick ${startMin === slot ? 'on' : ''} ${
                      known ? (free === 0 ? 'busy' : 'free') : ''
                    }`}
                    onClick={() => setStartMin(slot)}
                    title={known ? (free === 0 ? '이 시간은 자리가 없어요' : `${free}석 가능`) : ''}
                  >
                    {fmtTime(slot)}
                  </button>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <input
                className="input"
                style={{ width: 120 }}
                placeholder="직접 입력"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                onBlur={() => {
                  const parsed = parseHHMM(customTime);
                  if (parsed !== null) setStartMin(parsed);
                  setCustomTime('');
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const parsed = parseHHMM(customTime);
                  if (parsed !== null) setStartMin(parsed);
                  setCustomTime('');
                }}
                aria-label="시작 시각 직접 입력"
              />
              <span className="tiny muted">예: 14:20 · 진한 테두리는 자리 있는 시간</span>
              <div className="spacer" />
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => setStartMin(roundTo(nowMin(), 5))}
              >
                지금 ({fmtTime(roundTo(nowMin(), 5))})
              </button>
            </div>
          </div>

          <div className="row row-wrap" style={{ gap: 20, alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>2. 인원</label>
              <div className="pickers">
                {Array.from({ length: settings.maxParty }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`pick ${partySize === n ? 'on' : ''}`}
                    onClick={() => setPartySize(n)}
                  >
                    {n}명
                  </button>
                ))}
              </div>
            </div>

            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>3. 게임 수</label>
              <div className="pickers">
                {Array.from({ length: settings.maxGames }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`pick ${gameCount === n ? 'on' : ''}`}
                    onClick={() => setGameCount(n)}
                  >
                    {n}게임
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="quote-box">
            {quote ? (
              <>
                <div className={`quote-line ${quote.ok ? 'quote-ok' : 'quote-no'}`}>
                  {fmtTime(quote.startMin)} ~ {fmtTimeKo(quote.endMin)}
                  <span style={{ fontSize: 15, fontWeight: 600 }}> · {fmtDuration(quote.playMin)}</span>
                </div>
                <div className="small muted">
                  {partySize}명 × {gameCount}게임 × {quote.minutesPerGame}분
                  {quote.bufferMin > 0 ? ` + 정리 ${quote.bufferMin}분` : ''}
                </div>

                {quote.ok ? (
                  <div style={{ marginTop: 8 }}>
                    <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
                      배정할 타석 ({quote.freeRoomIds.length}석 가능)
                    </div>
                    <div className="pickers">
                      <button
                        type="button"
                        className={`pick ${roomId === null ? 'on' : ''}`}
                        onClick={() => setRoomId(null)}
                      >
                        자동
                      </button>
                      {activeRooms.map((room) => {
                        const free = freeRoomSet.has(room.id);
                        return (
                          <button
                            key={room.id}
                            type="button"
                            disabled={!free}
                            className={`pick ${roomId === room.id ? 'on' : ''} ${free ? 'free' : 'busy'}`}
                            onClick={() => setRoomId(room.id)}
                          >
                            {room.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    <div className="notice notice-danger">
                      {fmtTime(quote.startMin)}에는 {activeRooms.length}개 타석이 모두 차 있어요.
                    </div>
                    {quote.alternatives.length > 0 && (
                      <>
                        <div className="small" style={{ fontWeight: 700, margin: '8px 0 4px' }}>
                          이 시간은 어떠세요?
                        </div>
                        <div className="pickers">
                          {quote.alternatives.map((alt) => (
                            <button
                              key={alt.startMin}
                              type="button"
                              className="pick free"
                              onClick={() => setStartMin(alt.startMin)}
                            >
                              {fmtTime(alt.startMin)}
                              <span className="tiny muted" style={{ marginLeft: 4 }}>
                                {alt.freeRoomIds.length}석
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {quote.warnings.map((warning) => (
                  <div key={warning} className="notice notice-warn" style={{ marginTop: 8 }}>
                    {warning}
                  </div>
                ))}
              </>
            ) : (
              <div className="muted small">계산 중...</div>
            )}
          </div>

          <div className="row row-wrap" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1, minWidth: 150 }}>
              <label>이름 (선택)</label>
              <input
                ref={nameRef}
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 김민수"
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 150 }}>
              <label>연락처 (선택)</label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="예: 010-1234-5678"
              />
            </div>
          </div>

          <div className="field">
            <label>메모 (선택)</label>
            <input
              className="input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 생일 파티, 단체, 초보"
            />
          </div>

          {error && <div className="notice notice-danger">{error}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <div className="spacer" />
          <span className="tiny muted" style={{ alignSelf: 'center' }}>
            Ctrl+Enter 로 저장
          </span>
          <button className="btn btn-primary btn-lg" disabled={!canSave} onClick={() => void save()}>
            {edit ? '수정 저장' : '예약 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
