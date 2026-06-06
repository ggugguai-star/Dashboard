@echo off
setlocal
cd /d "%~dp0"
set CI=true
echo [build] npm install ...
call npm install
if errorlevel 1 exit /b 1
echo [build] tauri build ...
call npm run tauri:build -- --ci
exit /b %errorlevel%
