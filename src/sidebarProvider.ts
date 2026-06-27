import * as vscode from 'vscode';
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
                case 'replaceComment': {
                    try {
                        const { filePath, lineIndex, originalText, newText } = data;
                        const document = await vscode.workspace.openTextDocument(filePath);
                        
                        // Apply replacement edit
                        const line = document.lineAt(lineIndex);
                        const start = line.text.indexOf(originalText);
                        if (start !== -1) {
                            const range = new vscode.Range(lineIndex, start, lineIndex, start + originalText.length);
                            const workspaceEdit = new vscode.WorkspaceEdit();
                            workspaceEdit.replace(document.uri, range, newText);
                            await vscode.workspace.applyEdit(workspaceEdit);
                            
                            // Re-scan after replacement
                            this.sendActiveFileDetails(document);
                        } else {
                            throw new Error('Comment text not found on the line.');
                        }
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to replace comment: ${err.message}`);
                    }
                    break;
                }
                case 'replaceAllComments': {
                    try {
                        const { filePath, replacements } = data;
                        const document = await vscode.workspace.openTextDocument(filePath);
                        const workspaceEdit = new vscode.WorkspaceEdit();
                        
                        let appliedCount = 0;
                        replacements.forEach((rep: any) => {
                            const line = document.lineAt(rep.lineIndex);
                            const start = line.text.indexOf(rep.originalText);
                            if (start !== -1) {
                                const range = new vscode.Range(rep.lineIndex, start, rep.lineIndex, start + rep.originalText.length);
                                workspaceEdit.replace(document.uri, range, rep.translatedText);
                                appliedCount++;
                            }
                        });

                        if (appliedCount > 0) {
                            await vscode.workspace.applyEdit(workspaceEdit);
                            vscode.window.showInformationMessage(`Translated and replaced ${appliedCount} comments!`);
                            this.sendActiveFileDetails(document);
                        }
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to replace comments: ${err.message}`);
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
                case 'getActiveFile': {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        this.sendActiveFileDetails(editor.document);
                    } else {
                        webviewView.webview.postMessage({
                            command: 'activeFileComments',
                            fileName: 'No file open',
                            filePath: '',
                            results: []
                        });
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
                    
                    // Trigger re-scan of active file if open
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        this.sendActiveFileDetails(editor.document);
                    }
                    break;
                }
            }
        });
    }

    public async sendActiveFileDetails(document: vscode.TextDocument) {
        if (!this._view) return;
        const results = this._scanDocumentForForeignComments(document);
        this._view.webview.postMessage({
            command: 'activeFileComments',
            fileName: vscode.workspace.asRelativePath(document.uri),
            filePath: document.uri.fsPath,
            results: results
        });
    }

    private _scanDocumentForForeignComments(document: vscode.TextDocument): any[] {
        const results: any[] = [];
        const lineCount = document.lineCount;
        for (let i = 0; i < lineCount; i++) {
            const line = document.lineAt(i);
            const commentInfo = this._extractCommentText(line.text);
            if (commentInfo && isForeignText(commentInfo.commentText)) {
                results.push({
                    lineIndex: i,
                    originalText: commentInfo.commentText,
                    fullLine: line.text
                });
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

        /* Language Controls */
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

        /* Tab Content */
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }

        /* ACTIVE FILE TAB */
        .active-file-header {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 10px;
            padding: 10px;
            margin-bottom: 16px;
        }
        .active-file-title {
            font-size: 11px;
            color: #90a4ae;
            text-transform: uppercase;
        }
        .active-file-name {
            font-size: 13px;
            font-weight: 600;
            color: #00e5ff;
            word-break: break-all;
            margin-top: 2px;
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
            width: 100%;
            box-sizing: border-box;
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
        .btn-mini {
            font-size: 10px;
            padding: 4px 8px;
            border-radius: 6px;
            width: auto;
        }

        /* Results list */
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
        .card-line-link {
            color: #00e5ff;
            text-decoration: none;
            cursor: pointer;
            font-weight: 500;
        }
        .card-line-link:hover {
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

        /* TEXT TAB */
        .text-translator-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        textarea {
            width: 100%;
            height: 100px;
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
        <span style="font-size: 11px; color: #90a4ae; flex: 0 0 auto;">To:</span>
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
        <button class="tab-btn active" onclick="switchTab('active-file')">Active File</button>
        <button class="tab-btn" onclick="switchTab('text')">Translator</button>
        <button class="tab-btn" onclick="switchTab('history')">History</button>
    </div>

    <!-- ACTIVE FILE TAB -->
    <div id="tab-active-file" class="tab-content active">
        <div class="active-file-header">
            <div class="active-file-title">Scanning Active File</div>
            <div class="active-file-name" id="active-file-name">Detecting file...</div>
        </div>

        <button class="btn" id="translate-all-btn" style="margin-bottom: 16px; display: none;" onclick="replaceAllComments()">Translate & Replace All In File</button>

        <div id="file-comments-list">
            <div style="color: #607d8b; text-align: center; padding: 20px;">Open a code file to scan.</div>
        </div>
    </div>

    <!-- TEXT TRANSLATOR TAB -->
    <div id="tab-text" class="tab-content">
        <div class="text-translator-container">
            <textarea id="text-input" placeholder="Type or paste foreign text or code comments here..." oninput="autoTranslateText()"></textarea>
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
        let currentFilePath = '';
        let activeComments = [];
        let translationHistory = [];

        // Initial setup
        window.addEventListener('DOMContentLoaded', () => {
            vscode.postMessage({ command: 'getConfig' });
            vscode.postMessage({ command: 'getActiveFile' });
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
                case 'activeFileComments':
                    handleActiveFileComments(message.fileName, message.filePath, message.results);
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

            const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => {
                const text = btn.innerText.toLowerCase().replace(' ', '-');
                return text === tabId;
            });
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

        // Handle Active File Comments
        function handleActiveFileComments(fileName, filePath, results) {
            currentFilePath = filePath;
            activeComments = results;
            
            document.getElementById('active-file-name').innerText = fileName;

            const listContainer = document.getElementById('file-comments-list');
            const translateAllBtn = document.getElementById('translate-all-btn');

            if (!filePath) {
                listContainer.innerHTML = '<div style="color: #607d8b; text-align: center; padding: 20px;">No active file open.</div>';
                translateAllBtn.style.display = 'none';
                return;
            }

            if (results.length === 0) {
                listContainer.innerHTML = '<div style="color: #39ff14; text-align: center; padding: 20px; font-weight: 500;">🎉 Code clean! No foreign comments found.</div>';
                translateAllBtn.style.display = 'none';
                return;
            }

            translateAllBtn.style.display = 'block';

            listContainer.innerHTML = results.map((res, idx) => {
                const escapedText = escapeJS(res.originalText);
                return '<div class="comment-card" id="card-' + idx + '">' +
                    '<div class="card-header">' +
                    '<span class="card-line-link" onclick="openFileToLine(' + res.lineIndex + ')">Line ' + (res.lineIndex + 1) + '</span>' +
                    '</div>' +
                    '<div class="card-text-orig">' + escapeHtml(res.originalText) + '</div>' +
                    '<div class="card-text-trans" id="trans-card-' + idx + '">Translating...</div>' +
                    '<div class="card-actions">' +
                    '<button class="btn btn-outline btn-mini" onclick="translateCard(' + idx + ', \\'' + escapedText + '\\')">Translate</button>' +
                    '<button class="btn btn-mini" id="replace-btn-' + idx + '" style="display: none;" onclick="replaceCard(' + idx + ', ' + res.lineIndex + ', \\'' + escapedText + '\\')">Replace inline</button>' +
                    '</div>' +
                    '</div>';
            }).join('');

            // Auto translate first few to make experience fast
            results.slice(0, 8).forEach((res, idx) => {
                translateCard(idx, res.originalText);
            });
        }

        function translateCard(idx, text) {
            requestTranslation(text, 'card-' + idx);
        }

        function replaceCard(idx, lineIndex, originalText) {
            const transText = document.getElementById('trans-card-' + idx).innerText;
            vscode.postMessage({
                command: 'replaceComment',
                filePath: currentFilePath,
                lineIndex: lineIndex,
                originalText: originalText,
                newText: transText
            });
        }

        async function replaceAllComments() {
            // Collect all resolved translations
            const replacements = [];
            for (let i = 0; i < activeComments.length; i++) {
                const transDiv = document.getElementById('trans-card-' + i);
                if (transDiv && transDiv.innerText !== 'Translating...' && !transDiv.innerText.startsWith('Error:')) {
                    replacements.push({
                        lineIndex: activeComments[i].lineIndex,
                        originalText: activeComments[i].originalText,
                        translatedText: transDiv.innerText
                    });
                }
            }

            if (replacements.length === 0) {
                vscode.postMessage({ command: 'showErrorMessage', message: 'No translated comments ready to replace. Please wait for translations to complete.' });
                return;
            }

            vscode.postMessage({
                command: 'replaceAllComments',
                filePath: currentFilePath,
                replacements: replacements
            });
        }

        function openFileToLine(lineIndex) {
            vscode.postMessage({ command: 'openFileToLine', filePath: currentFilePath, lineIndex: lineIndex });
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
            }
        }

        function handleTranslationError(error, context) {
            if (context === 'manual-text') {
                document.getElementById('text-output').innerText = 'Error: ' + error;
            } else if (context.startsWith('card-')) {
                const idx = context.split('-')[1];
                const transDiv = document.getElementById('trans-card-' + idx);
                if (transDiv) transDiv.innerText = 'Error: ' + error;
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
