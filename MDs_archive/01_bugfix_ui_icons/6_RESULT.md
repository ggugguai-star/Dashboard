# 6_RESULT — 단계 6: [개선-6] UI.md 기반 디자인 향상 (모션·글래스·색상)

## §0 요약

마스터플랜 **단계 6 / 개선-6** 완료: `:root`에 `--ease-liquid`·`--dur-liquid`·`--glass-blur-ui` 추가, cat-panel·item 탄성 hover, 주요 버튼 그라디언트, blur 중첩 정리, toast liquid 진입, 10px↓ 폰트 11px+ 상향. **CSS-only**(`<style>`), JS/HTML 구조 무변경. `static_check` **PASS (exit 0)**.

## §1 변경된 파일 목록

- `src/index.html` — 수정 (`<style>` 블록만)
- `MDs/6_RESULT.md` — 신규 (본 문서, draft 완성 후 rename)

## §2 핵심 로직

- **모션:** `--ease-liquid`, `--dur-liquid`(350ms). `.cat-panel`·`.item` hover `translateY(-2px) scale(1.012)`; `.link-add-btn`·`.sp-apply-btn`·`.cep-save` hover `translateY(-1px)`.
- **그라디언트 버튼:** `linear-gradient(to right, #8b5cf6, #7c3aed)` + `color:#fff`.
- **Spatial Glass:** `.cat-panel` `box-shadow` + `inset 0 1px 0 rgba(255,255,255,0.25)`.
- **blur 표:**

| 처리 | 선택자 |
|------|--------|
| 유지·정규화 | `.topbar`, `.settings-overlay`, `.ctx`, `.icp-popup`, `.toast`, `#renamePopup` — 패널/모달 1겹 |
| 40→22px 축소 | `.setup-card`, `.settings-panel` |
| 20px 통일 | `.cat-panel`, `.toast` → `var(--glass-blur-ui)` |
| 중첩 제거 | `.gc`, `.cep-panel`, `.evd-panel`, `.icp-custom-menu` → `backdrop-filter:none` + 불투명도 상향 |
| 소형 유지 | `.scale-hint` blur(8px) |

- **toast:** `translateY(12px)` + opacity, `var(--dur-liquid) var(--ease-liquid)`.
- **폰트 11px+:** `.cp-sub`, `.item-tag`, `.cev-time`, `.db-crumb-sep`, `.db-folder .db-arr`, `.todo-chk::after`, `.gtask-badge`, `.note-tag .tag-del`, `.evd-csw::after`, `.alarm-card-type`.
- **접근성:** `@media (prefers-reduced-motion|transparency: reduce)` 블록 추가.
- **HEAD(검증 시점):** `25d07140f9c12d7613395f0427faf3c62f66cf88` (`25d0714 [auto-checkpoint] phase 5 passed`)

## §3 DoD 충족 근거

| 항목 | 결과 |
|------|------|
| **U1** | 충족 — `python3 scripts/static_check.py` → exit **0** |
| **U2** | 충족 — `:root` `--ease-liquid`, `--dur-liquid`, `--glass-blur-ui` |
| **U3** | 충족 — cat-panel·item hover scale(1.012) + liquid transition |
| **U4** | 충족 — link-add-btn·sp-apply-btn·cep-save 그라디언트 |
| **U5** | 충족 — §2 blur 표 |
| **U6** | 충족 — cat-panel inset rim |
| **U7** | 충족 — toast translateY+opacity liquid easing |
| **U8** | 충족 — §2 폰트 목록 |
| **U9** | 충족 — `<script>`·`buildCatPanels`·핸들러 무변경 |
| **U10** | 충족(코드) — 기능 로직 미변경. **수동 U7** 권장 |
| **U11** | 충족 — HEAD `25d0714` |
| **U12** | 충족 — 본 `MDs/6_RESULT.md` |
| **U13** | 충족 — §0 단계 6 / 개선-6 완료 |

**빌드/정적 게이트:** `python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증:** CSS-only — 드롭·스냅·링크·rename·드래그·우클릭 JS 경로 미변경.

## §4 실행/테스트 방법

```powershell
cd C:\AI\AiCoding\Dashboard
python scripts\static_check.py
npm run tauri:dev
```

**수동 U1~U8:** hover 모션·버튼 그라디언트·모달/토스트·소형 텍스트·기능 회귀.

## §5 정적 검증 결과

**PASS** — 종료 코드 **0**.

## §6 검수 포인트

- **미적용(범위 외):** Pretendard CDN·`:root` UI.md 전체 토큰 마이그레이션·다크모드.
- **item `will-change: transform`:** hover 성능용 — 패널 수 많을 때 메모리 소량 증가 가능.
- **미해결:** 개선-7 아이콘·CAT_ICON_SETS — 단계 7.
