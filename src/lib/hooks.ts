import { useCallback, useEffect, useRef, useState } from 'react';

/** 현재 시각. 화면의 시계와 빨간 현재시각선에 쓴다. */
export function useNow(intervalMs = 20_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (): void => setMatches(mql.matches);
    setMatches(mql.matches);
    // 구형 iOS 사파리(14 이전)는 addEventListener 를 지원하지 않아 예전 방식도 함께 둔다
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    const legacy = mql as unknown as {
      addListener: (fn: () => void) => void;
      removeListener: (fn: () => void) => void;
    };
    legacy.addListener(handler);
    return () => legacy.removeListener(handler);
  }, [query]);
  return matches;
}

export interface ToastItem {
  id: number;
  text: string;
  kind: 'ok' | 'err' | 'info';
}

let toastSeq = 0;

export function useToasts(): {
  toasts: ToastItem[];
  push: (text: string, kind?: ToastItem['kind']) => void;
} {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: ToastItem['kind'] = 'info') => {
    toastSeq += 1;
    const id = toastSeq;
    setToasts((prev) => [...prev, { id, text, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, kind === 'err' ? 5000 : 2600);
  }, []);
  return { toasts, push };
}

/** 값이 바뀐 뒤 delay 만큼 조용해지면 반영한다. (예약 가능 여부 조회 횟수를 줄이는 용도) */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useLocalStorage<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* 저장 실패는 무시 */
      }
    },
    [key],
  );
  return [value, set];
}

/** 언마운트 후 상태 변경을 막기 위한 안전장치 */
export function useMounted(): () => boolean {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}
