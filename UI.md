# UI.md — 디자인 시스템 (Liquid Glass · Light · Pastel)

> 이 문서는 **모든 프론트엔드/UI 작업의 절대 기준**이다. 여기 정의된 토큰·재질·폰트·모션을
> 100% 준수해 렌더링한다. 임의의 색/폰트/그림자/다크모드를 새로 만들지 않는다.
> 대상 스택: **Tauri v2 웹 프론트엔드(HTML/CSS/TS)**.

## 0. 디자인 철학
- **Apple "Liquid Glass" 미학을 웹으로 옮긴다.** UI 컨트롤은 *물리적 유리판*처럼 행동한다 —
  반투명하고, 뒤 배경을 흐리고/채도를 올려 비추며, 가장자리에 빛(스페큘러)이 맺히고,
  부드럽게 떠 있는 듯한 깊이를 가진다. 단, 장식이 아니라 **위계와 집중**을 위한 재질로 쓴다.
- **테마는 라이트(밝은 톤) 전용. 다크모드는 만들지 않는다.** (`prefers-color-scheme: dark` 스타일 금지)
- **파스텔 + 따뜻한 오프화이트** 기반. 멀티 색조의 부드러운 그라데이션 메시 위에 유리 패널이 뜬다.
- 콘텐츠가 주인공, 컨트롤은 시각적으로 물러난다. 그래도 **텍스트 가독성(대비)** 은 절대 희생하지 않는다.
- 클리셰 회피: "보라색 그라데이션 on 화이트" 같은 뻔한 조합을 그대로 쓰지 않는다. 아래 멀티톤 팔레트를 사용한다.

## 1. 컬러 토큰 (CSS 변수)
라이트·파스텔 팔레트. 배경은 따뜻한 오프화이트 + 파스텔 블롭, 텍스트는 깊은 인디고-차콜로 대비 확보.

```css
:root {
  /* 베이스 (따뜻한 오프화이트) */
  --bg-base:        #F6F5FB;
  --bg-elevated:    #FFFFFF;

  /* 파스텔 액센트 (배경 메시 블롭 / 태그 / 일러스트용) */
  --pastel-lavender:#E9E3FF;
  --pastel-mint:    #D9F5E6;
  --pastel-peach:   #FFE7DC;
  --pastel-sky:     #DCEEFF;
  --pastel-blush:   #FFE1EC;
  --pastel-butter:  #FFF3D6;

  /* 브랜드/프라이머리 (파스텔이되 대비 확보된 소프트 인디고) */
  --primary:        #6E5BF2;
  --primary-press:  #5A48D6;
  --primary-soft:   #ECE8FF;   /* 프라이머리의 연한 배경 */
  --accent-coral:   #FF8A6B;   /* 포인트(드물게) */

  /* 텍스트 (대비 우선) */
  --text-strong:    #1B1A2E;   /* 제목/주요 텍스트 */
  --text:           #3A3850;   /* 본문 */
  --text-muted:     #6B6980;   /* 보조 */
  --text-on-primary:#FFFFFF;

  /* 유리 재질 (Liquid Glass) */
  --glass-fill:     rgba(255, 255, 255, 0.55);
  --glass-fill-strong: rgba(255, 255, 255, 0.72);
  --glass-stroke:   rgba(255, 255, 255, 0.65);
  --glass-stroke-bottom: rgba(150, 140, 190, 0.18);
  --glass-highlight:rgba(255, 255, 255, 0.85);  /* 상단 스페큘러 */
  --glass-blur:     20px;
  --glass-saturate: 180%;

  /* 그림자 (떠 있는 깊이) */
  --shadow-sm:  0 2px 8px rgba(40, 35, 90, 0.06);
  --shadow-md:  0 8px 28px rgba(40, 35, 90, 0.10);
  --shadow-lg:  0 20px 56px rgba(40, 35, 90, 0.14);

  /* 상태색 (파스텔 톤) */
  --success: #34C77B;
  --warning: #F7B955;
  --danger:  #F26D6D;
  --info:    #5AA9F2;
}
```

> 대비 규칙: 본문 텍스트는 반드시 `--text` 이상으로 어둡게. 유리 패널 위 텍스트는 흐림 때문에
> 대비가 떨어질 수 있으니, 텍스트 뒤에는 `--glass-fill-strong`(더 불투명) 표면을 쓴다.

## 2. 타이포그래피
- **본문/UI: `Pretendard`** — 한글·라틴 모두 깔끔한 모던 산세리프(가독성·한국어 최적). 제너릭한 Inter/Roboto 대신 사용.
- **디스플레이/큰 제목: `Bricolage Grotesque`** — 개성 있는 현대 그로테스크(힙한 헤드라인용).
- **모노(코드/숫자): `JetBrains Mono`**.

```html
<!-- <head> 에 폰트 로드 -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

```css
:root {
  --font-display: "Bricolage Grotesque", "Pretendard Variable", sans-serif;
  --font-sans:    "Pretendard Variable", Pretendard, system-ui, sans-serif;
  --font-mono:    "JetBrains Mono", ui-monospace, monospace;

  /* 타입 스케일 (1.250 Major Third) */
  --text-xs:  0.75rem;   /* 12 */
  --text-sm:  0.875rem;  /* 14 */
  --text-md:  1rem;      /* 16 본문 기본 */
  --text-lg:  1.25rem;   /* 20 */
  --text-xl:  1.563rem;  /* 25 */
  --text-2xl: 1.953rem;  /* 31 */
  --text-3xl: 2.441rem;  /* 39 디스플레이 */

  --leading-tight: 1.2;
  --leading-normal: 1.55;
  --tracking-tight: -0.02em;  /* 디스플레이 제목엔 약간의 음수 자간 */
}
body { font-family: var(--font-sans); font-size: var(--text-md);
       line-height: var(--leading-normal); color: var(--text);
       -webkit-font-smoothing: antialiased; }
h1, h2, .display { font-family: var(--font-display); font-weight: 700;
       letter-spacing: var(--tracking-tight); color: var(--text-strong);
       line-height: var(--leading-tight); }
```

## 3. 형태 토큰 (반경 · 간격)
```css
:root {
  /* 큰 연속곡률(스쿼클 느낌)의 라운드가 Liquid Glass의 핵심 */
  --radius-sm: 12px;
  --radius-md: 18px;
  --radius-lg: 24px;
  --radius-xl: 32px;
  --radius-pill: 999px;

  /* 8pt 간격 스케일 */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
}
```

## 4. Liquid Glass 재질 레시피 (핵심)
유리 패널의 표준 구현. `backdrop-filter` 의 blur+saturate 로 굴절감을, 상단 하이라이트로 스페큘러를,
내부/외부 그림자로 깊이를 만든다. (진짜 광학 굴절(lensing)은 SVG/WebGL이 필요하지만, 웹 표준은 이 CSS 근사를 사용한다.)

```css
.glass {
  position: relative;
  background: linear-gradient(135deg, var(--glass-fill-strong), var(--glass-fill));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-stroke);
  border-bottom-color: var(--glass-stroke-bottom);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md), inset 0 1px 0 var(--glass-highlight);
  overflow: hidden;
}
/* 상단 스페큘러 하이라이트(유리에 맺힌 빛) */
.glass::before {
  content: "";
  position: absolute; inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0) 42%);
  pointer-events: none;
}
/* 배경: 파스텔 그라데이션 메시 (유리가 비출 대상) */
body {
  background:
    radial-gradient(40rem 40rem at 12% 8%,  var(--pastel-lavender), transparent 60%),
    radial-gradient(36rem 36rem at 88% 12%, var(--pastel-sky),      transparent 60%),
    radial-gradient(34rem 34rem at 78% 88%, var(--pastel-peach),    transparent 60%),
    radial-gradient(30rem 30rem at 18% 92%, var(--pastel-mint),     transparent 60%),
    var(--bg-base);
  background-attachment: fixed;
}
```

## 5. 컴포넌트 패턴
- **카드/패널**: `.glass` + `padding: var(--space-5)`. 떠 있는 느낌은 `--shadow-md`~`lg`.
- **버튼(프라이머리)**: 솔리드 `--primary`, 텍스트 `--text-on-primary`, `border-radius: var(--radius-pill)`,
  hover 시 살짝 떠오르기(`translateY(-1px)` + `--shadow-md`), press 시 `--primary-press`.
- **버튼(글래스)**: `.glass` + `--radius-pill`, 텍스트 `--text-strong`. 보조 액션용.
- **상단/하단 내비게이션(탭바)**: `.glass`를 화면 가장자리에 띄우고(`position: sticky/fixed`),
  반경 크게, 약간의 여백을 둬 "떠 있는 바" 느낌. iOS 탭바처럼.
- **입력 필드**: `--bg-elevated` 살짝 불투명 + 1px 보더(`--glass-stroke-bottom`), focus 시 `--primary` 링.
- **모달/시트**: 화면을 `backdrop-filter: blur(8px)`로 덮고, 시트는 `.glass` + `--radius-xl`, 하단에서 스프링으로 등장.
- **태그/뱃지**: 파스텔 배경(`--pastel-*`) + 진한 텍스트. 채도 낮게, 둥글게(`--radius-pill`).

## 6. 모션
```css
:root {
  --ease-soft:   cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* 살짝 통통 튀는 */
  --dur-fast: 160ms; --dur: 240ms; --dur-slow: 380ms;
}
```
- 인터랙션은 `--dur` / `--ease-soft` 기본. 등장/모달은 `--ease-spring`로 생기 부여.
- 페이지 로드 시 staggered 등장(`animation-delay`)으로 한 번의 인상적인 순간을 만든다(과한 마이크로 인터랙션 남발 금지).
- hover/press에 미세한 깊이 변화(그림자·translateY)로 "유리가 반응하는" 느낌.

## 7. 접근성 (필수)
```css
/* 투명도 줄이기 선호 → 유리 대신 불투명 표면 */
@media (prefers-reduced-transparency: reduce) {
  .glass { background: var(--bg-elevated); backdrop-filter: none;
           -webkit-backdrop-filter: none; }
}
/* 모션 줄이기 선호 → 애니메이션 최소화 */
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
/* 키보드 포커스 링 항상 보이게 */
:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
```
- 본문 텍스트 대비 **최소 4.5:1**. 유리 위 텍스트는 `--glass-fill-strong` 표면을 깔아 대비 확보.
- 색만으로 정보 전달 금지(아이콘/텍스트 병행).

## 8. Do / Don't
- ✅ 따뜻한 오프화이트 + 멀티톤 파스텔 메시, 떠 있는 유리 패널, 큰 라운드, 부드러운 그림자.
- ✅ Pretendard(본문) + Bricolage Grotesque(디스플레이) 조합 유지.
- ❌ 다크모드/`prefers-color-scheme: dark` 스타일 추가.
- ❌ 순수 흰 배경 위 진한 그림자, 날카로운 직각, 형광/원색 대량 사용.
- ❌ Inter/Roboto/Arial 등 제너릭 폰트, "보라 그라데이션 on 화이트" 클리셰.
- ❌ 가독성을 해치는 과한 투명도(텍스트가 배경에 묻히는 것).
