$ErrorActionPreference = "Stop"

$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot ".codex-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$token = & $cloudflared tunnel token mogcheck-api
if ($LASTEXITCODE -ne 0 -or -not $token) {
  throw "Could not fetch Cloudflare tunnel token for mogcheck-api."
}

& $cloudflared tunnel --no-autoupdate run --token $token.Trim() `
  1>> (Join-Path $logDir "cloudflared-startup.out.log") `
  2>> (Join-Path $logDir "cloudflared-startup.err.log")
