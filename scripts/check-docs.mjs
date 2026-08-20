/**
 * 문서 점검. 공개 전에 한 번 돌린다.
 * - 한글 인코딩 손상 여부 (UTF-8 이 아닌 도구로 저장하면 깨진다)
 * - README 내부 링크·이미지 경로 유효성
 * - 문체 확인용 서술형 종결 개수
 *
 * 실행: npm run check:docs
 */
import fs from 'node:fs';

const DOCS = [
  'README.md',
  'docs/기획서.md',
  'docs/manual/설치_매뉴얼.md',
  'docs/manual/폰_태블릿_접속방법.md',
  'docs/manual/PIN_안내.md',
];

let fail = 0;

console.log('문서 점검\n');
console.log('파일                                    줄     한글   깨진문자  서술형종결');
console.log('-'.repeat(72));

for (const file of DOCS) {
  if (!fs.existsSync(file)) {
    console.log(`${file.padEnd(34)} 없음`);
    fail += 1;
    continue;
  }
  const text = fs.readFileSync(file, 'utf8');
  const broken = (text.match(/\uFFFD/g) ?? []).length;
  const korean = (text.match(/[가-힣]/g) ?? []).length;
  const narrative = (text.match(/(?:해요|합니다|입니다|어요|예요)[.\n)]/g) ?? []).length;
  console.log(
    `${file.padEnd(34)} ${String(text.split('\n').length).padStart(4)} ${String(korean).padStart(7)} ${String(broken).padStart(8)} ${String(narrative).padStart(10)}`,
  );
  if (broken > 0) fail += 1;
}

console.log('\nREADME 링크 점검');
const readme = fs.readFileSync('README.md', 'utf8');
const links = [...readme.matchAll(/\]\(([^)\s]+)\)/g)]
  .map((m) => decodeURI(m[1]))
  .filter((p) => !p.startsWith('http'));
const unique = [...new Set(links)];
const missing = unique.filter((p) => !fs.existsSync(p));
for (const path of missing) console.log(`  없는 경로: ${path}`);
console.log(`  내부 링크 ${unique.length}개 / 깨진 링크 ${missing.length}개`);
fail += missing.length;

console.log(fail === 0 ? '\n이상 없음' : `\n확인 필요 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
