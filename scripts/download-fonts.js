/**
 * Google Fonts를 로컬로 다운로드합니다.
 * npm install 시 postinstall로 자동 실행됩니다.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const FONTS_DIR = path.join(__dirname, '..', 'src', 'fonts');
const FONTS_CSS  = path.join(FONTS_DIR, 'fonts.css');
const GOOGLE_URL =
  'https://fonts.googleapis.com/css2' +
  '?family=Bricolage+Grotesque:opsz,wght@12..96,400..800' +
  '&family=JetBrains+Mono:wght@400;500' +
  '&display=swap';
const PRETENDARD_URL =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// 이미 다운로드됐으면 스킵
if (fs.existsSync(FONTS_CSS)) {
  console.log('[fonts] 이미 다운로드됨, 스킵합니다.');
  process.exit(0);
}

fs.mkdirSync(FONTS_DIR, { recursive: true });

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': UA, ...headers } }, (res) => {
        // 리다이렉트 처리
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, headers).then(resolve).catch(reject);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function main() {
  console.log('[fonts] Google Fonts CSS 다운로드 중...');
  const cssBuf = await get(GOOGLE_URL);
  let css = cssBuf.toString('utf8');

  // woff2 URL 추출
  const matches = [...css.matchAll(/url\((https:\/\/[^)]+\.woff2[^)]*)\)/g)];
  console.log(`[fonts] 폰트 파일 ${matches.length}개 발견`);

  let idx = 0;
  for (const m of matches) {
    const fontUrl = m[1];
    const filename = `f${String(idx).padStart(3, '0')}.woff2`;
    const dest = path.join(FONTS_DIR, filename);
    const buf = await get(fontUrl);
    fs.writeFileSync(dest, buf);
    css = css.replace(fontUrl, `./${filename}`);
    process.stdout.write(`\r[fonts] ${++idx}/${matches.length} 다운로드 완료`);
  }
  console.log('\n[fonts] fonts.css 저장 중...');
  const header =
    `/* UI.md §2 — Bricolage Grotesque + JetBrains Mono (로컬) */\n` +
    `@import url('${PRETENDARD_URL}');\n`;
  fs.writeFileSync(FONTS_CSS, header + css, 'utf8');
  console.log('[fonts] ✅ 완료!');
}

main().catch((err) => {
  console.warn('\n[fonts] ⚠️  다운로드 실패:', err.message);
  console.warn('[fonts] 온라인 CDN 폴백을 사용합니다.');
  fs.writeFileSync(
    FONTS_CSS,
    `/* UI.md §2 — CDN 폴백 */\n` +
      `@import url('${PRETENDARD_URL}');\n` +
      `@import url('${GOOGLE_URL}');\n`,
    'utf8'
  );
});
