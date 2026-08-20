import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Reservation } from '@shared/types';
import { STATUS_LABEL } from '@shared/types';
import { fmtDateKo, fmtPhone, fmtTime, fmtTimeKo } from '@shared/time';
import { ApiFail, api } from '../lib/api';
import { useApp } from '../lib/appContext';
import { useDebounced } from '../lib/hooks';

export default function SearchScreen(): JSX.Element {
  const { rooms, setDate, setTab, openDetail, toast } = useApp();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);
  const [results, setResults] = useState<Reservation[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    let alive = true;
    api
      .search(debounced.trim())
      .then((res) => {
        if (!alive) return;
        setResults(res.results);
        setSearched(true);
      })
      .catch((error) => {
        if (alive) toast(error instanceof ApiFail ? error.message : String(error), 'err');
      });
    return () => {
      alive = false;
    };
  }, [debounced, toast]);

  const roomName = (id: number): string => rooms.find((r) => r.id === id)?.name ?? `${id}번`;

  return (
    <div className="stack">
      <div className="panel sec">
        <div className="field">
          <label>이름 또는 연락처로 찾기</label>
          <input
            className="input"
            style={{ maxWidth: 360 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 김민수 · 5678"
            autoFocus
          />
          <span className="tiny muted">전화번호는 뒷자리만 입력해도 찾아요. 두 글자 이상 입력해주세요.</span>
        </div>
      </div>

      {results.length > 0 && (
        <div className="panel" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>날짜</th>
                <th style={{ width: 130 }}>시간</th>
                <th style={{ width: 70 }}>타석</th>
                <th style={{ width: 110 }}>이름</th>
                <th style={{ width: 100 }}>인원·게임</th>
                <th style={{ width: 130 }}>연락처</th>
                <th style={{ width: 80 }}>상태</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {results.map((reservation) => (
                <tr key={reservation.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(reservation)}>
                  <td>{fmtDateKo(reservation.date)}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmtTime(reservation.startMin)} ~ {fmtTimeKo(reservation.endMin)}
                  </td>
                  <td>{roomName(reservation.roomId)}</td>
                  <td>{reservation.name || '-'}</td>
                  <td>
                    {reservation.partySize}명 {reservation.gameCount}게임
                  </td>
                  <td>{reservation.phone ? fmtPhone(reservation.phone) : '-'}</td>
                  <td>
                    <span className={`badge badge-${reservation.status}`}>
                      {STATUS_LABEL[reservation.status]}
                    </span>
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setDate(reservation.date);
                        setTab('board');
                      }}
                    >
                      예약판에서
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {searched && results.length === 0 && (
        <div className="panel sec muted">찾는 예약이 없어요.</div>
      )}
    </div>
  );
}
