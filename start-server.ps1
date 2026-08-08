# Trade Toolbox - LAN server (requires Node.js)
$port = if ($env:PORT) { $env:PORT } else { "8080" }
$env:PORT = $port
$env:AUTO_OPEN = "1"
Write-Host "Starting Trade Toolbox on http://localhost:$port"
& node "$PSScriptRoot\server.js"
