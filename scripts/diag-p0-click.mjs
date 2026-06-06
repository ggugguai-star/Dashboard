/**
 * P0 진단 Phase 1 보조 — 클릭 hit-test + btnNext 동작
 */
import { chromium } from 'playwright-core';
import http from 'http';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const list = await fetchJson('http://127.0.0.1:9222/json/list');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts().flatMap(c => c.pages())[0];

  const hitTest = await page.evaluate(() => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const el = document.elementFromPoint(cx, cy);
    const btn = document.getElementById('btnNext');
    const btnRect = btn?.getBoundingClientRect();
    const btnCenter = btnRect
      ? document.elementFromPoint(btnRect.left + btnRect.width / 2, btnRect.top + btnRect.height / 2)
      : null;
    return {
      centerPoint: { cx, cy },
      centerElement: el ? { tag: el.tagName, id: el.id, cls: (el.className || '').slice(0, 60) } : null,
      btnNextRect: btnRect ? { x: btnRect.x, y: btnRect.y, w: btnRect.width, h: btnRect.height } : null,
      btnNextHit: btnCenter ? { tag: btnCenter.tagName, id: btnCenter.id, cls: (btnCenter.className || '').slice(0, 60) } : null,
    };
  });

  console.log('========== HIT TEST ==========');
  console.log(JSON.stringify(hitTest, null, 2));

  // Direct JS call
  const beforeStep = await page.evaluate(() => ({
    setupStep: document.querySelector('.setup-step.active')?.dataset?.step
      ?? document.querySelector('.setup-step[style*="block"]')?.id
      ?? document.querySelector('.setup-panel.active')?.id
      ?? 'unknown',
    visibleSteps: [...document.querySelectorAll('.setup-step')].map(s => ({
      id: s.id,
      display: getComputedStyle(s).display,
      hidden: s.hidden,
    })),
    setupStepAttr: document.querySelector('[data-setup-step]')?.getAttribute('data-setup-step'),
    currentSetupVisible: document.getElementById('setupStep0')?.style.display
      ?? getComputedStyle(document.getElementById('setupStep0') || document.body).display,
  }));

  // Find setup step indicator
  const setupState = await page.evaluate(() => {
    const steps = document.querySelectorAll('.setup-step-content, .setup-body > div, .setup-panel');
    const active = document.querySelector('.setup-step-content:not([style*="display: none"])');
    const stepDots = document.querySelectorAll('.step-dot');
    return {
      stepDotCount: stepDots.length,
      activeDot: [...stepDots].findIndex(d => d.classList.contains('active')),
      setupStep0Display: document.getElementById('setupStep0') ? getComputedStyle(document.getElementById('setupStep0')).display : 'N/A',
      setupStep1Display: document.getElementById('setupStep1') ? getComputedStyle(document.getElementById('setupStep1')).display : 'N/A',
      setupStep2Display: document.getElementById('setupStep2') ? getComputedStyle(document.getElementById('setupStep2')).display : 'N/A',
    };
  });

  console.log('\n========== SETUP STATE (before click) ==========');
  console.log(JSON.stringify(setupState, null, 2));

  // Try programmatic click on btnNext
  let clickError = null;
  try {
    await page.click('#btnNext', { timeout: 3000 });
  } catch (e) {
    clickError = e.message;
  }

  await page.waitForTimeout(500);

  const afterClick = await page.evaluate(() => ({
    setupStep0Display: document.getElementById('setupStep0') ? getComputedStyle(document.getElementById('setupStep0')).display : 'N/A',
    setupStep1Display: document.getElementById('setupStep1') ? getComputedStyle(document.getElementById('setupStep1')).display : 'N/A',
    setupStep2Display: document.getElementById('setupStep2') ? getComputedStyle(document.getElementById('setupStep2')).display : 'N/A',
    stepDots: [...document.querySelectorAll('.step-dot')].map((d, i) => ({ i, active: d.classList.contains('active') })),
  }));

  console.log('\n========== PLAYWRIGHT CLICK #btnNext ==========');
  console.log('clickError:', clickError || 'none');
  console.log('after:', JSON.stringify(afterClick, null, 2));

  // Direct invoke nextSetupStep()
  await page.evaluate(() => {
    if (typeof window.nextSetupStep === 'function') window.nextSetupStep();
  });
  await page.waitForTimeout(500);

  const afterDirect = await page.evaluate(() => ({
    setupStep0Display: document.getElementById('setupStep0') ? getComputedStyle(document.getElementById('setupStep0')).display : 'N/A',
    setupStep1Display: document.getElementById('setupStep1') ? getComputedStyle(document.getElementById('setupStep1')).display : 'N/A',
    setupStep2Display: document.getElementById('setupStep2') ? getComputedStyle(document.getElementById('setupStep2')).display : 'N/A',
    stepDots: [...document.querySelectorAll('.step-dot')].map((d, i) => ({ i, active: d.classList.contains('active') })),
  }));

  console.log('\n========== DIRECT nextSetupStep() ==========');
  console.log(JSON.stringify(afterDirect, null, 2));

  // Overlay pointer-events probe: temporarily disable and retest hit
  const overlayProbe = await page.evaluate(() => {
    const ids = ['settingsOverlay', 'alarmOverlay', 'evDialog', 'drvMoveOverlay', 'catEditPopup'];
    const before = document.getElementById('btnNext');
    const rect = before?.getBoundingClientRect();
    const hitBefore = rect
      ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : null;

    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.pointerEvents = 'none';
    });

    const hitAfter = rect
      ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : null;

    return {
      hitBefore: hitBefore ? { tag: hitBefore.tagName, id: hitBefore.id } : null,
      hitAfter: hitAfter ? { tag: hitAfter.tagName, id: hitAfter.id } : null,
      overlayBlocksClick: hitBefore?.id !== 'btnNext' && hitAfter?.id === 'btnNext',
    };
  });

  console.log('\n========== OVERLAY POINTER-EVENTS PROBE ==========');
  console.log(JSON.stringify(overlayProbe, null, 2));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
