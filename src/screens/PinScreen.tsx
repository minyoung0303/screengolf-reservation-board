import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { ApiFail, api, setToken } from '../lib/api';

interface Props {
  mode: 'setup' | 'login';
  pinSet: boolean;
  isDesktopApp: boolean;
  onDone: () => void;
}

const MAX_LEN = 8;

function guessDeviceLabel(): string {
  const saved = localStorage.getItem('yeyakbo.label');
  if (saved) return saved;
  const ua = navigator.userAgent;
  if (/iPad|Tablet|SM-T|Nexus (7|9|10)/i.test(ua)) return '태블릿';
  if (/Mobi|iPhone|Android/i.test(ua)) return '휴대폰';
  return '브라우저';
}

export default function PinScreen({ mode: initialMode, pinSet, isDesktopApp, onDone }: Props): JSX.Element {
  const [mode, setMode] = useState(initialMode);
  const [resetting, setResetting] = useState(false);
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = (): void => {
    setPin('');
    setFirstPin('');
    setStep('enter');
  };

  const submit = useCallback(async () => {
    if (busy) return;
    setError('');

    if (mode === 'setup') {
      if (pin.length < 4) {
        setError('PIN은 4자리 이상으로 정해주세요.');
        return;
      }
      if (step === 'enter') {
        setFirstPin(pin);
        setPin('');
        setStep('confirm');
        return;
      }
      if (pin !== firstPin) {
        setError('두 번 입력한 PIN이 서로 달라요. 다시 정해주세요.');
        reset();
        return;
      }
      setBusy(true);
      try {
        // 재설정은 이미 PIN 이 있는 상태에서 카운터 PC 가 다시 정하는 경우다.
        if (resetting) await api.changePin('', pin);
        else await api.setupPin(pin);
        onDone();
      } catch (err) {
        setError(err instanceof ApiFail ? err.message : String(err));
        reset();
      } finally {
        setBusy(false);
      }
      return;
    }

    if (pin.length < 4) {
      setError('PIN 4자리를 입력해주세요.');
      return;
    }
    setBusy(true);
    try {
      const label = guessDeviceLabel();
      localStorage.setItem('yeyakbo.label', label);
      const result = await api.login(pin, label);
      setToken(result.token, { persist: true });
      onDone();
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : String(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  }, [busy, firstPin, mode, onDone, pin, resetting, step]);

  // 물리 키보드로도 입력할 수 있게 한다 (카운터 PC 에서 편하다)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key >= '0' && event.key <= '9') {
        setPin((prev) => (prev.length >= MAX_LEN ? prev : prev + event.key));
        return;
      }
      if (event.key === 'Backspace') setPin((prev) => prev.slice(0, -1));
      if (event.key === 'Enter') void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit]);

  const title =
    mode === 'setup'
      ? step === 'enter'
        ? resetting
          ? '새 PIN을 정해주세요'
          : 'PIN을 새로 정해주세요'
        : '한 번 더 입력해주세요'
      : 'PIN을 입력해주세요';

  const blocked = mode === 'login' && !pinSet;

  return (
    <div className="pin-wrap">
      <div className="pin-card">
        <div>
          <div style={{ fontWeight: 800, fontSize: 20 }}>예약보드</div>
          <div className="small muted">직원용 예약 관리</div>
        </div>

        {blocked ? (
          <div className="notice notice-warn">
            아직 PIN이 설정되지 않았어요.
            <br />
            카운터 컴퓨터에서 예약보드를 먼저 실행하고 PIN을 정해주세요.
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 700 }}>{title}</div>

            {mode === 'setup' && (
              <div className="notice">
                이 PIN은 <b>폰·태블릿에서 접속할 때</b> 쓰는 잠금번호예요. 매장 와이파이를 손님과 함께
                쓰기 때문에 꼭 필요해요. 숫자 4~8자리로 정하고, 0000이나 1234처럼 뻔한 번호는 피해주세요.
              </div>
            )}

            <div className="pin-dots" aria-hidden="true">
              {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
                <span key={i} className={`pin-dot ${i < pin.length ? 'on' : ''}`} />
              ))}
            </div>

            <label className="sr-only" htmlFor="pin-input">
              PIN 입력
            </label>
            <input
              id="pin-input"
              className="input"
              style={{ textAlign: 'center', letterSpacing: 6, fontSize: 18 }}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, MAX_LEN))}
              placeholder="••••"
            />

            <div className="keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPin((prev) => (prev.length >= MAX_LEN ? prev : prev + key))}
                >
                  {key}
                </button>
              ))}
              <button type="button" onClick={() => setPin('')}>
                지움
              </button>
              <button type="button" onClick={() => setPin((prev) => (prev.length >= MAX_LEN ? prev : prev + '0'))}>
                0
              </button>
              <button type="button" onClick={() => setPin((prev) => prev.slice(0, -1))}>
                ←
              </button>
            </div>

            {error && <div className="notice notice-danger">{error}</div>}

            <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void submit()}>
              {mode === 'setup' ? (step === 'enter' ? '다음' : 'PIN 설정 완료') : '확인'}
            </button>

            {mode === 'login' && (
              <>
                <div className="tiny muted">
                  PIN을 5번 틀리면 잠시 잠깁니다. PIN이 기억나지 않으면 카운터 컴퓨터에서 다시 정할 수 있어요.
                </div>
                {isDesktopApp && (
                  <button
                    className="btn"
                    onClick={() => {
                      setResetting(true);
                      setMode('setup');
                      setError('');
                      reset();
                    }}
                  >
                    PIN을 잊었어요 (이 컴퓨터에서 재설정)
                  </button>
                )}
              </>
            )}
            {mode === 'setup' && resetting && (
              <div className="tiny muted">
                재설정하면 지금 연결된 폰·태블릿은 모두 접속이 끊기고, 새 PIN을 입력해야 해요.
              </div>
            )}
            {mode === 'setup' && isDesktopApp && (
              <div className="tiny muted">PIN은 나중에 설정 화면에서 바꿀 수 있어요.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
