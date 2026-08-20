import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { DurationRule, Room, Settings } from '@shared/types';
import { fmtDuration, fmtTime, parseHHMM } from '@shared/time';
import { ApiFail, api, desktopBridge, type SettingsPayload } from '../lib/api';
import { useApp } from '../lib/appContext';
import QrCode from '../components/QrCode';

interface Props {
  onSignedOut: () => void;
}

export default function SettingsScreen({ onSignedOut }: Props): JSX.Element {
  const { toast, reloadBootstrap, reloadDay, isDesktopApp, openConnect } = useApp();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [rules, setRules] = useState<DurationRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [deskInfo, setDeskInfo] = useState<{ userDataDir: string; backupDir: string; version: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const payload = await api.settings();
      setData(payload);
      setForm(payload.settings);
      setRooms(payload.rooms);
      setRules(payload.durationRules);
    } catch (error) {
      toast(error instanceof ApiFail ? error.message : String(error), 'err');
    }
  }, [toast]);

  useEffect(() => {
    void load();
    const bridge = desktopBridge();
    if (bridge) {
      void bridge.getInfo().then((info) =>
        setDeskInfo({ userDataDir: info.userDataDir, backupDir: info.backupDir, version: info.version }),
      );
    }
  }, [load]);

  const save = async (payload: {
    settings?: Partial<Settings>;
    rooms?: Room[];
    durationRules?: DurationRule[];
  }): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await api.saveSettings(payload);
      toast('저장했어요.', 'ok');
      await load();
      await reloadBootstrap();
      await reloadDay();
    } catch (error) {
      toast(error instanceof ApiFail ? error.message : String(error), 'err');
    } finally {
      setBusy(false);
    }
  };

  if (!form || !data) return <div className="panel sec muted">불러오는 중...</div>;

  const set = (patch: Partial<Settings>): void => setForm({ ...form, ...patch });

  return (
    <div className="settings-grid">
      {/* ------------------------------ 영업 정보 ------------------------------ */}
      <section className="panel sec">
        <h3>영업 정보</h3>
        <div className="field">
          <label>매장 이름 (화면 표시용)</label>
          <input
            className="input"
            value={form.storeName}
            onChange={(e) => set({ storeName: e.target.value })}
            placeholder="비워두면 표시하지 않아요"
          />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <TimeField label="영업 시작" value={form.openMin} onChange={(v) => set({ openMin: v })} />
          <TimeField label="영업 종료" value={form.closeMin} onChange={(v) => set({ closeMin: v })} />
          <TimeField
            label="마지막 입장"
            value={form.lastEntryMin}
            onChange={(v) => set({ lastEntryMin: v })}
          />
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>시간 단위</label>
          <select
            className="select"
            value={form.slotMin}
            onChange={(e) => set({ slotMin: Number(e.target.value) })}
          >
            <option value={10}>10분</option>
            <option value={15}>15분</option>
            <option value={30}>30분</option>
            <option value={60}>60분</option>
          </select>
          <span className="tiny muted">예약판 눈금과 시간 선택 버튼의 간격이에요.</span>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save({ settings: form })}>
            영업 정보 저장
          </button>
        </div>
      </section>

      {/* ---------------------------- 소요시간 규칙 ---------------------------- */}
      <section className="panel sec">
        <h3>소요시간 규칙</h3>
        <div className="notice" style={{ marginBottom: 10 }}>
          소요시간 = <b>인원 × 게임수 × 1인 1게임 시간</b>. 예를 들어 2명 2게임에 30분 기준이면 2시간이에요.
          실제로 재보고 인원별로 다르면 아래 숫자를 고쳐주세요.
        </div>

        <div className="rule-row" style={{ fontWeight: 700, fontSize: 13, color: 'var(--muted)' }}>
          <span>인원</span>
          <span>1인 1게임 시간(분)</span>
          <span>2게임 기준</span>
        </div>
        {rules.map((rule) => (
          <div className="rule-row" key={rule.partySize}>
            <span>{rule.partySize}명</span>
            <input
              className="input"
              type="number"
              min={1}
              max={600}
              value={rule.minutesPerGame}
              onChange={(e) =>
                setRules(
                  rules.map((r) =>
                    r.partySize === rule.partySize
                      ? { ...r, minutesPerGame: Number(e.target.value) }
                      : r,
                  ),
                )
              }
            />
            <span className="small muted">{fmtDuration(rule.partySize * 2 * rule.minutesPerGame)}</span>
          </div>
        ))}

        <div className="field" style={{ marginTop: 12 }}>
          <label>예약 사이 여유(정리) 시간 · 분</label>
          <input
            className="input"
            type="number"
            min={0}
            max={120}
            value={form.bufferMin}
            onChange={(e) => set({ bufferMin: Number(e.target.value) })}
          />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>최대 인원</label>
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={form.maxParty}
              onChange={(e) => set({ maxParty: Number(e.target.value) })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>최대 게임 수</label>
            <input
              className="input"
              type="number"
              min={1}
              max={20}
              value={form.maxGames}
              onChange={(e) => set({ maxGames: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void save({ settings: form, durationRules: rules })}
          >
            소요시간 규칙 저장
          </button>
        </div>
      </section>

      {/* ------------------------------ 타석 관리 ------------------------------ */}
      <section className="panel sec">
        <h3>타석 ({rooms.filter((r) => r.active === 1).length}개 사용중)</h3>
        <div className="tiny muted" style={{ marginBottom: 8 }}>
          쓰지 않는 타석은 체크를 풀어주세요. 지난 예약 기록이 남아 있어서 삭제하지 않고 숨깁니다.
        </div>
        {rooms.map((room) => (
          <div className="rule-row" key={room.id} style={{ gridTemplateColumns: '1fr 74px auto' }}>
            <input
              className="input"
              value={room.name}
              onChange={(e) =>
                setRooms(rooms.map((r) => (r.id === room.id ? { ...r, name: e.target.value } : r)))
              }
            />
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={room.capacity}
              title="최대 인원"
              onChange={(e) =>
                setRooms(
                  rooms.map((r) => (r.id === room.id ? { ...r, capacity: Number(e.target.value) } : r)),
                )
              }
            />
            <label className="chip" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={room.active === 1}
                onChange={(e) =>
                  setRooms(
                    rooms.map((r) => (r.id === room.id ? { ...r, active: e.target.checked ? 1 : 0 } : r)),
                  )
                }
              />
              사용
            </label>
          </div>
        ))}
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn"
            onClick={() => {
              const nextId = rooms.reduce((max, r) => Math.max(max, r.id), 0) + 1;
              setRooms([
                ...rooms,
                { id: nextId, name: `${nextId}번`, capacity: 6, sortOrder: nextId, active: 1 },
              ]);
            }}
          >
            타석 추가
          </button>
          <div className="spacer" />
          <button className="btn btn-primary" disabled={busy} onClick={() => void save({ rooms })}>
            타석 저장
          </button>
        </div>
      </section>

      {/* --------------------------- 폰·태블릿 / PIN --------------------------- */}
      <section className="panel sec">
        <h3>폰·태블릿 접속과 PIN</h3>
        <div className="notice notice-warn" style={{ marginBottom: 10 }}>
          폰·태블릿에는 <b>설치할 것이 없어요.</b> 설치파일(exe)은 이 컴퓨터에만 쓰는 거예요. 같은
          와이파이에서 아래 주소를 브라우저로 열면 예약판이 나오고, PIN을 한 번 넣으면 그 기기는 기억해요.
        </div>

        <div className="row row-wrap" style={{ gap: 12, alignItems: 'center', marginBottom: 10 }}>
          {data.lanUrls.length > 0 && <QrCode text={data.lanUrls[0]} size={128} />}
          <div className="stack" style={{ flex: 1, minWidth: 180 }}>
            {data.lanUrls.length === 0 ? (
              <div className="notice notice-danger">
                네트워크에 연결되어 있지 않아 접속 주소를 만들 수 없어요.
              </div>
            ) : (
              data.lanUrls.map((url) => (
                <div className="kv" key={url}>
                  <span style={{ fontWeight: 700 }}>접속 주소</span>
                  <span style={{ userSelect: 'all' }}>{url}</span>
                </div>
              ))
            )}
            <button className="btn btn-primary" onClick={openConnect}>
              연결 방법 크게 보기 (QR)
            </button>
          </div>
        </div>
        <div className="kv">
          <span>연결된 폰·태블릿</span>
          <span>{data.remoteCount}대</span>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn btn-danger"
            disabled={busy || !isDesktopApp}
            onClick={() => {
              if (!window.confirm('연결된 폰·태블릿의 접속을 모두 끊을까요? 다시 PIN을 입력해야 해요.'))
                return;
              void api
                .revokeDevices()
                .then(() => {
                  toast('모든 기기 접속을 끊었어요.', 'ok');
                  void load();
                })
                .catch((error) =>
                  toast(error instanceof ApiFail ? error.message : String(error), 'err'),
                );
            }}
          >
            모든 기기 접속 끊기
          </button>
        </div>

        <label className="chip" style={{ cursor: 'pointer', marginTop: 12 }}>
          <input
            type="checkbox"
            checked={form.requirePinOnDesktop === 1}
            onChange={(e) => {
              const next = e.target.checked ? 1 : 0;
              set({ requirePinOnDesktop: next });
              void save({ settings: { ...form, requirePinOnDesktop: next } });
            }}
          />
          이 컴퓨터에서도 PIN 요구하기
        </label>

        {isDesktopApp ? (
          <PinChanger pinSet={data.pinSet} onDone={() => void load()} />
        ) : (
          <div className="notice" style={{ marginTop: 12 }}>
            PIN 변경은 카운터 컴퓨터에서만 할 수 있어요.
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn"
                onClick={() => {
                  void api.logout().finally(() => onSignedOut());
                }}
              >
                이 기기 로그아웃
              </button>
            </div>
          </div>
        )}
      </section>

      {/* -------------------------------- 백업 -------------------------------- */}
      <section className="panel sec">
        <h3>백업</h3>
        <div className="tiny muted" style={{ marginBottom: 8 }}>
          프로그램을 켤 때마다 자동으로 백업해요. 백업 폴더를 OneDrive 안으로 지정하면 클라우드에도 함께
          올라갑니다. 최근 30개까지 보관해요.
        </div>
        <div className="field">
          <label>백업 폴더 (비워두면 기본 폴더)</label>
          <input
            className="input"
            value={form.backupDir}
            onChange={(e) => set({ backupDir: e.target.value })}
            placeholder={deskInfo?.backupDir ?? '기본 폴더'}
          />
        </div>
        <div className="row row-wrap" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save({ settings: form })}>
            백업 폴더 저장
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              void api
                .backupNow()
                .then((res) => {
                  toast('백업했어요.', 'ok');
                  setData((prev) => (prev ? { ...prev, backups: res.backups } : prev));
                })
                .catch((error) => toast(error instanceof ApiFail ? error.message : String(error), 'err'));
            }}
          >
            지금 백업
          </button>
          {isDesktopApp && (
            <button className="btn" onClick={() => void desktopBridge()?.openBackupFolder()}>
              백업 폴더 열기
            </button>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          {data.backups.slice(0, 5).map((backup) => (
            <div className="kv" key={backup.name}>
              <span className="small">{backup.name}</span>
              <span className="tiny">{new Date(backup.at).toLocaleString('ko-KR')}</span>
            </div>
          ))}
          {data.backups.length === 0 && <div className="tiny muted">백업 파일이 아직 없어요.</div>}
        </div>
      </section>

      {/* ------------------------------ 데이터 관리 ------------------------------ */}
      <section className="panel sec">
        <h3>데이터</h3>
        <div className="field">
          <label>지난 예약 보관 기간 (일) · 0이면 계속 보관</label>
          <input
            className="input"
            type="number"
            min={0}
            max={3650}
            value={form.retentionDays}
            onChange={(e) => set({ retentionDays: Number(e.target.value) })}
          />
          <span className="tiny muted">
            손님 연락처가 남아 있으니, 필요 없어지면 자동으로 지워지게 두는 편이 안전해요.
          </span>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save({ settings: form })}>
            저장
          </button>
        </div>
        {deskInfo && (
          <div style={{ marginTop: 12 }}>
            <div className="kv">
              <span>프로그램 버전</span>
              <span>{deskInfo.version}</span>
            </div>
            <div className="kv">
              <span>데이터 위치</span>
              <span>{deskInfo.userDataDir}</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <div className="field" style={{ flex: 1 }}>
      <label>{label}</label>
      <input
        className="input"
        type="time"
        step={300}
        value={fmtTime(Math.min(value, 1439))}
        onChange={(e) => {
          const parsed = parseHHMM(e.target.value);
          if (parsed !== null) onChange(parsed);
        }}
      />
    </div>
  );
}

function PinChanger({ pinSet, onDone }: { pinSet: boolean; onDone: () => void }): JSX.Element {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => setOpen(true)}>
          {pinSet ? 'PIN 변경' : 'PIN 설정'}
        </button>
      </div>
    );
  }

  const submit = async (): Promise<void> => {
    if (newPin !== confirmPin) {
      toast('새 PIN 두 개가 서로 달라요.', 'err');
      return;
    }
    setBusy(true);
    try {
      // 카운터 PC 에서는 현재 PIN 없이도 다시 정할 수 있다 (PIN 을 잊었을 때의 복구 경로)
      await api.changePin('', newPin);
      toast('PIN을 바꿨어요. 폰·태블릿은 새 PIN으로 다시 접속해야 해요.', 'ok');
      setOpen(false);
      setNewPin('');
      setConfirmPin('');
      onDone();
    } catch (error) {
      toast(error instanceof ApiFail ? error.message : String(error), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notice" style={{ marginTop: 12 }}>
      <div className="stack">
        {pinSet && (
          <div className="tiny muted">
            카운터 컴퓨터에서는 지금 PIN을 몰라도 새로 정할 수 있어요. (PIN을 잊었을 때의 복구 방법)
          </div>
        )}
        <div className="field">
          <label>새 PIN (숫자 4~8자리)</label>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
        </div>
        <div className="field">
          <label>새 PIN 확인</label>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            바꾸기
          </button>
          <button className="btn" onClick={() => setOpen(false)}>
            취소
          </button>
        </div>
        <div className="tiny muted">
          PIN을 바꾸면 지금 연결된 폰·태블릿은 모두 접속이 끊기고 새 PIN을 입력해야 해요.
        </div>
      </div>
    </div>
  );
}
