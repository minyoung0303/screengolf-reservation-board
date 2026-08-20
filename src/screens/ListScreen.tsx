import type { JSX } from 'react';
import type { Reservation } from '@shared/types';
import { STATUS_LABEL } from '@shared/types';
import { fmtDateKo, fmtPhone, fmtTime, fmtTimeKo } from '@shared/time';
import { ApiFail, api } from '../lib/api';
import { useApp } from '../lib/appContext';

export default function ListScreen(): JSX.Element {
  const { day, date, rooms, openDetail, toast, reloadDay } = useApp();
  const list = [...(day?.reservations ?? [])].sort(
    (a, b) => a.startMin - b.startMin || a.roomId - b.roomId,
  );

  const roomName = (id: number): string => rooms.find((r) => r.id === id)?.name ?? `${id}번`;

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
    <div className="panel" style={{ overflow: 'hidden' }}>
      <div className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
        <b>{fmtDateKo(date)} 예약 목록</b>
        <span className="muted small">총 {list.length}건</span>
      </div>

      {list.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center' }} className="muted">
          예약이 없어요.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 130 }}>시간</th>
              <th style={{ width: 70 }}>타석</th>
              <th style={{ width: 110 }}>이름</th>
              <th style={{ width: 100 }}>인원·게임</th>
              <th style={{ width: 130 }}>연락처</th>
              <th>메모</th>
              <th style={{ width: 80 }}>상태</th>
              <th style={{ width: 150 }} className="no-print">
                빠른 처리
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((reservation) => {
              const voided =
                reservation.status === 'cancelled' || reservation.status === 'no_show';
              return (
                <tr
                  key={reservation.id}
                  className={voided ? 'void' : ''}
                  style={{ cursor: 'pointer' }}
                  onClick={() => openDetail(reservation)}
                >
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                    {fmtTime(reservation.startMin)} ~ {fmtTimeKo(reservation.endMin)}
                  </td>
                  <td>{roomName(reservation.roomId)}</td>
                  <td>
                    {reservation.name || (reservation.isWalkin === 1 ? '워크인' : '-')}
                  </td>
                  <td>
                    {reservation.partySize}명 {reservation.gameCount}게임
                  </td>
                  <td>{reservation.phone ? fmtPhone(reservation.phone) : '-'}</td>
                  <td className="small">{reservation.memo || ''}</td>
                  <td>
                    <span className={`badge badge-${reservation.status}`}>
                      {STATUS_LABEL[reservation.status]}
                    </span>
                  </td>
                  <td className="no-print" onClick={(event) => event.stopPropagation()}>
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
