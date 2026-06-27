import * as vscode from 'vscode';
import * as fs from 'fs';
import { isForeignText, translateText } from './translator';

export class AnasGLensSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'anas-g-lens-sidebar';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionContext.extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Message listener from webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.command) {
                case 'translateText': {
                    try {
                        const config = vscode.workspace.getConfiguration('anasGLens');
                        const service = config.get<string>('translationService', 'Google Translate (Free Web API)');
                        const translated = await translateText(data.text, data.targetLang, service);
                        webviewView.webview.postMessage({
                            command: 'translationResult',
                            text: data.text,
                            translatedText: translated,
                            context: data.context
                        });
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Translation failed: ${err.message}`);
                        webviewView.webview.postMessage({
                            command: 'translationError',
                            error: err.message,
                            context: data.context
                        });
                    }
                    break;
                }
                case 'getWorkspaceFiles': {
                    const files = await this._getWorkspaceFiles();
                    webviewView.webview.postMessage({
                        command: 'workspaceFilesResult',
                        files: files
                    });
                    break;
                }
                case 'scanFiles': {
                    try {
                        const results = await this._scanFilesForForeignComments(data.files);
                        webviewView.webview.postMessage({
                            command: 'scanFilesResult',
                            results: results
                        });
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Scanning failed: ${err.message}`);
                    }
                    break;
                }
                case 'replaceComment': {
                    try {
                        const { filePath, lineIndex, originalText, newText } = data;
                        const document = await vscode.workspace.openTextDocument(filePath);
                        const editor = await vscode.window.showTextDocument(document);
                        
                        const line = document.lineAt(lineIndex);
                        const start = line.text.indexOf(originalText);
                        if (start !== -1) {
                            const range = new vscode.Range(lineIndex, start, lineIndex, start + originalText.length);
                            await editor.edit(editBuilder => {
                                editBuilder.replace(range, newText);
                            });
                            vscode.window.showInformationMessage('Comment translated and replaced!');
                        } else {
                            throw new Error('Comment text not found on the line.');
                        }
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to replace comment: ${err.message}`);
                    }
                    break;
                }
                case 'openFileToLine': {
                    try {
                        const document = await vscode.workspace.openTextDocument(data.filePath);
                        const editor = await vscode.window.showTextDocument(document);
                        const pos = new vscode.Position(data.lineIndex, 0);
                        editor.selection = new vscode.Selection(pos, pos);
                        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to open file: ${err.message}`);
                    }
                    break;
                }
                case 'getConfig': {
                    const config = vscode.workspace.getConfiguration('anasGLens');
                    const targetLang = config.get<string>('targetLanguage', 'en');
                    webviewView.webview.postMessage({
                        command: 'configResult',
                        targetLanguage: targetLang
                    });
                    break;
                }
                case 'updateTargetLanguage': {
                    const config = vscode.workspace.getConfiguration('anasGLens');
                    await config.update('targetLanguage', data.targetLang, vscode.ConfigurationTarget.Global);
                    break;
                }
            }
        });
    }

    private async _getWorkspaceFiles(): Promise<{ name: string; path: string }[]> {
        const uris = await vscode.workspace.findFiles('**/*.{ts,js,py,cpp,c,java,cs,rs,go,html,css,php,sh,sql}', '**/node_modules/**');
        return uris.map(u => ({
            name: vscode.workspace.asRelativePath(u),
            path: u.fsPath
        })).sort((a, b) => a.name.localeCompare(b.name));
    }

    private async _scanFilesForForeignComments(filePaths: string[]): Promise<any[]> {
        const results: any[] = [];
        
        for (const filePath of filePaths) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.split(/\r?\n/);
                const relativePath = vscode.workspace.asRelativePath(filePath);

                lines.forEach((line, index) => {
                    const commentInfo = this._extractCommentText(line);
                    if (commentInfo && isForeignText(commentInfo.commentText)) {
                        results.push({
                            relativePath: relativePath,
                            filePath: filePath,
                            lineIndex: index,
                            originalText: commentInfo.commentText,
                            fullLine: line
                        });
                    }
                });
            } catch (err) {
                console.error(`Error reading file ${filePath}:`, err);
            }
        }
        return results;
    }

    private _extractCommentText(line: string): { prefix: string; commentText: string } | null {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('//')) {
            return { prefix: '//', commentText: trimmed.substring(2).trim() };
        }
        if (trimmed.startsWith('#')) {
            return { prefix: '#', commentText: trimmed.substring(1).trim() };
        }
        if (trimmed.startsWith('--')) {
            return { prefix: '--', commentText: trimmed.substring(2).trim() };
        }
        if (trimmed.startsWith('*')) {
            if (trimmed.startsWith('*/')) {
                return null;
            }
            return { prefix: '*', commentText: trimmed.substring(1).trim() };
        }
        if (trimmed.startsWith('/*')) {
            let content = trimmed.substring(2);
            if (content.endsWith('*/')) {
                content = content.substring(0, content.length - 2);
            }
            return { prefix: '/*', commentText: content.trim() };
        }
        if (trimmed.startsWith('<!--')) {
            let content = trimmed.substring(4);
            if (content.endsWith('-->')) {
                content = content.substring(0, content.length - 3);
            }
            return { prefix: '<!--', commentText: content.trim() };
        }
        return null;
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Anas G Lens</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
    <style>
        body {
            background-color: #0b0c10;
            color: #eceff1;
            font-family: 'Outfit', sans-serif;
            margin: 0;
            padding: 14px;
            font-size: 13px;
            overflow-x: hidden;
        }

        /* Scrollbar Styling */
        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }
        ::-webkit-scrollbar-track {
            background: #0f1015;
        }
        ::-webkit-scrollbar-thumb {
            background: #2b2d35;
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: #3f4251;
        }

        /* Branding and Header */
        .header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 18px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .header svg {
            width: 28px;
            height: 28px;
            filter: drop-shadow(0 0 6px rgba(0, 229, 255, 0.5));
        }
        .header h1 {
            font-size: 18px;
            margin: 0;
            font-weight: 700;
            background: linear-gradient(135deg, #00e5ff, #39ff14);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        /* Tab Switcher */
        .tabs {
            display: flex;
            background: rgba(255, 255, 255, 0.04);
            border-radius: 12px;
            padding: 4px;
            gap: 4px;
            margin-bottom: 18px;
        }
        .tab-btn {
            flex: 1;
            background: transparent;
            border: none;
            color: #90a4ae;
            font-family: 'Outfit', sans-serif;
            font-size: 11px;
            font-weight: 600;
            padding: 8px 4px;
            cursor: pointer;
            border-radius: 8px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            text-align: center;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .tab-btn:hover {
            color: #eceff1;
            background: rgba(255, 255, 255, 0.03);
        }
        .tab-btn.active {
            color: #00e5ff;
            background: rgba(0, 229, 255, 0.08);
            box-shadow: inset 0 0 0 1px rgba(0, 229, 255, 0.15);
        }

        /* Language Controls (Google Lens Style) */
        .language-selector {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
            background: rgba(255, 255, 255, 0.03);
            padding: 8px 12px;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .lang-select-box {
            flex: 1;
            background: #15181e;
            color: #eceff1;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            padding: 6px;
            font-family: 'Outfit', sans-serif;
            font-size: 12px;
            outline: none;
            cursor: pointer;
            transition: border 0.2s;
        }
        .lang-select-box:focus {
            border-color: #00e5ff;
        }
        .lang-arrow {
            color: #607d8b;
            font-weight: bold;
        }

        /* Tab Content */
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }

        /* LENS TAB: Image Input & Scanning Effect */
        .lens-dropzone {
            border: 2px dashed rgba(0, 229, 255, 0.2);
            border-radius: 16px;
            background: rgba(0, 229, 255, 0.01);
            padding: 30px 10px;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 180px;
        }
        .lens-dropzone:hover {
            border-color: #00e5ff;
            background: rgba(0, 229, 255, 0.03);
            box-shadow: 0 0 12px rgba(0, 229, 255, 0.1);
        }
        .lens-dropzone p {
            margin: 8px 0 0;
            color: #90a4ae;
            font-size: 12px;
        }
        .lens-dropzone svg {
            width: 38px;
            height: 38px;
            stroke: #90a4ae;
            transition: stroke 0.3s;
        }
        .lens-dropzone:hover svg {
            stroke: #00e5ff;
        }
        .lens-preview-container {
            display: none;
            position: relative;
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: #12141a;
            width: 100%;
        }
        .lens-preview {
            width: 100%;
            height: auto;
            display: block;
        }
        
        /* Bounding Boxes overlay */
        .bounding-box {
            position: absolute;
            border: 1.5px solid #39ff14;
            background: rgba(57, 255, 20, 0.1);
            border-radius: 2px;
            cursor: pointer;
            transition: all 0.2s;
            box-shadow: 0 0 4px rgba(57, 255, 20, 0.3);
        }
        .bounding-box:hover {
            border-color: #00e5ff;
            background: rgba(0, 229, 255, 0.25);
            box-shadow: 0 0 8px rgba(0, 229, 255, 0.5);
            z-index: 10;
        }

        /* Scanning Line Animation */
        .scan-bar {
            display: none;
            position: absolute;
            width: 100%;
            height: 4px;
            background: linear-gradient(to right, transparent, #00e5ff, #39ff14, #00e5ff, transparent);
            box-shadow: 0 0 10px #00e5ff, 0 0 20px #39ff14;
            animation: scan 2s linear infinite;
            z-index: 5;
        }
        @keyframes scan {
            0% { top: 0%; }
            50% { top: 100%; }
            100% { top: 0%; }
        }

        /* File Scanner Tab */
        .scanner-controls {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 16px;
        }
        .files-list-container {
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.02);
            max-height: 160px;
            overflow-y: auto;
            padding: 8px;
        }
        .file-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 6px;
            border-radius: 6px;
            cursor: pointer;
            user-select: none;
        }
        .file-item:hover {
            background: rgba(255, 255, 255, 0.04);
        }
        .file-item input {
            cursor: pointer;
            accent-color: #00e5ff;
        }
        .file-item label {
            cursor: pointer;
            font-size: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
        }
        .btn {
            background: linear-gradient(135deg, #00e5ff, #00838f);
            color: #0b0c10;
            border: none;
            font-family: 'Outfit', sans-serif;
            font-weight: 600;
            padding: 10px 14px;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.3s;
            text-align: center;
            font-size: 13px;
        }
        .btn:hover {
            box-shadow: 0 0 12px rgba(0, 229, 255, 0.4);
            transform: translateY(-1px);
        }
        .btn-outline {
            background: transparent;
            color: #00e5ff;
            border: 1.5px solid #00e5ff;
        }
        .btn-outline:hover {
            background: rgba(0, 229, 255, 0.05);
        }

        /* Scan Results */
        .results-section {
            margin-top: 18px;
        }
        .results-title {
            font-weight: 600;
            font-size: 13px;
            margin-bottom: 10px;
            color: #b0bec5;
            display: flex;
            justify-content: space-between;
        }
        .comment-card {
            background: #141720;
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            padding: 10px;
            margin-bottom: 10px;
            transition: border-color 0.2s;
        }
        .comment-card:hover {
            border-color: rgba(0, 229, 255, 0.3);
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
            color: #90a4ae;
            margin-bottom: 6px;
        }
        .card-file-link {
            color: #00e5ff;
            text-decoration: none;
            cursor: pointer;
        }
        .card-file-link:hover {
            text-decoration: underline;
        }
        .card-text-orig {
            font-family: monospace;
            background: rgba(0, 0, 0, 0.2);
            padding: 6px;
            border-radius: 6px;
            margin: 6px 0;
            font-size: 12px;
            word-break: break-all;
            border-left: 3px solid #39ff14;
        }
        .card-text-trans {
            font-size: 12px;
            color: #b2dfdb;
            margin: 8px 0;
            padding-left: 8px;
            border-left: 3px solid #00e5ff;
            font-style: italic;
        }
        .card-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }
        .btn-mini {
            font-size: 10px;
            padding: 4px 8px;
            border-radius: 6px;
        }

        /* TEXT TAB */
        .text-translator-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        textarea {
            width: 100%;
            height: 80px;
            background: #15181e;
            color: #eceff1;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 10px;
            padding: 10px;
            font-family: 'Outfit', sans-serif;
            font-size: 13px;
            box-sizing: border-box;
            resize: none;
            outline: none;
        }
        textarea:focus {
            border-color: #00e5ff;
        }
        .text-output {
            background: #141720;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 10px;
            padding: 10px;
            min-height: 60px;
            font-size: 13px;
            color: #00ffc4;
            font-style: italic;
        }

        /* HISTORY TAB */
        .history-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .history-item {
            background: rgba(255, 255, 255, 0.01);
            border: 1px solid rgba(255, 255, 255, 0.04);
            border-radius: 8px;
            padding: 8px;
        }
        .history-orig {
            font-size: 11px;
            color: #90a4ae;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .history-trans {
            font-size: 12px;
            color: #00e5ff;
            font-weight: 500;
        }

        /* Status & Tooltip styles */
        .ocr-status {
            font-size: 11px;
            color: #ffb300;
            margin-top: 8px;
            text-align: center;
        }
        .translation-tooltip {
            margin-top: 10px;
            background: rgba(0, 229, 255, 0.1);
            border: 1.5px solid #00e5ff;
            border-radius: 10px;
            padding: 10px;
            box-shadow: 0 0 10px rgba(0, 229, 255, 0.2);
            display: none;
        }
        .tooltip-title {
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #00e5ff;
            margin-bottom: 4px;
        }
        .tooltip-text {
            font-size: 13px;
            color: #fff;
            line-height: 1.4;
        }
        .tess-box-wrap {
            position: relative;
            width: 100%;
        }
    </style>
</head>
<body>
    <div class="header">
        <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="none" stroke="#00e5ff" stroke-width="2" />
            <circle cx="12" cy="12" r="6" fill="none" stroke="#39ff14" stroke-width="1.5" />
            <circle cx="12" cy="12" r="2" fill="#00e5ff" />
        </svg>
        <h1>Anas G Lens</h1>
    </div>

    <!-- Language Selector Bar -->
    <div class="language-selector">
        <span style="font-size: 11px; color: #90a4ae;">To:</span>
        <select id="target-language" class="lang-select-box">
            <option value="en">English (US)</option>
            <option value="es">Spanish (Español)</option>
            <option value="ur">Urdu (اردو)</option>
            <option value="zh-CN">Chinese (Simplified)</option>
            <option value="fr">French (Français)</option>
            <option value="de">German (Deutsch)</option>
            <option value="ru">Russian (Русский)</option>
            <option value="hi">Hindi (हिन्दी)</option>
        </select>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs">
        <button class="tab-btn active" onclick="switchTab('lens')">Scan Lens</button>
        <button class="tab-btn" onclick="switchTab('files')">Files Scanner</button>
        <button class="tab-btn" onclick="switchTab('text')">Translator</button>
        <button class="tab-btn" onclick="switchTab('history')">History</button>
    </div>

    <!-- LENS TAB -->
    <div id="tab-lens" class="tab-content active">
        <div class="lens-dropzone" id="dropzone" onclick="triggerImageUpload()">
            <svg fill="none" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
            </svg>
            <p>Drag & Drop Image here</p>
            <p style="font-size: 10px; color: #607d8b;">or Paste Screenshot or Click to Browse</p>
        </div>
        <input type="file" id="file-input" style="display: none;" accept="image/*" onchange="handleImageFile(event)">
        
        <div class="lens-preview-container" id="preview-container">
            <div class="scan-bar" id="scan-bar"></div>
            <div class="tess-box-wrap" id="tess-box-wrap">
                <img class="lens-preview" id="lens-preview" src="" alt="preview">
            </div>
        </div>

        <div id="ocr-status" class="ocr-status"></div>

        <div class="translation-tooltip" id="lens-tooltip">
            <div class="tooltip-title" id="tooltip-title">Translation</div>
            <div class="tooltip-text" id="tooltip-text">Hover or click a green bounding box to see the translation.</div>
        </div>
    </div>

    <!-- FILE SCANNER TAB -->
    <div id="tab-files" class="tab-content">
        <div class="scanner-controls">
            <button class="btn btn-outline btn-mini" style="align-self: flex-end;" onclick="refreshFilesList()">Refresh File List</button>
            <div class="files-list-container" id="files-list">
                <div style="color: #90a4ae; text-align: center; padding: 20px;">Loading files...</div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn" style="flex: 2;" onclick="scanSelectedFiles()">Scan Selected Files</button>
                <button class="btn btn-outline" style="flex: 1;" onclick="toggleSelectAllFiles()">All/None</button>
            </div>
        </div>

        <div class="results-section">
            <div class="results-title">
                <span>Scan Results</span>
                <span id="results-count" style="color: #00e5ff;">0 matches</span>
            </div>
            <div id="scan-results-list">
                <div style="color: #607d8b; text-align: center; padding: 20px;">No files scanned yet.</div>
            </div>
        </div>
    </div>

    <!-- TEXT TRANSLATOR TAB -->
    <div id="tab-text" class="tab-content">
        <div class="text-translator-container">
            <textarea id="text-input" placeholder="Type or paste foreign code comments here..." oninput="autoTranslateText()"></textarea>
            <div style="font-weight: 600; color: #90a4ae; margin-top: 4px;">English Translation</div>
            <div class="text-output" id="text-output">Translation will appear here...</div>
        </div>
    </div>

    <!-- HISTORY TAB -->
    <div id="tab-history" class="tab-content">
        <div class="history-list" id="history-list">
            <div style="color: #607d8b; text-align: center; padding: 20px;">No translation history yet.</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let targetLanguage = 'en';
        let uploadFiles = [];
        let translationHistory = [];

        // Initial setup
        window.addEventListener('DOMContentLoaded', () => {
            vscode.postMessage({ command: 'getConfig' });
            vscode.postMessage({ command: 'getWorkspaceFiles' });
            loadHistory();
        });

        // Handle Messages from VS Code Extension Host
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'configResult':
                    targetLanguage = message.targetLanguage;
                    document.getElementById('target-language').value = targetLanguage;
                    break;
                case 'workspaceFilesResult':
                    displayWorkspaceFiles(message.files);
                    break;
                case 'scanFilesResult':
                    displayScanResults(message.results);
                    break;
                case 'translationResult':
                    handleTranslationResult(message.text, message.translatedText, message.context);
                    break;
                case 'translationError':
                    handleTranslationError(message.error, message.context);
                    break;
            }
        });

        // Tab Switching
        function switchTab(tabId) {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => btn.innerText.toLowerCase().includes(tabId));
            if (activeBtn) activeBtn.classList.add('active');
            
            document.getElementById('tab-' + tabId).classList.add('active');
        }

        // Language update
        document.getElementById('target-language').addEventListener('change', (e) => {
            targetLanguage = e.target.value;
            vscode.postMessage({ command: 'updateTargetLanguage', targetLang: targetLanguage });
            
            // Re-translate current inputs if applicable
            const textInput = document.getElementById('text-input').value;
            if (textInput.trim()) {
                requestTranslation(textInput, 'manual-text');
            }
        });

        // Paste support for Lens Tab
        document.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const blob = items[i].getAsFile();
                    const reader = new FileReader();
                    reader.onload = function(event) {
                        processLensImage(event.target.result);
                    };
                    reader.readAsDataURL(blob);
                }
            }
        });

        // Dropzone Support
        const dropzone = document.getElementById('dropzone');
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#39ff14';
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = 'rgba(0, 229, 255, 0.2)';
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'rgba(0, 229, 255, 0.2)';
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    processLensImage(event.target.result);
                };
                reader.readAsDataURL(files[0]);
            }
        });

        function triggerImageUpload() {
            document.getElementById('file-input').click();
        }

        function handleImageFile(event) {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    processLensImage(e.target.result);
                };
                reader.readAsDataURL(file);
            }
        }

        // OCR Processing (Google Lens Theme)
        async function processLensImage(dataUrl) {
            // Setup UI for scanning
            document.getElementById('dropzone').style.display = 'none';
            const previewContainer = document.getElementById('preview-container');
            previewContainer.style.display = 'block';
            
            const preview = document.getElementById('lens-preview');
            preview.src = dataUrl;

            // Clear previous bounding boxes
            const wrap = document.getElementById('tess-box-wrap');
            wrap.querySelectorAll('.bounding-box').forEach(el => el.remove());
            
            document.getElementById('scan-bar').style.display = 'block';
            document.getElementById('ocr-status').innerText = 'Initializing Lens Scanner...';
            document.getElementById('lens-tooltip').style.display = 'none';

            try {
                // Initialize Tesseract.js inside webview
                const worker = await Tesseract.createWorker('eng+chi_sim+chi_tra+spa+rus+fra+deu');
                document.getElementById('ocr-status').innerText = 'Scanning text & characters...';
                
                const ret = await worker.recognize(dataUrl);
                await worker.terminate();

                document.getElementById('scan-bar').style.display = 'none';
                document.getElementById('ocr-status').innerText = '';

                const imgWidth = preview.clientWidth;
                const imgHeight = preview.clientHeight;
                
                // Get native dimensions of image
                const img = new Image();
                img.src = dataUrl;
                img.onload = () => {
                    const natWidth = img.naturalWidth;
                    const natHeight = img.naturalHeight;
                    const scaleX = imgWidth / natWidth;
                    const scaleY = imgHeight / natHeight;
                    
                    const words = ret.data.words;
                    let foreignWordsCount = 0;

                    words.forEach((word, idx) => {
                        if (word.text.trim().length < 2) return;
                        
                        const isForeign = /[^\x00-\x7F]/.test(word.text);
                        if (isForeign) foreignWordsCount++;

                        const box = word.bbox;
                        const div = document.createElement('div');
                        div.className = 'bounding-box';
                        div.style.left = (box.x0 * scaleX) + 'px';
                        div.style.top = (box.y0 * scaleY) + 'px';
                        div.style.width = ((box.x1 - box.x0) * scaleX) + 'px';
                        div.style.height = ((box.y1 - box.y0) * scaleY) + 'px';
                        div.title = word.text;
                        
                        const contextId = 'lens-word-' + idx;
                        div.addEventListener('mouseenter', () => {
                            showTooltipLoading(word.text);
                            requestTranslation(word.text, contextId);
                        });

                        wrap.appendChild(div);
                    });

                    document.getElementById('ocr-status').innerText = 'Detected ' + words.length + ' words (' + foreignWordsCount + ' foreign). Hover to see translation!';
                    document.getElementById('lens-tooltip').style.display = 'block';
                };
            } catch (err) {
                console.error(err);
                document.getElementById('scan-bar').style.display = 'none';
                document.getElementById('ocr-status').innerText = 'OCR Failed: ' + err.message;
            }
        }

        function showTooltipLoading(originalText) {
            document.getElementById('tooltip-title').innerText = 'Google Lens (Translating...)';
            document.getElementById('tooltip-text').innerText = '"' + originalText + '"';
        }

        // File list loading and scanning
        function displayWorkspaceFiles(files) {
            uploadFiles = files;
            const container = document.getElementById('files-list');
            if (files.length === 0) {
                container.innerHTML = '<div style="color: #607d8b; text-align: center; padding: 20px;">No source files found in workspace.</div>';
                return;
            }

            container.innerHTML = files.map(file => {
                return '<div class="file-item">' +
                    '<input type="checkbox" id="file-' + file.path + '" value="' + file.path + '" checked>' +
                    '<label for="file-' + file.path + '" title="' + file.name + '">' + file.name + '</label>' +
                    '</div>';
            }).join('');
        }

        function toggleSelectAllFiles() {
            const checkboxes = document.getElementById('files-list').querySelectorAll('input[type="checkbox"]');
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            checkboxes.forEach(cb => cb.checked = !allChecked);
        }

        function scanSelectedFiles() {
            const checkboxes = document.getElementById('files-list').querySelectorAll('input[type="checkbox"]:checked');
            const selectedFiles = Array.from(checkboxes).map(cb => cb.value);
            if (selectedFiles.length === 0) {
                vscode.postMessage({ command: 'showErrorMessage', message: 'Please select at least one file.' });
                return;
            }

            document.getElementById('scan-results-list').innerHTML = '<div style="color: #90a4ae; text-align: center; padding: 20px;">Scanning files...</div>';
            vscode.postMessage({ command: 'scanFiles', files: selectedFiles });
        }

        function displayScanResults(results) {
            const count = document.getElementById('results-count');
            count.innerText = results.length + ' matches';

            const container = document.getElementById('scan-results-list');
            if (results.length === 0) {
                container.innerHTML = '<div style="color: #39ff14; text-align: center; padding: 20px;">🎉 Clean code! No foreign comments found.</div>';
                return;
            }

            container.innerHTML = results.map((res, idx) => {
                const escapedPath = res.filePath.replace(/\\\\/g, '\\\\').replace(/'/g, "\\\\'");
                const escapedText = escapeJS(res.originalText);
                return '<div class="comment-card" id="card-' + idx + '">' +
                    '<div class="card-header">' +
                    '<span class="card-file-link" onclick="openFileToLine(\\'' + escapedPath + '\\', ' + res.lineIndex + ')">' + res.relativePath + ':L' + (res.lineIndex + 1) + '</span>' +
                    '</div>' +
                    '<div class="card-text-orig">' + escapeHtml(res.originalText) + '</div>' +
                    '<div class="card-text-trans" id="trans-card-' + idx + '">Translating...</div>' +
                    '<div class="card-actions">' +
                    '<button class="btn btn-outline btn-mini" onclick="translateCard(' + idx + ', \\'' + escapedText + '\\')">Translate</button>' +
                    '<button class="btn btn-mini" id="replace-btn-' + idx + '" style="display: none;" onclick="replaceCard(' + idx + ', \\'' + escapedPath + '\\', ' + res.lineIndex + ', \\'' + escapedText + '\\')">Replace Comment</button>' +
                    '</div>' +
                    '</div>';
            }).join('');

            results.slice(0, 5).forEach((res, idx) => {
                translateCard(idx, res.originalText);
            });
        }

        function translateCard(idx, text) {
            requestTranslation(text, 'card-' + idx);
        }

        function replaceCard(idx, filePath, lineIndex, originalText) {
            const transText = document.getElementById('trans-card-' + idx).innerText;
            vscode.postMessage({
                command: 'replaceComment',
                filePath: filePath,
                lineIndex: lineIndex,
                originalText: originalText,
                newText: transText
            });
        }

        function openFileToLine(filePath, lineIndex) {
            vscode.postMessage({ command: 'openFileToLine', filePath: filePath, lineIndex: lineIndex });
        }

        function refreshFilesList() {
            document.getElementById('files-list').innerHTML = '<div style="color: #90a4ae; text-align: center; padding: 20px;">Loading files...</div>';
            vscode.postMessage({ command: 'getWorkspaceFiles' });
        }

        // Manual Text Translator
        let translateTimeout;
        function autoTranslateText() {
            clearTimeout(translateTimeout);
            const text = document.getElementById('text-input').value;
            if (!text.trim()) {
                document.getElementById('text-output').innerText = 'Translation will appear here...';
                return;
            }
            document.getElementById('text-output').innerText = 'Translating...';
            
            translateTimeout = setTimeout(() => {
                requestTranslation(text, 'manual-text');
            }, 500);
        }

        // Generic API Helper
        function requestTranslation(text, context) {
            vscode.postMessage({
                command: 'translateText',
                text: text,
                targetLang: targetLanguage,
                context: context
            });
        }

        // History Management
        function handleTranslationResult(text, translatedText, context) {
            addToHistory(text, translatedText);

            if (context === 'manual-text') {
                document.getElementById('text-output').innerText = translatedText;
            } else if (context.startsWith('card-')) {
                const idx = context.split('-')[1];
                const transDiv = document.getElementById('trans-card-' + idx);
                if (transDiv) {
                    transDiv.innerText = translatedText;
                    document.getElementById('replace-btn-' + idx).style.display = 'block';
                }
            } else if (context.startsWith('lens-word-')) {
                document.getElementById('tooltip-title').innerText = 'Google Lens Translation:';
                document.getElementById('tooltip-text').innerText = translatedText;
            }
        }

        function handleTranslationError(error, context) {
            if (context === 'manual-text') {
                document.getElementById('text-output').innerText = 'Error: ' + error;
            } else if (context.startsWith('card-')) {
                const idx = context.split('-')[1];
                const transDiv = document.getElementById('trans-card-' + idx);
                if (transDiv) transDiv.innerText = 'Error: ' + error;
            } else if (context.startsWith('lens-word-')) {
                document.getElementById('tooltip-title').innerText = 'Translation Error';
                document.getElementById('tooltip-text').innerText = error;
            }
        }

        function addToHistory(orig, trans) {
            if (translationHistory.some(h => h.orig === orig && h.trans === trans)) return;

            translationHistory.unshift({ orig, trans });
            if (translationHistory.length > 20) translationHistory.pop();
            
            localStorage.setItem('translation_history', JSON.stringify(translationHistory));
            displayHistory();
        }

        function loadHistory() {
            const saved = localStorage.getItem('translation_history');
            if (saved) {
                translationHistory = JSON.parse(saved);
                displayHistory();
            }
        }

        function displayHistory() {
            const container = document.getElementById('history-list');
            if (translationHistory.length === 0) {
                container.innerHTML = '<div style="color: #607d8b; text-align: center; padding: 20px;">No translation history yet.</div>';
                return;
            }

            container.innerHTML = translationHistory.map(item => {
                return '<div class="history-item">' +
                    '<div class="history-orig" title="' + escapeHtml(item.orig) + '">' + escapeHtml(item.orig) + '</div>' +
                    '<div class="history-trans">' + escapeHtml(item.trans) + '</div>' +
                    '</div>';
            }).join('');
        }

        // Utilities
        function escapeHtml(text) {
            return text
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function escapeJS(text) {
            return text
                .replace(/\\\\/g, '\\\\\\\\')
                .replace(/'/g, "\\\\'")
                .replace(/"/g, '\\\\"')
                .replace(/\\n/g, '\\\\n')
                .replace(/\\r/g, '\\\\r');
        }
    </script>
</body>
</html>
`
    }
}
