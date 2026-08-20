import { useState } from 'react';
import type { JSX } from 'react';
import type { Reservation } from '@shared/types';
import { STATUS_LABEL } from '@shared/types';
import { fmtDateKo, fmtDuration, fmtPhone, fmtTime, fmtTimeKo } from '@shared/time';
import { ApiFail, api } from '../lib/api';
import { useApp } from '../lib/appContext';

interface Props {
  reservation: Reservation;
  onClose: () => void;
  onChanged: (message: string) => void;
  onEdit: (reservation: Reservation) => void;
}

export default function DetailDialog({ reservation, onClose, onChanged, onEdit }: Props): JSX.Element {
  const { rooms } = useApp();
  const [current, setCurrent] = useState(reservation);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const room = rooms.find((r) => r.id === current.roomId);
  const isVoid = current.status === 'cancelled' || current.status === 'no_show';

  const act = async (fn: () => Promise<Reservation | { ok: boolean }>, message: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await fn();
      if ('id' in result) setCurrent(result);
      onChanged(message);
      if (!('id' in result)) onClose();
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="예약 상세">
      <div className="modal">
        <div className="modal-head">
          <h2>
            {room?.name ?? '타석'} · {fmtTime(current.startMin)}
          </h2>
          <span className={`badge badge-${current.status}`}>{STATUS_LABEL[current.status]}</span>
          {current.isWalkin === 1 && <span className="chip">워크인</span>}
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="quote-box">
            <div className="quote-line">
              {fmtTime(current.startMin)} ~ {fmtTimeKo(current.endMin)}
              <span style={{ fontSize: 15, fontWeight: 600 }}> · {fmtDuration(current.playMin)}</span>
            </div>
            <div className="small muted">
              {fmtDateKo(current.date)} · {current.partySize}명 {current.gameCount}게임
              {current.bufferMin > 0 ? ` · 정리 ${current.bufferMin}분 포함 ${fmtTimeKo(current.blockEndMin)}까지 점유` : ''}
            </div>
          </div>

          <div>
            <div className="kv">
              <span>이름</span>
              <span>{current.name || '-'}</span>
            </div>
            <div className="kv">
              <span>연락처</span>
              <span>{current.phone ? fmtPhone(current.phone) : '-'}</span>
            </div>
            <div className="kv">
              <span>메모</span>
              <span>{current.memo || '-'}</span>
            </div>
            <div className="kv">
              <span>등록</span>
              <span>
                {new Date(current.createdAt).toLocaleString('ko-KR')} · {current.createdBy || '-'}
              </span>
            </div>
          </div>

          {!isVoid && (
            <div className="field">
              <label>시간 조정</label>
              <div className="row row-wrap">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void act(() => api.extend(current.id, { addMin: 30 }), '30분 연장했어요.')}
                >
                  +30분
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void act(() => api.extend(current.id, { addMin: -30 }), '30분 줄였어요.')}
                >
                  -30분
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void act(() => api.extend(current.id, { addGames: 1 }), '1게임 추가했어요.')}
                >
                  +1게임
                </button>
                <div className="spacer" />
                <button className="btn" disabled={busy} onClick={() => onEdit(current)}>
                  전체 수정
                </button>
              </div>
            </div>
          )}

          <div className="field">
            <label>상태</label>
            <div className="row row-wrap">
              {current.status === 'booked' && (
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void act(() => api.setStatus(current.id, 'checked_in'), '체크인 처리했어요.')}
                >
                  도착 (체크인)
                </button>
              )}
              {(current.status === 'booked' || current.status === 'checked_in') && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void act(() => api.setStatus(current.id, 'done'), '이용 완료로 바꿨어요.')}
                >
                  이용 완료
                </button>
              )}
              {current.status === 'booked' && (
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void act(() => api.setStatus(current.id, 'no_show'), '노쇼로 표시했어요.')}
                >
                  노쇼
                </button>
              )}
              {!isVoid && (
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void act(() => api.setStatus(current.id, 'cancelled'), '예약을 취소했어요.')}
                >
                  예약 취소
                </button>
              )}
              {isVoid && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void act(() => api.setStatus(current.id, 'booked'), '예약을 되살렸어요.')}
                >
                  되살리기
                </button>
              )}
            </div>
            <div className="tiny muted">
              취소·노쇼는 기록으로 남고 자리는 다시 비어요. 완전히 지우려면 아래 삭제를 쓰세요.
            </div>
          </div>

          {error && <div className="notice notice-danger">{error}</div>}
        </div>

        <div className="modal-foot">
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('이 예약을 완전히 삭제할까요? 되돌릴 수 없어요.')) return;
              void act(() => api.remove(current.id), '삭제했어요.');
            }}
          >
            삭제
          </button>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
