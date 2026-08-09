@echo off
echo ============================================================
echo   开放防火墙端口 8080（局域网访问需要）
echo   请【右键本文件 - 以管理员身份运行】
echo ============================================================
echo.
netsh advfirewall firewall delete rule name="TradeToolbox"
netsh advfirewall firewall add rule name="TradeToolbox" dir=in action=allow protocol=TCP localport=8080
echo.
echo 完成！端口 8080 已放行。请重新双击 start-server.bat 启动服务器。
echo （如果改了端口，请把上面 8080 改成对应端口后再运行）
pause
