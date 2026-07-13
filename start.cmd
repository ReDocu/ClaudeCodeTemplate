@echo off
rem Claude Cockpit cold boot (F12) - fallback entry. Prefer ClaudeCockpit.exe (same behavior).
rem Logic lives in `cockpit boot` (JS); this script only checks prerequisites and delegates.
rem NOTE: keep this file ASCII-only - cmd.exe parses batch in the system codepage (CP949 on ko-KR)
rem       and UTF-8 multibyte bytes can swallow line breaks, corrupting the script.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [start] Node.js not found. Install LTS from https://nodejs.org and run again.
  pause
  exit /b 1
)

rem Extra args pass through to cockpit boot (e.g. "start.cmd --setup" forces the wmux path prompt).
node "cockpit\bin\cockpit.js" boot %*
if errorlevel 1 (
  echo.
  echo [start] Boot failed - see the message above, then run again.
  pause
  exit /b 1
)
pause
