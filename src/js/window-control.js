/* ════════════════════════════════════════════════════════════════
   창 제어 — app.js 에서 분리 (동작 100% 동일)
   snapToCurrentMonitor 는 export → app.js 가 import 해 window 전역 노출 블록에 포함.
   tInvoke 는 app.js 와 독립적으로 이 모듈 자체 1줄 헬퍼를 사용한다.
════════════════════════════════════════════════════════════════ */
const tInvoke = (cmd, args, opts) => window.__TAURI__.core.invoke(cmd, args, opts);

/* ════════════════════════════════════════════════════════════════
   창 제어 — 멀티모니터 스냅 + 이동 후 현재 모니터 워크에리어 핏
   원래 Electron 동작: 창을 드래그하면 해당 모니터 workArea 전체를 채운다.
   Tauri: tauri://move 이벤트 → 400ms 디바운스 → snapToCurrentMonitor()
════════════════════════════════════════════════════════════════ */

/** current_monitor → 작업 영역(Physical). workArea 우선, 없으면 screen.avail* × scaleFactor */
function monitorWorkArea(mon) {
  const wa = mon?.workArea;
  if (wa?.position && wa?.size?.width > 0 && wa?.size?.height > 0) {
    return { pos: wa.position, size: wa.size, source: 'workArea' };
  }
  const scale = mon?.scaleFactor || window.devicePixelRatio || 1;
  const s = window.screen;
  return {
    pos: { x: Math.round(s.availLeft * scale), y: Math.round(s.availTop * scale) },
    size: { width: Math.round(s.availWidth * scale), height: Math.round(s.availHeight * scale) },
    source: 'avail',
  };
}

/**
 * 현재 창이 위치한 모니터의 workArea 를 꽉 채우도록 창 크기·위치를 설정한다.
 * @param {boolean} [animate=false] - true 면 애니메이션 트랜지션 적용 (미사용)
 */
async function snapToCurrentMonitor() {
  try {
    const w = window.__TAURI__.window.getCurrentWindow();
    const mon = await tInvoke('plugin:window|current_monitor');
    if (!mon) return;
    const { pos, size, source } = monitorWorkArea(mon);
    if (!size?.width || !size?.height) return;
    await w.setPosition({ type: 'Physical', x: pos.x, y: pos.y });
    await w.setSize({ type: 'Physical', width: size.width, height: size.height });
    console.info('[WindowSnap]', source, size.width, '×', size.height, 'at', pos.x, pos.y);
  } catch (e) {
    console.warn('[WindowSnap]', e);
  }
}

/* 초기 스냅 — 앱 로드 완료 후 현재 모니터 workArea 에 맞춤 */
window.addEventListener('DOMContentLoaded', () => {
  snapToCurrentMonitor().catch(() => {});
}, { once: true });

/* 이동 후 스냅 — 드래그 완료 후 400ms 디바운스 */
(async () => {
  const win        = window.__TAURI__.window.getCurrentWindow();
  let   snapTimer  = null;
  let   isSnapping = false;

  win.listen('tauri://move', () => {
    if (isSnapping) return;
    clearTimeout(snapTimer);
    snapTimer = setTimeout(async () => {
      isSnapping = true;
      await snapToCurrentMonitor().catch(() => {});
      setTimeout(() => { isSnapping = false; }, 600);
    }, 400);
  });
})();

export { snapToCurrentMonitor };
