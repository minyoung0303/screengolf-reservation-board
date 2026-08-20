/**
 * 매뉴얼(마크다운)을 인쇄용 PDF 로 바꾼다.
 * 이미 설치된 Electron 의 인쇄 기능을 쓰기 때문에 추가 프로그램이 필요 없다.
 *
 * 실행: npx electron scripts/md-to-pdf.mjs
 */
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { marked } from 'marked';

const MANUAL_DIR = path.join('docs', 'manual');

const DOCS = ['설치_매뉴얼', '폰_태블릿_접속방법', 'PIN_안내'].map((name) => ({
  md: path.join(MANUAL_DIR, `${name}.md`),
  pdf: path.join(MANUAL_DIR, `${name}.pdf`),
}));

const CSS = `
  @page { size: A4; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
    font-size: 10.5pt;
    line-height: 1.65;
    color: #16202e;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 {
    font-size: 20pt;
    margin: 0 0 4pt;
    padding-bottom: 6pt;
    border-bottom: 2.5pt solid #1d4ed8;
    color: #12306e;
  }
  h2 {
    font-size: 14pt;
    margin: 20pt 0 7pt;
    padding: 5pt 8pt;
    background: #eaf0ff;
    border-left: 4pt solid #1d4ed8;
    color: #12306e;
    break-after: avoid;
    page-break-after: avoid;
  }
  h3 {
    font-size: 11.5pt;
    margin: 13pt 0 5pt;
    color: #1b3a75;
    break-after: avoid;
    page-break-after: avoid;
  }
  p { margin: 6pt 0; }
  strong { color: #0b1a33; }
  a { color: #1d4ed8; text-decoration: none; }
  ul, ol { margin: 6pt 0 6pt 0; padding-left: 20pt; }
  li { margin: 3pt 0; }
  hr { border: none; border-top: 1pt solid #d5dde8; margin: 14pt 0; }
  code {
    font-family: 'D2Coding', 'Consolas', 'Malgun Gothic', monospace;
    font-size: 9.5pt;
    background: #f1f4f9;
    border: 0.5pt solid #dde3ec;
    border-radius: 3pt;
    padding: 0 3pt;
  }
  pre {
    font-family: 'D2Coding', 'Consolas', 'Malgun Gothic', monospace;
    font-size: 9pt;
    /* 줄 간격을 좁혀서 상자 그림의 세로선이 이어지게 한다 */
    line-height: 1.22;
    background: #f7f9fc;
    border: 0.7pt solid #d5dde8;
    border-radius: 4pt;
    padding: 8pt 10pt;
    margin: 8pt 0;
    white-space: pre;
    overflow: visible;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  pre code { background: none; border: none; padding: 0; font-size: 9pt; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0;
    font-size: 9.5pt;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  th, td {
    border: 0.6pt solid #c5cfdd;
    padding: 4pt 6pt;
    text-align: left;
    vertical-align: top;
  }
  th { background: #eef2f8; font-weight: 700; color: #12306e; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  blockquote {
    margin: 8pt 0;
    padding: 6pt 10pt;
    border-left: 3pt solid #e8cf9f;
    background: #fdf8ee;
    color: #6b4a09;
  }
  blockquote p { margin: 3pt 0; }
`;

function buildHtml(title, markdown) {
  const body = marked.parse(markdown, { gfm: true, breaks: false });
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${title}</title>
<style>${CSS}</style></head><body>${body}</body></html>`;
}

function countPages(pdfPath) {
  const buf = fs.readFileSync(pdfPath).toString('latin1');
  const matches = buf.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

async function render(win, doc) {
  const markdown = fs.readFileSync(doc.md, 'utf8');
  const title = doc.pdf.replace(/\.pdf$/, '').replace(/_/g, ' ');
  const html = buildHtml(title, markdown);

  const tmp = path.join(os.tmpdir(), `yeyakbo-doc-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html, 'utf8');

  try {
    // 창을 재사용하면 첫 문서 뒤에 두 번째 문서 로드가 실패하는 경우가 있어 재시도한다
    for (let attempt = 1; ; attempt += 1) {
      try {
        await win.loadFile(tmp);
        break;
      } catch (error) {
        if (attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    // 폰트 적용이 끝난 뒤 인쇄되도록 잠깐 기다린다
    await new Promise((resolve) => setTimeout(resolve, 500));

    const data = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.55, bottom: 0.6, left: 0.55, right: 0.55 }, // 인치
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        `<div style="width:100%;font-size:8pt;color:#7a8699;padding:0 14mm;` +
        `font-family:'Malgun Gothic',sans-serif;display:flex;justify-content:space-between;">` +
        `<span>예약보드 · ${title}</span><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      generateDocumentOutline: true,
    });

    fs.writeFileSync(doc.pdf, data);
    console.log(
      `  ${doc.pdf}  ${(data.length / 1024).toFixed(0)} KB  ${countPages(doc.pdf)}쪽`,
    );

    // --preview: 글꼴과 표가 제대로 그려지는지 눈으로 확인할 이미지를 함께 저장한다
    if (process.argv.includes('--preview')) {
      const shot = await win.webContents.capturePage();
      const out = path.join(os.tmpdir(), `${doc.pdf.replace(/\.pdf$/, '')}-preview.png`);
      fs.writeFileSync(out, shot.toPNG());
      console.log(`    미리보기: ${out}`);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

app.whenReady().then(async () => {
  console.log('매뉴얼 PDF 만들기');
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 1400,
    webPreferences: { offscreen: true, javascript: false },
  });
  try {
    for (const doc of DOCS) await render(win, doc);
    console.log('완료');
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error('실패:', error);
    win.destroy();
    app.exit(1);
  }
});
