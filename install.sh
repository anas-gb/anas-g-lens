#!/usr/bin/env bash
set -e

echo "🚀 Starting Anas G Lens installer..."

# Check dependencies
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Error: Node.js is not installed. Please install Node.js (v16.0+) first."
    exit 1
fi

if ! command -v code >/dev/null 2>&1; then
    echo "❌ Error: VS Code CLI ('code') is not installed or not in PATH."
    echo "   In VS Code, open the Command Palette (Cmd/Ctrl+Shift+P) and run:"
    echo "   'Shell Command: Install 'code' command in PATH'"
    exit 1
fi

# Detect if we are already in the project directory
if [ -f "package.json" ] && grep -q '"name": "anas-g-lens"' package.json; then
    echo "📂 Running installation from local repository directory..."
    
    echo "⚙️ Installing dependencies..."
    npm install
    
    echo "🏗️ Compiling extension..."
    npm run compile
    
    echo "📦 Packaging extension..."
    npx @vscode/vsce package --allow-missing-repository
    
    VSIX_FILE=$(ls anas-g-lens-*.vsix)
    echo "🔌 Installing extension locally ($VSIX_FILE)..."
    code --install-extension "$VSIX_FILE"
else
    echo "🌐 Remote installation mode..."
    TEMP_DIR=$(mktemp -d)
    
    echo "📦 Cloning Anas G Lens repository..."
    if ! command -v git >/dev/null 2>&1; then
        echo "❌ Error: Git is required for remote installation. Please install Git."
        exit 1
    fi
    
    git clone https://github.com/anas-projects/anas-g-lens.git "$TEMP_DIR" --depth 1
    cd "$TEMP_DIR"
    
    echo "⚙️ Installing dependencies..."
    npm install
    
    echo "🏗️ Compiling extension..."
    npm run compile
    
    echo "📦 Packaging extension..."
    npx @vscode/vsce package --allow-missing-repository
    
    VSIX_FILE=$(ls anas-g-lens-*.vsix)
    echo "🔌 Installing extension in VS Code ($VSIX_FILE)..."
    code --install-extension "$VSIX_FILE"
    
    echo "🧹 Cleaning up temporary files..."
    cd - > /dev/null
    rm -rf "$TEMP_DIR"
fi

echo "✅ Anas G Lens installed successfully! Restart your VS Code editor to activate."
