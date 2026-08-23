@echo off
setlocal EnableDelayedExpansion

rem ============================================================
rem  TrueTailor CV - update_site_obfuscated.bat (Drag & Drop)
rem ============================================================

pushd "%~dp0"
if errorlevel 1 (
  echo [ERROR] Cannot enter script repository directory.
  pause
  exit /b 1
)

echo.
echo ===================================================
echo   TrueTailor CV - Obfuscate ^& Deploy to GitHub
echo ===================================================
echo Working Folder: %CD%
echo.

rem --- 1. Check Git Environment ---
git --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git is not installed or not in PATH.
  goto :fail
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Current directory is not a Git repository.
  goto :fail
)

rem --- 2. Determine Source File ---
set "SRC_RAW=%~1"

if defined SRC_RAW (
    set "SRC=%~f1"
) else (
    echo [INFO] No file dropped. Searching for newest TrueTailor_CV_v*.html...
    for /f "delims=" %%f in ('dir /b /o-d "TrueTailor_CV_v*.html" 2^>nul') do (
        if not defined SRC set "SRC=%%~ff"
    )
)

if not defined SRC (
  echo [ERROR] No input file provided and no TrueTailor_CV_v*.html found.
  goto :fail
)

if not exist "%SRC%" (
  echo [ERROR] Input file does not exist: "%SRC%"
  goto :fail
)

echo [OK] Source File: "%SRC%"

rem --- 3. Extract Version ---
set "VER="
for /f "tokens=2 delims='" %%v in ('findstr /i /c:"TT_VERSION" "%SRC%" 2^>nul') do (
  if not defined VER set "VER=%%v"
)

if not defined VER (
  set "VER=v_update_%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%"
  set "VER=!VER: =0!"
)

echo [OK] Detected Version Tag: !VER!

rem --- 4. Obfuscate JS and Generate index.html ---
echo.
echo [1/4] Obfuscating JavaScript "%SRC%" -> "index.html"...
node obfuscate.js "%SRC%" "index.html"
if errorlevel 1 (
  echo [ERROR] Obfuscation failed. Please check Node.js installation.
  goto :fail
)

rem --- 5. Git Stage & Commit ---
echo.
echo [2/4] Staging files for Git...
git add .
if errorlevel 1 (
  echo [ERROR] git add failed.
  goto :fail
)

git diff --cached --quiet -- index.html
if not errorlevel 1 (
  echo [INFO] index.html is identical to the latest commit. No changes to deploy.
) else (
  echo [3/4] Committing changes...
  git commit -m "Deploy obfuscated version !VER!"
  if errorlevel 1 (
    echo [ERROR] git commit failed.
    goto :fail
  )
  echo [OK] Committed version !VER!
)

rem --- 6. Sync with Remote and Push ---
echo.
echo [4/4] Pushing to GitHub...
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
if not defined BRANCH set "BRANCH=main"

git pull --rebase origin !BRANCH! >nul 2>&1

git push origin !BRANCH!
if errorlevel 1 (
  echo [ERROR] git push failed. Check network connection or permissions.
  goto :fail
)

echo.
echo ===================================================
echo   SUCCESS! Version !VER! obfuscated ^& pushed!
echo ===================================================
echo.
pause
popd
endlocal
exit /b 0

:fail
echo.
echo ===================================================
echo   DEPLOYMENT FAILED. Please review errors above.
echo ===================================================
echo.
pause
popd
endlocal
exit /b 1