/**
 * 앱 아이콘 생성 스크립트
 * Google Workspace 스타일: 둥근 모서리 + 보라 그라데이션 + 대시보드 패널
 */
const sharp  = require('sharp');
const toIco  = require('to-ico');
const path   = require('path');
const fs     = require('fs');

/* ── 아이콘 SVG 디자인 ── */
function makeSvg(size) {
  const r   = Math.round(size * 0.22);   // 모서리 둥글기
  const pad = Math.round(size * 0.13);   // 내부 여백
  const gap = Math.round(size * 0.05);   // 패널 간격
  const inner = size - pad * 2;

  // 4분할 패널 좌표
  const half  = (inner - gap) / 2;
  const x1 = pad, y1 = pad;
  const x2 = pad + half + gap, y2 = pad;
  const x3 = pad, y3 = pad + half + gap;
  const x4 = pad + half + gap, y4 = pad + half + gap;
  const pr = Math.round(size * 0.055);  // 패널 모서리

  // 큰 패널(좌상·우하), 작은 패널(우상·좌하) → 구글 캘린더 느낌
  const bigW  = half;
  const bigH  = Math.round(half * 1.12);
  const smallW = half;
  const smallH = inner - bigH - gap;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <!-- 배경 그라디언트: 라벤더 → 인디고 -->
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#a78bfa"/>
      <stop offset="55%"  stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <!-- 패널 화이트 그라디언트 -->
    <linearGradient id="p1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.98"/>
      <stop offset="100%" stop-color="#f0f4ff" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="p2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="#e0e7ff" stop-opacity="0.65"/>
    </linearGradient>
    <!-- 그림자 필터 -->
    <filter id="sh" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="${Math.round(size*0.012)}" stdDeviation="${Math.round(size*0.018)}" flood-color="#4338ca" flood-opacity="0.22"/>
    </filter>
  </defs>

  <!-- 배경 -->
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>

  <!-- 내부 광택 하이라이트 -->
  <rect x="0" y="0" width="${size}" height="${Math.round(size*0.5)}" rx="${r}"
        fill="url(#p1)" opacity="0.10"/>

  <!-- 패널 1: 좌상 (크게) -->
  <rect x="${x1}" y="${y1}" width="${bigW}" height="${bigH}" rx="${pr}"
        fill="url(#p1)" filter="url(#sh)"/>

  <!-- 패널 2: 우상 (작게) -->
  <rect x="${x2}" y="${y2}" width="${smallW}" height="${smallH}" rx="${pr}"
        fill="url(#p2)" filter="url(#sh)"/>

  <!-- 패널 3: 좌하 (작게) -->
  <rect x="${x3}" y="${y3}" width="${smallW}" height="${smallH}" rx="${pr}"
        fill="url(#p2)" filter="url(#sh)"/>

  <!-- 패널 4: 우하 (크게) -->
  <rect x="${x4}" y="${y4}" width="${bigW}" height="${bigH}" rx="${pr}"
        fill="url(#p1)" filter="url(#sh)"/>

  <!-- 패널 1 내부 — 가로선 3개 (목록/메모 느낌) -->
  ${[0.28,0.44,0.60].map(t => {
    const lx = x1 + Math.round(bigW*0.16);
    const ly = y1 + Math.round(bigH*t);
    const lw = Math.round(bigW*0.60);
    const lh = Math.round(size*0.035);
    const lr = Math.round(lh/2);
    const op = t === 0.28 ? '0.55' : '0.32';
    return `<rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="${lr}" fill="#818cf8" opacity="${op}"/>`;
  }).join('\n  ')}

  <!-- 패널 4 내부 — 체크마크 + 작은 선 -->
  ${(() => {
    const cx = x4 + Math.round(bigW*0.22);
    const cy = y4 + Math.round(bigH*0.34);
    const cr = Math.round(size*0.038);
    const lx2 = cx + cr*2 + Math.round(size*0.02);
    const lw2 = Math.round(bigW*0.38);
    const lh2 = Math.round(size*0.032);
    return `<circle cx="${cx}" cy="${cy}" r="${cr}" fill="#818cf8" opacity="0.55"/>
  <rect x="${lx2}" y="${cy - Math.round(lh2/2)}" width="${lw2}" height="${lh2}" rx="${Math.round(lh2/2)}" fill="#818cf8" opacity="0.32"/>
  <circle cx="${cx}" cy="${cy + Math.round(bigH*0.28)}" r="${cr}" fill="#818cf8" opacity="0.38"/>
  <rect x="${lx2}" y="${cy + Math.round(bigH*0.28) - Math.round(lh2/2)}" width="${Math.round(lw2*0.7)}" height="${lh2}" rx="${Math.round(lh2/2)}" fill="#818cf8" opacity="0.22"/>`;
  })()}
</svg>`;
}

async function generate() {
  const outDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBuffers = [];

  console.log('🎨 아이콘 생성 중...');
  for (const sz of sizes) {
    const svg = makeSvg(sz);
    const buf = await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9 })
      .toBuffer();
    pngBuffers.push({ size: sz, buf });
    console.log(`  ✓ ${sz}x${sz}`);
  }

  // 512px PNG 저장 (필요 시)
  const svg512 = makeSvg(512);
  const png512 = await sharp(Buffer.from(svg512)).png().toBuffer();
  fs.writeFileSync(path.join(outDir, 'icon.png'), png512);
  console.log('  ✓ icon.png (512x512)');

  // ICO 생성 (16, 32, 48, 64, 128, 256)
  const icoSizes  = [16, 32, 48, 64, 128, 256];
  const icoBufs   = pngBuffers.filter(p => icoSizes.includes(p.size)).map(p => p.buf);
  const icoBuf    = await toIco(icoBufs);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), icoBuf);
  console.log('  ✓ icon.ico');

  console.log('\n✅ 완료! assets/icon.ico + assets/icon.png 생성됨');
}

generate().catch(e => { console.error('❌ 오류:', e.message); process.exit(1); });
