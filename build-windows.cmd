@echo off
setlocal
cd /d "%~dp0"

if defined VSCMD_ARG_TGT_ARCH goto :build

set "VCVARS="
if defined PORTLENS_VCVARS set "VCVARS=%PORTLENS_VCVARS%"

if not defined VCVARS if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" (
  for /f "usebackq tokens=*" %%I in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
    set "VCVARS=%%I\VC\Auxiliary\Build\vcvars64.bat"
  )
)

if defined VCVARS if exist "%VCVARS%" (
  call "%VCVARS%"
  if errorlevel 1 exit /b %errorlevel%
) else (
  echo [ERROR] MSVC build environment was not found.
  echo Run this script from "x64 Native Tools Command Prompt for VS 2022",
  echo or set PORTLENS_VCVARS to the full path of vcvars64.bat.
  exit /b 1
)

:build
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
call npm ci
if errorlevel 1 exit /b %errorlevel%
call npm run tauri build -- --no-bundle
if errorlevel 1 exit /b %errorlevel%
copy /y "%~dp0src-tauri\target\release\portlens.exe" "%~dp0PortLens.exe" >nul
if errorlevel 1 exit /b %errorlevel%
echo [OK] Built %~dp0PortLens.exe
