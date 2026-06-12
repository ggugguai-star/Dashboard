@echo off
setlocal
cd /d "%~dp0"

echo [build] Dashboard Tauri release build
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found. Install Node.js first.
  goto :fail
)

echo [1/2] npm install
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/2] npm run tauri:build
call npm run tauri:build
if errorlevel 1 goto :fail

echo.
echo [build] SUCCESS
echo Installer: src-tauri\target\release\bundle\nsis\
echo Exe:       src-tauri\target\release\work-dashboard.exe
goto :end

:fail
echo.
echo [build] FAILED - see messages above
pause
exit /b 1

:end
pause
exit /b 0
