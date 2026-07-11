@echo off
rem Build ClaudeCockpit.exe with the C# compiler bundled in Windows (.NET Framework, no install needed).
rem Source is UTF-8 without BOM, so /codepage:65001 is required (Korean strings break otherwise).
rem NOTE: keep this file ASCII-only - cmd.exe parses batch in the system codepage (CP949 on ko-KR)
rem       and UTF-8 multibyte bytes can swallow line breaks, corrupting the script.
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo [build] csc.exe not found - .NET Framework 4.x is required.
  exit /b 1
)
"%CSC%" /nologo /codepage:65001 /target:exe /out:"%~dp0..\ClaudeCockpit.exe" "%~dp0cockpit-launcher.cs"
if errorlevel 1 exit /b 1
echo [build] done: %~dp0..\ClaudeCockpit.exe
