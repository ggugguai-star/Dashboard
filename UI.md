# 비주얼 디자인 가이드 (Ultimate Edition)

> 내가 만드는 모든 프로그램에 적용할 시각적 디자인 규칙.
> 색상, 타이포그래피, 형태, 그림자, 간격 등 눈에 보이는 모든 것을 다루며,
> 라이트 모드의 파스텔 감성과 다크 모드의 리퀴드 메탈(Liquid Metal), 그리고 최신 트렌드(Bento Box, Spatial Glass)를 모두 포괄한다.

---

## 1. 색상 (Color)

### 1-1. 배경색 (Light Mode)
전체 앱 배경은 단색을 절대 사용하지 않는다. 연한 파스텔 3색 메시 그라디언트를 사용한다.
```css
background: linear-gradient(135deg, #faf5ff 0%, #f0f9ff 50%, #fff7ed 100%);
/* 연보라 → 연하늘 → 연오렌지 */
```

패널·카드의 배경은 반투명 흰색을 사용하되, 렌더링 퍼포먼스를 위해 블러(`blur`)는 꼭 필요한 뎁스에만 제한적으로 사용한다.
```css
background: rgba(255, 255, 255, 0.85);   /* 일반 카드 (블러 생략 가능) */
background: rgba(255, 255, 255, 0.70);   /* 상단 바, 모달 */
backdrop-filter: blur(8px);              /* 강조 요소에만 블러 적용 */
```

### 1-2. 브랜드 컬러 (Primary)
주색은 Violet 계열이다. 접근성과 명도 대비를 고려하여 텍스트에는 `500` 이상을 사용한다.
| 토큰 | Hex | 용도 |
|------|-----|------|
| `primary-400` | `#a78bfa` | 장식용 링, 토글 트랙 (텍스트용 아님) |
| `primary-500` | `#8b5cf6` | 버튼, 아이콘 배경, 주요 UI, **강조 텍스트** |
| `primary-600` | `#7c3aed` | 버튼 hover, 딥 포인트 |
| `primary-50`  | `#f5f3ff` | 카드 hover 배경, 연한 틴트 |

버튼 등 넓은 면적에는 단색 대신 그라디언트를 쓴다.
```css
background: linear-gradient(to right, #8b5cf6, #7c3aed);  /* violet→purple */
```

### 1-3. 중립 컬러 (Neutral)
모든 텍스트와 선, 배경의 중립 계열은 **Slate** 팔레트만 사용한다. Gray, Zinc, Stone은 금지한다.
| 토큰 | Hex | 용도 |
|------|-----|------|
| `slate-800` | `#1e293b` | 제목, 강력한 강조 텍스트 |
| `slate-700` | `#334155` | 카드 헤더 텍스트 |
| `slate-600` | `#475569` | 본문 텍스트 |
| `slate-500` | `#64748b` | 보조 텍스트 |
| `slate-400` | `#94a3b8` | 힌트, 메타 텍스트, **비활성 텍스트 (가독성 하한선)** |
| `slate-200` | `#e2e8f0` | 비활성 버튼 배경 |
| `slate-100` | `#f1f5f9` | 카드 테두리, 트랙 배경 |

---

## 2. 다크 모드 & 리퀴드 메탈 (Liquid Metal)

단순한 검은색이 아닌, 애플 감성의 고광택 액체 금속 질감과 공간 컴퓨팅의 입체감을 구현한다.

### 2-1. 심해 배경 (Obsidian & Liquid Mesh)
깊이감이 느껴지는 흑요석(Obsidian) 스페이스에 몽환적인 액체 흐름을 시각화한다.
```css
background: #090d16; /* Deep Obsidian */
background-image: 
  radial-gradient(at 0% 0%, rgba(139, 92, 246, 0.15) 0px, transparent 50%),
  radial-gradient(at 100% 100%, rgba(45, 212, 191, 0.08) 0px, transparent 50%);
```

### 2-2. 리퀴드 메탈 콤보
표면에 하이라이트가 맺힌 듯한 메탈릭 그라디언트와 은은한 발광(Glow) 효과를 적용한다.
```css
background: linear-gradient(135deg, #e9d5ff 0%, #8b5cf6 45%, #4c1d95 100%);
box-shadow: 0 0 20px rgba(139, 92, 246, 0.4);
```

### 2-3. 스페이셜 글래스 (Spatial Glass)
다크 모드의 패널은 Apple Vision Pro 스타일의 극한의 공간감을 둔다. 패널 가장자리에 1px 굵기의 실버/화이트 하이라이트 반사선(Rim)을 그어, 두꺼운 유리가 공중에 부유하는 느낌을 극대화한다.
```css
background: rgba(15, 23, 42, 0.55);     /* slate-900 베이스, 투명도 상향 */
backdrop-filter: blur(24px) saturate(150%); /* 깊은 굴절 및 색상 채도 부스팅 */
border: 1px solid rgba(255, 255, 255, 0.08); 
border-top: 1px solid rgba(255, 255, 255, 0.25);  /* 상단에 강한 빛 맺힘 효과 */
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.15);
```

---

## 3. 타이포그래피 (Typography)

### 3-1. 폰트 패밀리
한국어 포함 시 `Pretendard`, 영문 전용 시 `DM Sans` 1순위 선언. (`Inter`, `Roboto` 금지)

### 3-2. 크기 및 굵기 체계
* **접근성 절대 규칙:** 11px 미만의 폰트(10px 등)는 가독성 문제로 절대 사용하지 않는다.
```text
11px  캡션/마이크로 (normal)  상태 메시지, 배지, 힌트
12px  바디 (normal)         일반 본문, 카드 내용
14px  서브타이틀 (semibold)   사이드바 항목, 버튼 텍스트
16px  타이틀 (extrabold)    앱/페이지 제목
```

---

## 4. 형태와 레이아웃 (Shape & Layout)

### 4-1. 벤토박스 레이아웃 (Bento Box System)
정보를 배치할 때는 리스트 형태를 지양하고, 일본의 도시락통처럼 크기가 다른 모서리가 둥근 타일들을 빈틈없이 꽉 채워 배치하는 벤토박스 그리드를 최우선으로 적용한다.
* `display: grid`와 `gap-4(16px)`를 활용하여 컴팩트하고 감각적인 대시보드를 구성한다.

### 4-2. 모서리 반경 (Border Radius)
직각 사각형(`rounded-none`)은 절대 금지하며, 계층이 깊을수록 반경이 작아진다.
* 외부 벤토박스 타일: `16px (rounded-2xl)`
* 내부 겹침 카드: `12px (rounded-xl)`
* 배지/버튼: `9999px (rounded-full)`

### 4-3. 간격 체계 (4px 배수)
* `12px`: 카드 헤더 하단 여백, 타일 내부 소형 패딩
* `16px`: 벤토 타일 간 간격(Gap), 사이드바 카드 패딩
* `20px`: 페이지 전체 바깥 마진

---

## 5. 트랜지션 & 모션 (Motion & Physics)

### 5-1. 유체 역학 모션 (Fluid Physics)
모든 인터랙션에는 물리 기반 탄성(Elastic) 곡선을 적용하여 쫀득하고 역동적인 수은의 움직임을 표현한다. 기계적인 리니어(Linear) 변화는 금지한다.
```css
/* 유체 역학 베지에 곡선 토큰 */
--ease-liquid: cubic-bezier(0.34, 1.56, 0.64, 1); /* 젤리처럼 쫀득한 탄성 */
transition: all 350ms var(--ease-liquid);
```

### 5-2. 다이내믹 모핑 (Dynamic Morphing)
상태가 변할 때(예: 버튼 클릭 -> 로딩 -> 완료) 요소가 갑자기 사라지고 나타나는 것을 금지한다. 아이폰의 '다이내믹 아일랜드'처럼 기존 요소의 크기(width, height)와 형태(border-radius)가 끊김 없이 스르륵 늘어나고 좁아지며 다음 상태로 유기적으로 변형되도록 설계한다.

### 5-3. Hover 효과
* **벤토 타일/카드:** `transform: translateY(-4px) scale(1.015);` 쫀득하게 부상.
* **버튼:** 리퀴드 메탈 그림자 강화 및 활성화(active) 시 탄성 수축.

---

## 6. 절대 금지 규칙 (Anti-Patterns)

| ❌ 금지 | ✅ 대신 (Light / Dark) |
|--------|--------|
| 흰색/검은색 단색 배경 | 파스텔 메시 배경 / Obsidian 오로라 스킨 |
| 흩어지고 정돈되지 않은 레이아웃 | **벤토박스(Bento Box)** 기반의 그리드 타일링 |
| 딱딱하게 끊기는 컴포넌트 교체 | **다이내믹 모핑**을 통한 부드러운 유기적 전환 |
| 무분별한 쨍한 원색 (네오 브루탈리즘) | 파스텔 & 슬레이트톤 기반에 포인트 컬러 하나만 제한적 사용 |
| `Inter`, `Roboto`, `Arial` | `Pretendard`, `DM Sans` |
| `10px` 이하의 마이크로 텍스트 | 최소 `11px` 이상 유지 (접근성) |
| 무분별한 `blur` 효과 남용 | 상위 뎁스(모달, 네비게이션)에만 제한적 사용 |
| 탁한 회색 테두리 (`#334155`) | **Spatial Glass** 기반의 1px 반투명 하이라이트 유리선 |
| 단색 버튼 배경 | 광택 하이라이트가 살아있는 **리퀴드 메탈** 그라디언트 |