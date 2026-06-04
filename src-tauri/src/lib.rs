// lib.rs — Tauri v2 앱 진입점
//
// [6단계 추가] 시스템 트레이, Ctrl+Alt+D 전역 단축키, 창 toggle
//
// [Rust 허용 구간 — 5대 원칙 §4]
//   - OAuth 로컬 서버 (oauth.rs)
//   - 시스템 트레이 / 전역 단축키 (OS 수준 등록 필수)
//
// [절대 금지]
//   - Google API 통신 — JS 영역
//   - 파일 I/O 직접 구현 — tauri-plugin-fs 사용

mod oauth;
mod token_secure;

use tauri::Manager;

// ── 창 표시/숨김 토글 ────────────────────────────────────────────
// 트레이 클릭 + Ctrl+Alt+D 공용 헬퍼
fn toggle_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => {
                // 숨김 상태 또는 판단 불가 → 표시 + 포커스
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}

// ── Tauri 커맨드 ──────────────────────────────────────────────────

/// OAuth 콜백 로컬 서버를 백그라운드에서 시작한다.
/// JS: `await invoke('start_oauth')`
///   → 논블로킹 반환 후 auth-code / auth-code-error 이벤트로 결과 전달
#[tauri::command]
fn start_oauth(app: tauri::AppHandle) {
    oauth::start(app);
}

// ── 시스템 트레이 설정 ────────────────────────────────────────────

fn setup_tray<R: tauri::Runtime>(app: &mut tauri::App<R>) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };

    // 메뉴 구성: 열기 / 항상 앞에 / 구분선 / 종료
    let show = MenuItem::with_id(app, "show",        "대시보드 열기",   true, None::<&str>)?;
    let aot  = MenuItem::with_id(app, "alwaysontop", "항상 앞에 표시", true, None::<&str>)?;
    let sep  = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit",        "종료",           true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &aot, &sep, &quit])?;

    // 아이콘: 앱 기본 아이콘 사용 (tauri.conf.json bundle.icon 에서 자동 로드)
    let icon = app
        .default_window_icon()
        .expect("앱 아이콘이 설정되지 않았습니다")
        .clone();

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false) // 우클릭 → 메뉴, 좌클릭 → toggle
        .tooltip("업무 대시보드")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "alwaysontop" => {
                if let Some(w) = app.get_webview_window("main") {
                    let current = w.is_always_on_top().unwrap_or(false);
                    let _ = w.set_always_on_top(!current);
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 좌클릭(Up) → toggle
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

// ── 전역 단축키 등록 ─────────────────────────────────────────────

fn setup_shortcut<R: tauri::Runtime>(app: &mut tauri::App<R>) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    // Ctrl+Alt+D 등록 (핸들러는 Builder::with_handler 에서 처리)
    app.global_shortcut()
        .register("Ctrl+Alt+D")
        .map_err(|e| {
            eprintln!("[Shortcut] Ctrl+Alt+D 등록 실패 (다른 앱이 점유 중?): {e}");
            e
        })
        .ok(); // 등록 실패해도 앱은 계속 실행
    Ok(())
}

// ── 앱 진입점 ────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── 커스텀 커맨드 ────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            start_oauth,
            token_secure::token_secure_load,
            token_secure::token_secure_save,
            token_secure::token_secure_clear,
            token_secure::token_secure_restrict_file,
            token_secure::token_secure_migrate_legacy,
            token_secure::token_secure_remove_legacy,
        ])

        // ── setup: 트레이 + 단축키 ───────────────────────────────
        .setup(|app| {
            setup_tray(app)?;
            setup_shortcut(app)?;
            Ok(())
        })

        // ── 전역 단축키 핸들러 (Rust 등록 필수 — JS 핸들러는 창 숨김 시 작동 안 함) ──
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(
                    |app,
                     shortcut: &tauri_plugin_global_shortcut::Shortcut,
                     event: tauri_plugin_global_shortcut::ShortcutEvent| {
                        use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
                        if event.state() == ShortcutState::Pressed
                            && shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyD)
                        {
                            toggle_window(app);
                        }
                    },
                )
                .build(),
        )

        // ── 파일 시스템 (토큰·창 위치 저장) ─────────────────────
        .plugin(tauri_plugin_fs::init())
        // ── 셸 실행 (URL 열기, ms-screenclip:) ──────────────────
        .plugin(tauri_plugin_shell::init())
        // ── 폴더 선택 다이얼로그 ─────────────────────────────────
        .plugin(tauri_plugin_dialog::init())
        // ── 클립보드 이미지 읽기 (화면 캡처 우회) ────────────────
        .plugin(tauri_plugin_clipboard_manager::init())
        // ── Windows 자동 시작 ────────────────────────────────────
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        // ── GitHub Releases 자동 업데이트 ────────────────────────
        .plugin(tauri_plugin_updater::Builder::new().build())
        // ── 앱 종료 ──────────────────────────────────────────────
        .plugin(tauri_plugin_process::init())
        // ── 창 위치/크기 자동 저장·복원 ──────────────────────────
        .plugin(tauri_plugin_window_state::Builder::new().build())
        // ── HTTP 클라이언트 (Google API CORS 우회) ────────────────
        .plugin(tauri_plugin_http::init())
        // ── 앱 실행 ──────────────────────────────────────────────
        .run(tauri::generate_context!())
        .expect("Tauri 앱 실행 중 오류 발생");
}
