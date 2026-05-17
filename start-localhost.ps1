$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

function Test-LocalPort($port) {
  try {
    $listener = Get-NetTCPConnection -LocalPort $port -ErrorAction Stop |
      Where-Object { $_.State -in @('Listen', 'Established') } |
      Select-Object -First 1
    return $null -ne $listener
  } catch {
    return $false
  }
}

Write-Host "Starting MogCheck local app..."

if (-not (Test-Path ".\node_modules")) {
  Write-Host "Installing frontend dependencies..."
  npm install
}

if (-not (Test-Path ".\backend\node_modules")) {
  Write-Host "Installing backend dependencies..."
  npm --prefix backend install
}

if (-not (Test-Path ".\.env.local")) {
  Write-Host "Creating local env file..."
  npm run setup:local
}

$vitePath = ".\node_modules\.bin\vite.cmd"

if (-not (Test-Path $vitePath)) {
  throw "Vite executable not found at $vitePath"
}

if (-not (Test-LocalPort 3001)) {
  Write-Host "Starting backend on http://127.0.0.1:3001 in a new PowerShell window..."
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "Set-Location '$PSScriptRoot\backend'; cmd /c npm.cmd run dev"
  )
  Start-Sleep -Seconds 3
} else {
  Write-Host "Backend already running on port 3001."
}

Write-Host "Starting frontend on http://127.0.0.1:5174 ..."
& $vitePath --host 127.0.0.1 --port 5174 --strictPort
