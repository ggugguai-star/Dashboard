// main.rs — Windows 릴리즈 빌드에서 콘솔 창 숨기기
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run();
}
