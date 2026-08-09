# 源码版启动脚本（PowerShell，需先安装 Node.js）
$port = if ($env:PORT) { $env:PORT } else { "8080" }
$env:PORT = $port
$env:AUTO_OPEN = "1"
Write-Host "正在启动 Trade Toolbox（端口 $port）..."
Write-Host "本机访问: http://localhost:$port"
& "node" "$PSScriptRoot\server.js"
