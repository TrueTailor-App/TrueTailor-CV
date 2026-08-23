@echo off
:: מעבר לתיקייה שבה נמצא קובץ ה-bat (תיקיית הפרויקט)
cd /d "%~dp0"

:: בדיקה אם נגרר קובץ על הסקריפט
if "%~1"=="" (
    echo Error: No file provided. Please drag and drop a file onto this script.
    pause
    exit /b 1
)

:: חילוץ שם הקובץ והסיומת בלבד
set "FILENAME=%~nx1"

:: העתקת הקובץ לתיקיית הפרויקט אם הוא מגיע ממיקום חיצוני
if not "%~f1"=="%CD%\%FILENAME%" (
    copy /y "%~1" ".\%FILENAME%" >nul
)

:: ביצוע פקודות ה-Git
git add "%FILENAME%"
git commit -m "add %FILENAME%"
git push origin main

echo.
echo File '%FILENAME%' uploaded successfully to GitHub!
pause