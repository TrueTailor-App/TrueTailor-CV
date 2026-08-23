@echo off
REM ===========================================================================
REM  Runs every check for the voice answer feature, in order.
REM  Put this next to TrueTailor_CV_v39_0.html and double click it, or run it
REM  from cmd. Paths with spaces are handled; nothing is hardcoded.
REM
REM  Needs: Node.js, Python 3, and jsdom (installed on first run below).
REM ===========================================================================
setlocal
cd /d "%~dp0"

REM UTF-8 codepage, so Hebrew inside a failure message is readable rather than
REM a row of question marks. Harmless if it is already set.
chcp 65001 >nul 2>&1

echo.
echo ============================================================
echo   TrueTailor CV - voice answer checks
echo   folder: %CD%
echo ============================================================

where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js was not found on PATH. Install it and run this again.
  goto :end
)
where python >nul 2>&1
if errorlevel 1 (
  echo [!] Python was not found on PATH. Test 2 will be skipped.
  set NOPY=1
)

if not exist "node_modules\jsdom" (
  echo.
  echo Installing jsdom ^(first run only^)...
  call npm install jsdom --silent
  if errorlevel 1 (
    echo [X] npm install failed. Check your internet connection.
    goto :end
  )
)

set FAILED=0

echo.
echo --- 1/4  WAV encoder, lifted out of the app file -----------
call node test_wav.js
if errorlevel 1 set FAILED=1

if defined NOPY goto :skip2
echo.
echo --- 2/4  the same WAV read back by a real parser -----------
python test_wav_verify.py
if errorlevel 1 set FAILED=1
goto :after2
:skip2
echo.
echo --- 2/4  SKIPPED, Python not found ------------------------
:after2

echo.
echo --- 3/4  the whole page in jsdom --------------------------
call node test_app.js
if errorlevel 1 set FAILED=1

if defined NOPY goto :done
echo.
echo --- 4/4  breaking it on purpose, to prove the tests bite ---
python test_mutants.py
if errorlevel 1 set FAILED=1

:done
echo.
echo ============================================================
if "%FAILED%"=="1" (
  echo   SOMETHING FAILED - scroll up for the lines marked FAIL
) else (
  echo   everything passed
)
echo ============================================================

:end
echo.
pause
endlocal
