$ErrorActionPreference = 'Stop'
$Port = 8765
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Force UTF-8 console output on Windows PowerShell/CMD.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

$ae = [char]0x00E4
$oe = [char]0x00F6
$ue = [char]0x00FC
$sz = [char]0x00DF

function Get-MimeType([string]$Path) {
    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.js' { 'text/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.webmanifest' { 'application/manifest+json; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        '.svg' { 'image/svg+xml' }
        '.png' { 'image/png' }
        '.jpg' { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        '.ico' { 'image/x-icon' }
        default { 'application/octet-stream' }
    }
}

$listener = [System.Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
try {
    $listener.Start()
} catch {
    Write-Host "Port $Port ist bereits belegt." -ForegroundColor Red
    Write-Host "Bitte ein anderes KC-System-Check-Fenster schlie$sz`en und erneut starten."
    Read-Host "ENTER zum Beenden"
    exit 1
}

$url = "http://127.0.0.1:$Port/"
Write-Host ""
Write-Host "KC SYSTEM CHECK - LOKALE VERSION" -ForegroundColor Cyan
Write-Host "--------------------------------" -ForegroundColor Cyan
Write-Host "Server l${ae}uft unter: $url"
Write-Host "Dieses Fenster ge${oe}ffnet lassen."
Write-Host "Zum Beenden: Fenster schlie${sz}en oder STRG+C." -ForegroundColor Yellow
Write-Host ""
Start-Process $url

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) { $client.Close(); continue }
            while ($true) {
                $line = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($line)) { break }
            }

            $parts = $requestLine.Split(' ')
            $method = $parts[0]
            $rawPath = if ($parts.Length -gt 1) { $parts[1] } else { '/' }
            $pathOnly = $rawPath.Split('?')[0]
            $decoded = [Uri]::UnescapeDataString($pathOnly).TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($decoded)) { $decoded = 'index.html' }

            $candidate = Join-Path $Root ($decoded -replace '/', [IO.Path]::DirectorySeparatorChar)
            $full = [IO.Path]::GetFullPath($candidate)
            $rootFull = [IO.Path]::GetFullPath($Root + [IO.Path]::DirectorySeparatorChar)

            $status = '200 OK'
            if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
                $status = '403 Forbidden'; $body = [Text.Encoding]::UTF8.GetBytes('Forbidden'); $mime='text/plain; charset=utf-8'
            } elseif (Test-Path $full -PathType Leaf) {
                $body = [IO.File]::ReadAllBytes($full); $mime = Get-MimeType $full
            } else {
                $status = '404 Not Found'; $body = [Text.Encoding]::UTF8.GetBytes('Not Found'); $mime='text/plain; charset=utf-8'
            }

            $headers = "HTTP/1.1 $status`r`nContent-Type: $mime`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
            $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
            $stream.Write($headerBytes,0,$headerBytes.Length)
            if ($method -ne 'HEAD') { $stream.Write($body,0,$body.Length) }
            $stream.Flush()
        } catch {
            # Ignore a single browser request error; keep the local server alive.
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
