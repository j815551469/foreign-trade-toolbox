@echo off
cd /d "%~dp0"
title Trade Toolbox - 外贸业务员工具箱
echo ============================================================
echo   外贸业务员工具箱  局域网服务器（源码版，需先安装 Node.js）
echo ------------------------------------------------------------
echo   本机访问  : http://localhost:8080
echo   其他电脑  : http://本机IP:8080
echo   换端口    : 编辑本文件开头的 set PORT=xxxx
echo   防火墙    : 如局域网打不开，右键"开放防火墙.bat"以管理员运行
echo ============================================================
echo.
set PORT=8080
set AUTO_OPEN=1
node server.js
pause
