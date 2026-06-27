$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting Anas G Lens installer..." -ForegroundColor Cyan

# Check Node.js
try {
    $nodeVer = node -v
} catch {
    Write-Host "❌ Error: Node.js is not installed. Please install Node.js (v16.0+) first." -ForegroundColor Red
    exit 1
}

# Check VS Code CLI
try {
    $codeVer = code --version
} catch {
    Write-Host "❌ Error: VS Code CLI ('code') is not installed or not in PATH." -ForegroundColor Red
    Write-Host "   In VS Code, open the Command Palette (Cmd/Ctrl+Shift+P) and run:" -ForegroundColor Yellow
    Write-Host "   'Shell Command: Install 'code' command in PATH'" -ForegroundColor Yellow
    exit 1
}

# Check local vs remote
$localRepo = Test-Path "package.json"
if ($localRepo) {
    $pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
    if ($pkg.name -eq "anas-g-lens") {
        Write-Host "📂 Running installation from local repository directory..." -ForegroundColor Green
        
        Write-Host "⚙️ Installing dependencies..." -ForegroundColor Yellow
        npm install
        
        Write-Host "🏗️ Compiling extension..." -ForegroundColor Yellow
        npm run compile
        
        Write-Host "📦 Packaging extension..." -ForegroundColor Yellow
        npx @vscode/vsce package --allow-missing-repository
        
        $vsix = Get-ChildItem -Filter "anas-g-lens-*.vsix" | Select-Object -First 1
        Write-Host "🔌 Installing extension locally ($($vsix.Name))..." -ForegroundColor Green
        code --install-extension $vsix.FullName
        
        Write-Host "✅ Anas G Lens installed successfully! Restart your VS Code editor to activate." -ForegroundColor Green
        exit 0
    }
}

Write-Host "🌐 Remote installation mode..." -ForegroundColor Green
# Check Git
try {
    $gitVer = git --version
} catch {
    Write-Host "❌ Error: Git is required for remote installation. Please install Git." -ForegroundColor Red
    exit 1
}

$tempDir = Join-Path $env:TEMP "anas-g-lens-temp"
if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host "📦 Cloning Anas G Lens repository..." -ForegroundColor Yellow
git clone https://github.com/anas-projects/anas-g-lens.git $tempDir --depth 1

Push-Location $tempDir

Write-Host "⚙️ Installing dependencies..." -ForegroundColor Yellow
npm install

Write-Host "🏗️ Compiling extension..." -ForegroundColor Yellow
npm run compile

Write-Host "📦 Packaging extension..." -ForegroundColor Yellow
npx @vscode/vsce package --allow-missing-repository

$vsix = Get-ChildItem -Filter "anas-g-lens-*.vsix" | Select-Object -First 1
Write-Host "🔌 Installing extension in VS Code ($($vsix.Name))..." -ForegroundColor Green
code --install-extension $vsix.FullName

Pop-Location
Remove-Item -Recurse -Force $tempDir

Write-Host "✅ Anas G Lens installed successfully! Restart your VS Code editor to activate." -ForegroundColor Green
