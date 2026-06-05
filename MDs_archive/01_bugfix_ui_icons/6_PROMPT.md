# 6_PROMPT — 작업 지시서 #6: [개선-6] UI.md 기반 디자인 향상 (모션·글래스·색상)

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 6  
> **모드:** R&D (기존 Tauri v2 앱 개선)  
> **상위 문서:** [`0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「개선-6」  
> **선행 완료:** [`5_RESULT.md`](5_RESULT.md) — 개선-4 PASS  
> **작성일:** 2026-06-04  
> **범위:** 마스터플랜 **단계 6** — 개선-6만. 개선 7·단계 8 **착수 금지**

---

## 1. 목표 (무엇을)

[`UI.md`](../UI.md) §1·§4·§5·§6을 기준으로 **CSS만** 조정해 Liquid Glass·탄성 hover·blur 정리·주요 버튼 그라디언트·토스트/팝업 진입 모션·가독성(폰트)을 맞춘다. **HTML 구조·JS 로직은 변경하지 않는다.**

**한 문장:**  
> `:root`에 `--ease-liquid`를 추가하고, cat-panel·item·주요 버튼 hover 모션을 통일하며 중첩 `backdrop-filter`를 줄이고 UI.md glass 레시피에 맞게 시각 품질을 올린다.

---

## 2. 이유 (왜)

| 근거 | 설명 |
|------|------|
| 개선-6 진단 | `src/index.html` `<style>` — `backdrop-filter: blur(40px)` 등 **다층 중첩**, transition `.15s ease` 위주, `.item:hover`는 배경색만 |
| 5단계 RESULT §6 | UI.md·아이콘 확충 **미해결·단계 6·7 대상** |
| 마스터플랜 DoD | 「hover 탄성 애니메이션 / blur 정리 / 버튼 그라디언트 적용」 |
| UI.md §6 | `--ease-spring` = `cubic-bezier(0.34, 1.56, 0.64, 1)` — 마스터플랜 명칭 `--ease-liquid`와 **동일 곡선** |
| 회귀 리스크 | 레이아웃·이벤트·데이터 로직 무변경 — **시각만** 변경, 기능 회귀 최소 |

**현황 앵커 (grep 기준):**

```text
:root L12~34          — glass 토큰 있음, --ease-liquid 없음
.cat-panel L787~844   — blur(18px), hover translateY(-2px)만, transition .2s
.item / .item:hover L875~880 — transform 없음
.link-add-btn L923~929       — 단색 파스텔, 그라디언트 없음
.toast L1247~1255           — translateY 진입 있음 → easing·duration 정합
backdrop-filter 30+ 곳      — blur(40px) 과다(setup-card L116, settings-panel L1277 등)
font-size 9~10px 다수       — cp-sub, item-tag, cev-time 등
```

---

## 3. 접근 (어떻게)

### Phase A — 컨텍스트 로드 (코드 수정 전)

1. [`AGENTS.md`](../AGENTS.md) — 최소·국소 변경
2. [`UI.md`](../UI.md) §1·§4·§5·§6·§7(`prefers-reduced-motion` 존중)
3. [`MDs/0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「개선-6」
4. [`src/index.html`](../src/index.html) — `<style>` 블록만 집중 (리포맷 금지)
5. [`5_RESULT.md`](5_RESULT.md) — 기능 회귀 기준

### Phase B — 설계 (구현 전 결정)

#### B-1. `:root` 변수

| 변수 | 값 |
|------|-----|
| `--ease-liquid` | `cubic-bezier(0.34, 1.56, 0.64, 1)` (UI.md `--ease-spring` 동일) |
| `--dur-liquid` | `350ms` (마스터플랜 hover 권장) |
| (선택) `--glass-blur-ui` | `20px` — UI.md `--glass-blur` 정렬용 |

#### B-2. hover·transition (필수 대상)

| 선택자 | 변경 |
|--------|------|
| `.cat-panel` | `transition` → `transform, box-shadow` **350ms var(--ease-liquid)**; hover `translateY(-2px) scale(1.012)` (기존 -2px 유지·scale 추가) |
| `.item` | hover `transform: translateY(-2px) scale(1.012)` + 배경 유지; transition에 transform 포함 |
| `.link-add-btn`, `.sp-apply-btn`, `.cep-save` | 배경 `linear-gradient(to right, #8b5cf6, #7c3aed)`, `color: #fff`; hover `translateY(-1px)` + `--ease-liquid` |
| `.cp-icon`, `.cp-dbtn`(미사용이어도 유지), `.tb-btn` | hover transform·easing **선택적** 통일(과도 확대 금지) |

#### B-3. blur 정리 (중첩 제거 — 표준)

| 유지 (상위 뎁스) | 조정/제거 (중첩·과다) |
|------------------|----------------------|
| `.topbar` | `.cat-panel` 내부 **추가 blur 금지** — 패널 자체 1회만 (`blur(18~20px)` 수준 유지 또는 `--glass-blur-ui`) |
| `.settings-overlay`, `.settings-panel` | `.setup-card` `blur(40px)` → **≤22px** |
| `#ctx`, `#renamePopup`, `.icp-overlay` 등 모달·팝업 | `.item`, `.cp-body`, `.cp-drop`, `.link-input-row` 등 **blur 제거** |
| `.toast` | 1회 blur 유지, **≤20px** |
| — | `.scale-hint` 등 소형 UI는 유지 가능 |

> 원칙: **같은 시각 영역에 blur 2겹 이상 쌓지 않음.** 제거 시 `backdrop-filter: none` + 기존 `background` 불투명도로 가독성 보완.

#### B-4. Spatial Glass (cat-panel rim)

- `.cat-panel` `border` 상단/전체: 상단 하이라이트 `rgba(255,255,255,0.25)` 느낌 — `border-top` 또는 `box-shadow: inset 0 1px 0 rgba(255,255,255,0.25)` (기존 `::before` 그라디언트와 **중복 최소화**)

#### B-5. 토스트·팝업 진입

| 대상 | 변경 |
|------|------|
| `.toast` | hidden `translateY(12px) opacity:0` → `.show` `translateY(0) opacity:1`, **350ms var(--ease-liquid)** |
| `.settings-panel` / `#renamePopup` | 기존 transform 진입에 `--ease-liquid` 적용(구조 변경 없음) |
| `@keyframes panelIn` | (선택) easing만 `var(--ease-liquid)` 근사 — **필수 아님** |

#### B-6. 폰트 가독성 (10px 이하 → 11px+)

**본 단계에서 상향할 대표 클래스** (grep 확인 후 누락 없이):

- `.cp-sub` (9.5px → 11px)
- `.item-tag` (9.5px → 11px)
- `.cev-time`, `.db-crumb-sep`, `.db-folder .db-arr` 등 **10px** → **11px**
- 체크박스 pseudo `font-size: 9px` → **11px**

> 11.5px·12px는 유지. **전역 `html{font-size}` 변경 금지.**

#### B-7. 금지·범위 밖

- HTML 구조·`buildCatPanels`·이벤트 핸들러 **변경 없음**
- `ITEM_ICON_SETS` / `CAT_ICONS` / `catEditPopup` — **단계 7**
- 다크모드·폰트 CDN 교체·`UI.md` 전면 토큰 마이그레이션 — **범위 외**
- `prefers-color-scheme: dark` 추가 **금지** (UI.md)

### Phase C — 구현 체크리스트

1. `:root`에 `--ease-liquid`, `--dur-liquid` 추가
2. cat-panel·item·link-add-btn·sp-apply-btn·cep-save hover/transition 적용
3. blur 표(B-3)대로 중첩 제거·과다 blur 축소
4. cat-panel rim·toast 진입 모션
5. 10px 이하 font 상향(B-6)
6. `@media (prefers-reduced-motion: reduce)` — UI.md §7 패턴 **없으면 추가**(최소 블록)

### Phase D — 1차 정적 검증 (필수)

```powershell
cd C:\AI\AiCoding\Dashboard
python scripts/static_check.py
```

- exit **0** → PASS

### Phase E — 수동 기능 검증 (필수)

```powershell
npm run tauri:dev
```

| 시나리오 | 기대 |
|----------|------|
| **U1** cat-panel·item hover | `translateY` + `scale(1.012)` 탄성 모션, 끊김 없음 |
| **U2** 링크 `✓ 추가`·설정 `✓ 적용`·카테고리 편집 `저장` | 보라 그라디언트·흰 텍스트 |
| **U3** 설정 모달·rename 팝업 열기 | 부드러운 슬라이드/스케일 인, blur 과다 없음 |
| **U4** 토스트 1회 표시 | 슬라이드 인 + 가독성 |
| **U5** 스크롤·다패널 동시 표시 | 중첩 blur 제거로 **프레임 드랍 체감 감소**(주관) |
| **U6** cp-sub·item-tag 등 소형 텍스트 | **11px 이상**, 잘림 없음 |
| **U7** 링크 폼·더블클릭 rename·파일 드롭·스냅 | 개선 3~5·BUG 1~2 **기능 회귀 없음** |
| **U8** DevTools Console | 치명적(빨간) 에러 **0건** |

### Phase F — RESULT 작성

1. `MDs/6_RESULT_draft.md` (§0~§6)
2. 완성 후 `MDs/6_RESULT.md`로 **rename**
3. PASS 전 **단계 7 PROMPT/구현 착수 금지**

---

## 4. Definition of Done (검증 가능 체크리스트)

- [ ] **U1** `python scripts/static_check.py` → exit **0**, `RESULT: PASS`
- [ ] **U2** `:root`에 `--ease-liquid`(및 `--dur-liquid`) 정의
- [ ] **U3** `.cat-panel`·`.item` hover에 `scale(1.012)` + `350ms var(--ease-liquid)`
- [ ] **U4** `.link-add-btn`·`.sp-apply-btn`·`.cep-save` 그라디언트 `#8b5cf6`→`#7c3aed` + 흰 텍스트
- [ ] **U5** blur 중첩 제거 — RESULT §2에 **유지/제거/축소 선택자 목록** 표
- [ ] **U6** `.cat-panel` Spatial Glass rim 적용(§B-4)
- [ ] **U7** `.toast` 진입 `translateY`+`opacity` + liquid easing
- [ ] **U8** 10px 이하 → 11px+ 상향 클래스 목록 §2·§6
- [ ] **U9** HTML 구조·JS 핸들러 **무변경**(CSS-only)
- [ ] **U10** 기능 회귀 없음(U7 수동)
- [ ] **U11** `git rev-parse HEAD`·`git log -1 --oneline` RESULT §4
- [ ] **U12** `MDs/6_RESULT.md` 존재, DoD 항목별 §3 근거
- [ ] **U13** 마스터플랜 「단계 6 / 개선-6」완료 한 줄 §0

**빌드/정적 게이트:**  
`python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증 (R&D 필수 한 줄):**  
CSS-only 변경 후 **파일 드롭·workArea 스냅·링크 폼·dblclick rename·드래그·우클릭·열기** 기능 동일.

---

## 5. 영향 받는 파일 / 모듈 범위

| 구분 | 경로 | 본 단계 |
|------|------|---------|
| **주요 수정** | `src/index.html` | `<style>` 블록 (`:root`, cat-panel, item, toast, 버튼, blur·font) |
| **수정 금지** | `src/index.html` `<script>` | 이벤트·데이터·`buildCatPanels` 로직 |
| **수정 금지** | `ITEM_ICON_SETS`, `CAT_ICONS`, `catEditPopup` 렌더 | 단계 7 |
| **수정 금지** | `src-tauri/**`, `tauri.conf.json` | 범위 외 |
| **수정 금지** | `agent_orchestrator.py`, `scripts/static_check.py` | 유지 |
| **참조만** | [`UI.md`](../UI.md) | 토큰·모션 기준 |
| **산출 문서** | `MDs/6_RESULT_draft.md` → `MDs/6_RESULT.md` | 필수 |

---

## 6. static_check FAIL 시에만 허용되는 최소 수정

1. stderr **맨 끝** `blocking_failures`만 대응  
2. 개선-6·회귀와 **무관한 리팩터링 금지**  
3. 수정 후 `python scripts/static_check.py` 재실행 → PASS  
4. RESULT §1·§2에 기록  

---

## 7. 작업 규칙 (위반 금지)

1. **단계 7~8 구현·PROMPT 작성 착수 금지**
2. **CSS-only** — DOM 구조·id/class 의미 변경 최소
3. **`src/index.html` 무분별 리포맷·`<script>` 대량 수정 금지**
4. **아이콘 데이터·피커 탭화 금지** — 단계 7
5. **capabilities 와일드카드 확대 금지**
6. **`git commit`은 사용자 요청 시에만**
7. **placeholder(`// TODO`) 금지**
8. **`Final.md` 작성 금지** — **단계 8** 완료 후에만

---

## 8. RESULT 문서 요구 (요약)

| 절 | 내용 |
|----|------|
| §0 | 개선-6 해결 여부 한 줄 |
| §1 | 변경 파일 경로만 |
| §2 | 변수·hover·blur 표·font·toast 2~8줄 (코드 복붙 금지) |
| §3 | DoD U1~U13 항목별 충족 근거 |
| §4 | static_check·`tauri:dev` U1~U8 |
| §5 | static_check PASS/FAIL |
| §6 | blur trade-off·미적용 UI.md 항목(폰트 CDN 등), 미해결 개선 7 |

---

## 9. 다음 작업 예고 (#7)

PASS 후 [`MDs/7_PROMPT.md`](7_PROMPT.md) (별도 작성):

- **단계 7** — [개선-7] 아이콘 확충 및 카테고리 피커 개선 (`ITEM_ICON_SETS`, `CAT_ICON_SETS`)

**최종 단계 안내:** 마스터플랜 **단계 8**(회귀 검증 + git 체크포인트) PASS 후에만 [`MDs/Final.md`](Final.md) 작성.

---

## 10. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-04 | 5단계 PASS 후 개선-6 지시서 초안 |
