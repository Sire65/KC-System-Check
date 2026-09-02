@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title KC System Check - Lokaler Server
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0KC_LOCAL_SERVER.ps1"
endlocal
