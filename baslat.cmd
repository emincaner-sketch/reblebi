@echo off
REM SosyalPilot - cift tikla baslat
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0baslat.ps1" %*
pause
