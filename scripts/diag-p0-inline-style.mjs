import { chromium } from 'playwright-core';
import { ensureCdpReady, cdpBaseUrl } from './cdp-utils.mjs';

const port = await ensureCdpReady();
const browser = await chromium.connectOverCDP(cdpBaseUrl(port));
const page = browser.contexts().flatMap(c => c.pages())[0];

const data = await page.evaluate(() => {
  const ids = [
    'cevCtxOverlay', 'cevCtxMenu', 'renameOverlay', 'renamePopup', 'icpOverlay',
    'drvCtxOverlay', 'drvCtxMenu', 'alarmMiniOverlay', 'drvMovePanel',
  ];
  return ids.map(id => {
    const el = document.getElementById(id);
    if (!el) return { id, missing: true };
    const s = getComputedStyle(el);
    return {
      id,
      attrStyle: el.getAttribute('style'),
      styleDisplay: el.style.display,
      computedDisplay: s.display,
      computedVisibility: s.visibility,
      computedPE: s.pointerEvents,
      zIndex: s.zIndex,
      blocks: s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none',
    };
  });
});

console.log(JSON.stringify(data, null, 2));
await browser.close();
