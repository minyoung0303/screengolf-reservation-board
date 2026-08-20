import type { JSX } from 'react';
import { STATUS_LABEL } from '@shared/types';
import { fmtDateKoFull, fmtPhone, fmtTime, fmtTimeKo } from '@shared/time';
import { desktopBridge } from '../lib/api';
import { useApp } from '../lib/appContext';

/**
 * 종이 예약표. 프로그램이 꺼져 있거나 정전일 때를 대비한 대비책이다.
 */
export default function PrintSheet(): JSX.Element {
  const { day, date, rooms, settings } = useApp();
  const list = [...(day?.reservations ?? [])]
    .filter((r) => r.status !== 'cancelled')
    .sort((a, b) => a.startMin - b.startMin || a.roomId - b.roomId);

  const roomName = (id: number): string => rooms.find((r) => r.id === id)?.name ?? `${id}번`;

  const print = (): void => {
    const bridge = desktopBridge();
    if (bridge) void bridge.print();
    else window.print();
  };

  return (
    <div className="stack">
      <div className="row no-print">
        <button className="btn btn-primary btn-lg" onClick={print}>
          인쇄하기
        </button>
        <span className="small muted">
          A4 한 장으로 오늘 예약을 출력해요. 취소된 예약은 빠집니다.
        </span>
      </div>

      <div className="panel print-sheet">
        <h1>{settings.storeName ? `${settings.storeName} ` : ''}예약표</h1>
        <div className="small muted" style={{ marginBottom: 10 }}>
          {fmtDateKoFull(date)} · 영업 {fmtTime(settings.openMin)}~{fmtTime(settings.closeMin)} · 출력{' '}
          {new Date().toLocaleString('ko-KR')} · 총 {list.length}건
        </div>

        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>시간</th>
              <th style={{ width: 60 }}>타석</th>
              <th style={{ width: 90 }}>이름</th>
              <th style={{ width: 80 }}>인원·게임</th>
              <th style={{ width: 120 }}>연락처</th>
              <th>메모</th>
              <th style={{ width: 60 }}>상태</th>
              <th style={{ width: 70 }}>확인</th>
            </tr>
          </thead>
          <tbody>
            {list.map((reservation) => (
              <tr key={reservation.id}>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmtTime(reservation.startMin)} ~ {fmtTimeKo(reservation.endMin)}
                </td>
                <td>{roomName(reservation.roomId)}</td>
                <td>{reservation.name || (reservation.isWalkin === 1 ? '워크인' : '-')}</td>
                <td>
                  {reservation.partySize}명 {reservation.gameCount}G
                </td>
                <td>{reservation.phone ? fmtPhone(reservation.phone) : '-'}</td>
                <td className="small">{reservation.memo || ''}</td>
                <td className="small">{STATUS_LABEL[reservation.status]}</td>
                <td />
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 20 }}>
                  예약 없음
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
