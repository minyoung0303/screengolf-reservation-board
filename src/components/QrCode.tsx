import { useMemo } from 'react';
import type { JSX } from 'react';
import qrcode from 'qrcode-generator';

/**
 * 접속 주소를 QR 코드로 그린다. 태블릿·폰 카메라로 찍으면 바로 예약보드가 열린다.
 * 인터넷 없이 화면에서 직접 만들어 그린다.
 */
export default function QrCode({
  text,
  size = 220,
  title,
}: {
  text: string;
  size?: number;
  title?: string;
}): JSX.Element {
  const { path, span } = useMemo(() => {
    const qr = qrcode(0, 'M'); // 0 = 크기 자동
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 2;
    const parts: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) parts.push(`M${col + margin},${row + margin}h1v1h-1z`);
      }
    }
    return { path: parts.join(''), span: count + margin * 2 };
  }, [text]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title ?? `접속 주소 QR 코드: ${text}`}
      style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--line)' }}
    >
      <rect width={span} height={span} fill="#fff" />
      <path d={path} fill="#101827" />
    </svg>
  );
}
