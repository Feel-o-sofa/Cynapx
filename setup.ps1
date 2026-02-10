# setup.ps1
# This script ensures Node.js is installed and installs project dependencies.

Write-Host "--- Code Knowledge Tool Setup & Update ---" -ForegroundColor Cyan

# 1. Check Node.js version
try {
    $nodeVersion = node -v
    Write-Host "Detected Node.js version: $nodeVersion" -ForegroundColor Green
    
    # Simple check for version >= 20
    if ($nodeVersion -match "v(\d+)") {
        $major = [int]$Matches[1]
        if ($major -lt 20) {
            Write-Warning "Warning: Node.js version 20 or higher is recommended. Current: $nodeVersion"
        }
    }
}
catch {
    Write-Error "Error: Node.js is not installed. Please install Node.js >= 20 from https://nodejs.org/"
    exit 1
}

# 2. Install dependencies
Write-Host "Installing dependencies from package.json..." -ForegroundColor Cyan
npm install

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nSetup complete! You can now start the tool using: npm start" -ForegroundColor Green
}
else {
    Write-Error "`nFailed to install dependencies. Please check the logs above."
    exit 1
}
