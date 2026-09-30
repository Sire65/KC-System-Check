@echo off
setlocal
chcp 65001 >nul
title KC System Check - Einmaliges Update
echo.
echo ============================================================
echo  KC SYSTEM CHECK - EINMALIGES UPDATE AUF AKTUELLEN STAND
echo ============================================================
echo.
set "TARGET=%~1"
if not defined TARGET set "TARGET=%~dp0"
if not exist "%TARGET%version.json" (
 echo Der KC-System-Check-Ordner wurde hier nicht gefunden:
 echo %TARGET%
 echo.
 echo Ziehen Sie diese Datei in den vorhandenen KC-System-Check-Ordner
 echo und starten Sie sie dort erneut.
 pause
 exit /b 2
)
echo Ziel: %TARGET%
echo Lade aktuellen Updater...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $u='https://raw.githubusercontent.com/Sire65/KC-System-Check/main/KC_SELF_UPDATE.ps1'; Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile (Join-Path '%TARGET%' 'KC_SELF_UPDATE.ps1')"
if errorlevel 1 (
 echo.
 echo FEHLER: Updater konnte nicht geladen werden.
 pause
 exit /b 3
)
echo Starte Update...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TARGET%KC_SELF_UPDATE.ps1" -Root "%TARGET%" -Port 8765
if errorlevel 1 (
 echo.
 echo FEHLER beim Update.
 pause
 exit /b 4
)
echo.
echo Update wurde gestartet.
timeout /t 3 /nobreak >nul
endlocal
