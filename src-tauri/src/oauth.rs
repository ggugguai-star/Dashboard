// oauth.rs — OAuth 콜백 로컬 서버
//
// 동작 흐름:
//   1. start() 호출 → 백그라운드 스레드에서 127.0.0.1:59123 리슨
//   2. 브라우저에서 /?code=XXXX&... 요청 수신
//   3. 브라우저에 "인증 완료" HTML 응답
//   4. code 값을 Tauri 이벤트 "auth-code" 로 프론트엔드에 emit
//   5. 서버 종료 (단발성 — 1회 요청 처리 후 스레드 종료)
//
// ⚠ 절대 금지: 이 파일에서 Google API 토큰 교환 시도 금지
//   (토큰 교환은 3단계에서 JS fetch 로 수행)

use std::time::Duration;
use tauri::Emitter;
use tiny_http::{Header, Response, Server};

/// OAuth 콜백 서버가 리슨할 포트 (Google Cloud Console 리디렉션 URI 와 일치해야 함)
const CALLBACK_PORT: u16 = 59123;

/// 콜백 대기 최대 시간 (초) — 사용자가 브라우저에서 인증을 완료할 때까지
const TIMEOUT_SECS: u64 = 120;

/// 백그라운드 스레드에서 OAuth 콜백 서버를 실행한다.
/// `invoke('start_oauth')` 호출 즉시 반환하며, 서버는 독립 스레드에서 동작한다.
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        run_server(app);
    });
}

fn run_server(app: tauri::AppHandle) {
    let addr = format!("127.0.0.1:{CALLBACK_PORT}");

    // ── 서버 바인딩 ────────────────────────────────────────────────
    let server = match Server::http(&addr) {
        Ok(s) => {
            eprintln!("[OAuth] 콜백 대기 시작: http://{addr}");
            s
        }
        Err(e) => {
            // 포트가 이미 사용 중이거나 권한 오류 등
            eprintln!("[OAuth] 서버 바인딩 실패 ({addr}): {e}");
            let _ = app.emit("auth-code-error", format!("server_bind_failed: {e}"));
            return;
        }
    };

    // ── 콜백 요청 대기 (최대 TIMEOUT_SECS 초) ──────────────────────
    match server.recv_timeout(Duration::from_secs(TIMEOUT_SECS)) {
        // 요청 수신 성공
        Ok(Some(request)) => {
            let raw_url = request.url().to_string();
            eprintln!("[OAuth] 콜백 수신: {raw_url}");

            // 1) 브라우저에 성공 페이지 응답 (요청을 먼저 처리해야 브라우저가 닫힘)
            let html = success_html();
            let ct = Header::from_bytes(b"Content-Type", b"text/html; charset=utf-8")
                .expect("헤더 파싱 오류");
            let _ = request.respond(Response::from_string(html).with_header(ct));

            // 2) URL 에서 code 파라미터 추출 후 프론트엔드로 전달
            if let Some(code) = extract_query_param(&raw_url, "code") {
                eprintln!("[OAuth] code 추출 완료 → auth-code 이벤트 emit");
                let _ = app.emit("auth-code", code);
            } else {
                // Google 이 error 파라미터를 보내는 경우 (사용자 거부 등)
                let err = extract_query_param(&raw_url, "error")
                    .unwrap_or_else(|| "code_param_missing".to_string());
                eprintln!("[OAuth] 오류 콜백: {err}");
                let _ = app.emit("auth-code-error", err);
            }
        }

        // 타임아웃 — TIMEOUT_SECS 초 내에 콜백이 없었음
        Ok(None) => {
            eprintln!("[OAuth] 타임아웃: {TIMEOUT_SECS}초 이내 콜백 없음");
            let _ = app.emit("auth-code-error", "timeout");
        }

        // I/O 오류
        Err(e) => {
            eprintln!("[OAuth] 수신 오류: {e}");
            let _ = app.emit("auth-code-error", format!("recv_error: {e}"));
        }
    }

    eprintln!("[OAuth] 서버 종료");
    // server 변수가 Drop → 포트 해제
}

// ── 헬퍼 함수 ──────────────────────────────────────────────────────

/// URL(경로+쿼리) 에서 특정 파라미터 값을 추출한다.
///
/// - 입력 예: `"/?code=4%2F0AX4X&scope=..."` → `Some("4/0AX4X")`
/// - 매칭 실패 시 `None`
fn extract_query_param(url: &str, key: &str) -> Option<String> {
    // '?' 이후의 쿼리스트링만 처리
    let query = url.splitn(2, '?').nth(1)?;

    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
            if k == key {
                return Some(url_decode(v));
            }
        }
    }
    None
}

/// 최소한의 URL 퍼센트 디코딩.
/// OAuth authorization code 는 base64url 문자만 사용하므로
/// %XX 시퀀스 처리와 '+' → ' ' 변환만 처리한다.
fn url_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                // 상위 니블
                let hi = (bytes[i + 1] as char).to_digit(16);
                // 하위 니블
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(h), Some(l)) = (hi, lo) {
                    out.push(char::from((h * 16 + l) as u8));
                    i += 3;
                    continue;
                }
                // 잘못된 인코딩이면 그대로 통과
                out.push('%');
            }
            b'+' => {
                out.push(' ');
            }
            b => {
                out.push(b as char);
            }
        }
        i += 1;
    }
    out
}

/// 인증 완료 후 브라우저에 표시할 HTML (디자인 가이드 준수)
fn success_html() -> String {
    r#"<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>인증 완료 — 업무 대시보드</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Pretendard', 'Noto Sans KR', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #faf5ff 0%, #f0f9ff 50%, #fff7ed 100%);
    }
    .card {
      background: rgba(255, 255, 255, 0.90);
      border: 1px solid #f1f5f9;
      border-radius: 16px;
      padding: 48px 56px;
      text-align: center;
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.10),
                  0 2px 4px -2px rgb(0 0 0 / 0.10);
      max-width: 420px;
      width: 90%;
    }
    .icon   { font-size: 48px; margin-bottom: 20px; }
    h2      { color: #1e293b; font-size: 20px; font-weight: 700; margin-bottom: 12px; }
    p       { color: #64748b; font-size: 14px; line-height: 1.6; }
    .badge  {
      display: inline-block;
      margin-top: 20px;
      padding: 4px 12px;
      background: #d1fae5;
      color: #059669;
      border: 1px solid #a7f3d0;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h2>Google 계정 연결 완료</h2>
    <p>인증이 성공적으로 완료되었습니다.<br>이 창을 닫고 앱으로 돌아가세요.</p>
    <span class="badge">연결됨</span>
  </div>
</body>
</html>"#
    .to_string()
}
