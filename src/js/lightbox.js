/* ════════════════════════════════════════
   이미지 라이트박스
════════════════════════════════════════ */

let _getFiles = () => ({});
let _getIdx = () => ({});
let _showDriveImage = async () => {};
/* app.js 가 호출: 공유 상태(Drive)를 getter 로 주입 → 재할당돼도 항상 최신값 */
export function initLightbox({ getFiles, getIdx, showDriveImage } = {}) {
  if (getFiles) _getFiles = getFiles;
  if (getIdx) _getIdx = getIdx;
  if (showDriveImage) _showDriveImage = showDriveImage;
}

var _lbType = null;

function toggleDriveZoom(imgEl){
  if(document.getElementById('imgLightbox')){ closeImgZoom(); return; }
  // imgEl id → 'driveImg_weekly' or 'driveImg_memo'
  const m = imgEl.id?.match(/driveImg_(\w+)/);
  _lbType = m ? m[1] : null;
  openImgZoom(imgEl);
}

function openImgZoom(imgEl){
  closeImgZoom(); // 기존 것 정리

  const overlay = document.createElement('div');
  overlay.className = 'img-lightbox';
  overlay.id = 'imgLightbox';
  overlay.onclick = (e) => { if(e.target === overlay) closeImgZoom(); };

  const img = document.createElement('img');
  img.className = 'img-lightbox-img';
  img.src = imgEl.src;
  img.onclick = e => e.stopPropagation();
  overlay.appendChild(img);

  // 닫기 버튼
  const closeBtn = document.createElement('div');
  closeBtn.className = 'img-lightbox-close';
  closeBtn.innerHTML = '✕';
  closeBtn.onclick = closeImgZoom;
  overlay.appendChild(closeBtn);

  // 여러 장이면 이전/다음 버튼 + 카운터
  if(_lbType && (_getFiles()[_lbType]?.length||0) > 1){
    const prev = document.createElement('div');
    prev.className = 'img-lightbox-nav img-lightbox-prev';
    prev.innerHTML = '‹';
    prev.onclick = e => { e.stopPropagation(); lbNav(-1); };

    const next = document.createElement('div');
    next.className = 'img-lightbox-nav img-lightbox-next';
    next.innerHTML = '›';
    next.onclick = e => { e.stopPropagation(); lbNav(1); };

    const counter = document.createElement('div');
    counter.className = 'img-lightbox-counter';
    counter.id = 'lbCounter';
    const ci = _getIdx()[_lbType] ?? 0;
    counter.textContent = `${ci+1} / ${_getFiles()[_lbType].length}`;

    overlay.appendChild(prev);
    overlay.appendChild(next);
    overlay.appendChild(counter);
  }

  document.body.appendChild(overlay);
}

async function lbNav(dir){
  if(!_lbType) return;
  const files = _getFiles()[_lbType] || [];
  const newIdx = Math.max(0, Math.min((_getIdx()[_lbType]??0) + dir, files.length-1));
  await _showDriveImage(_lbType, newIdx);
  // 라이트박스 이미지 갱신
  const mainImg = document.getElementById(`driveImg_${_lbType}`);
  const lbImg   = document.querySelector('.img-lightbox-img');
  if(lbImg && mainImg) lbImg.src = mainImg.src;
  const counter = document.getElementById('lbCounter');
  if(counter) counter.textContent = `${newIdx+1} / ${files.length}`;
}

function closeImgZoom(){
  const lb = document.getElementById('imgLightbox');
  if(lb) lb.remove();
  _lbType = null;
}

/* ESC 닫기 */
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') closeImgZoom();
});

/* HTML 인라인 onclick 이 참조하므로 window 전역 노출 */
Object.assign(window, { toggleDriveZoom, closeImgZoom });

/* app.js 가 이미지 클릭 바인딩에 사용 */
export { toggleDriveZoom };
