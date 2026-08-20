import { useState } from 'react';
import type { JSX } from 'react';
import { useApp } from '../lib/appContext';
import QrCode from './QrCode';

/**
 * 폰·태블릿을 연결하는 방법을 알려주는 창.
 * 설치 파일을 폰에 넣으려다 헤매는 일이 많아서, 접속 주소와 QR 코드를 한 화면에 모았다.
 */
export default function ConnectDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { lanUrls, remoteCount } = useApp();
  const [index, setIndex] = useState(0);
  const url = lanUrls[index] ?? '';

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="폰·태블릿 연결">
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-head">
          <h2>폰·태블릿 연결</h2>
          <span className="chip">연결된 기기 {remoteCount}대</span>
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="notice notice-warn">
            폰·태블릿에는 <b>설치할 것이 없어요.</b> 설치파일(exe)은 이 카운터 컴퓨터에만 쓰는 거예요.
            아래 주소를 폰 브라우저로 열면 바로 예약판이 나와요.
          </div>

          {lanUrls.length === 0 ? (
            <div className="notice notice-danger">
              네트워크에 연결되어 있지 않아 접속 주소를 만들 수 없어요. 이 컴퓨터가 매장 와이파이(또는
              유선)에 연결되어 있는지 확인해주세요.
            </div>
          ) : (
            <>
              <div className="row row-wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
                <div style={{ textAlign: 'center' }}>
                  <QrCode text={url} size={210} />
                  <div className="tiny muted" style={{ marginTop: 6 }}>
                    카메라로 찍으면 열려요
                  </div>
                </div>

                <div className="stack" style={{ flex: 1, minWidth: 220 }}>
                  <div className="field">
                    <label>접속 주소 (직접 입력할 때)</label>
                    <input
                      className="input"
                      readOnly
                      value={url}
                      onFocus={(e) => e.currentTarget.select()}
                      style={{ fontWeight: 700, fontSize: 16 }}
                      aria-label="접속 주소"
                    />
                  </div>

                  {lanUrls.length > 1 && (
                    <div className="field">
                      <label>주소가 여러 개예요. 안 되면 다른 것으로 바꿔보세요</label>
                      <div className="pickers">
                        {lanUrls.map((candidate, i) => (
                          <button
                            key={candidate}
                            type="button"
                            className={`pick ${i === index ? 'on' : ''}`}
                            style={{ minWidth: 0, fontSize: 12 }}
                            onClick={() => setIndex(i)}
                          >
                            {candidate.replace('http://', '')}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="notice">
                    폰이 <b>매장 와이파이</b>에 연결되어 있어야 해요. LTE·5G로 잡혀 있으면 열리지 않아요.
                  </div>
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: 14, marginBottom: 6 }}>홈 화면에 앱처럼 두기</h3>
                <div className="row row-wrap" style={{ gap: 10, alignItems: 'stretch' }}>
                  <div className="panel sec" style={{ flex: 1, minWidth: 240, boxShadow: 'none' }}>
                    <b className="small">아이폰 · 아이패드</b>
                    <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      <li>
                        <b>사파리</b>로 위 주소를 열기 (크롬은 안 돼요)
                      </li>
                      <li>아래쪽 공유 버튼 누르기</li>
                      <li>목록에서 <b>홈 화면에 추가</b></li>
                    </ol>
                  </div>
                  <div className="panel sec" style={{ flex: 1, minWidth: 240, boxShadow: 'none' }}>
                    <b className="small">안드로이드</b>
                    <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      <li>
                        <b>크롬</b>으로 위 주소를 열기
                      </li>
                      <li>오른쪽 위 ⋮ 누르기</li>
                      <li><b>홈 화면에 추가</b> 또는 <b>앱 설치</b></li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="notice notice-ok">
                처음 열면 <b>PIN</b>을 물어봐요. 매장에서 정한 PIN을 넣으면 그 기기는 다음부터 기억해요.
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <div className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
