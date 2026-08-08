@echo off
rem Trade Toolbox - LAN server (requires Node.js installed, see README)
cd /d "%~dp0"
title Trade Toolbox
echo ============================================
echo   Foreign Trade Toolbox - LAN Server
echo   Local : http://localhost:8080
echo   LAN   : http://<your-ip>:8080
echo   First registered account becomes admin
echo ============================================
set PORT=8080
set AUTO_OPEN=1
node server.js
pause
