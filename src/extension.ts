import * as vscode from 'vscode';
import { isForeignText, translateText } from './translator';

// Cache for translations to prevent redundant API calls
const translationCache = new Map<string, string>();

// Store active inline decorations to manage and clear them
const activeDecorations = new Map<string, { decorationType: vscode.TextEditorDecorationType; range: vscode.Range }[]>();

export function activate(context: vscode.ExtensionContext) {
    console.log('Anas G Lens extension is now active!');

    // Hover Provider
    const hoverProvider = vscode.languages.registerHoverProvider('*', {
        async provideHover(document, position, token) {
            const config = vscode.workspace.getConfiguration('anasGLens');
            const enableHover = config.get<boolean>('enableHoverTranslation', true);
            if (!enableHover) {
                return undefined;
            }

            const line = document.lineAt(position.line);
            const lineText = line.text;

            // Extract comment text from the line
            const commentInfo = extractCommentText(lineText);
            if (!commentInfo) {
                return undefined;
            }

            const { commentText } = commentInfo;
            if (!isForeignText(commentText)) {
                return undefined;
            }

            // Get target language and service
            const targetLang = config.get<string>('targetLanguage', 'en');
            const service = config.get<string>('translationService', 'Google Translate (Free Web API)');

            const cacheKey = `${targetLang}:${service}:${commentText}`;
            let translated = translationCache.get(cacheKey);

            if (!translated) {
                try {
                    translated = await translateText(commentText, targetLang, service);
                    translationCache.set(cacheKey, translated);
                } catch (err: any) {
                    return new vscode.Hover(`⚠️ *Anas G Lens Error:* ${err.message || err}`);
                }
            }

            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.appendMarkdown(`**🌐 Anas G Lens (${targetLang.toUpperCase()}):**\n\n`);
            markdown.appendMarkdown(`> *${translated}*\n`);
            return new vscode.Hover(markdown);
        }
    });
    context.subscriptions.push(hoverProvider);

    // CodeLens Provider
    const codeLensProvider = vscode.languages.registerCodeLensProvider('*', {
        provideCodeLenses(document, token) {
            const config = vscode.workspace.getConfiguration('anasGLens');
            const enableCodeLens = config.get<boolean>('enableCodeLens', true);
            if (!enableCodeLens) {
                return [];
            }

            const codeLenses: vscode.CodeLens[] = [];
            const lineCount = document.lineCount;

            for (let i = 0; i < lineCount; i++) {
                const line = document.lineAt(i);
                const commentInfo = extractCommentText(line.text);
                if (commentInfo && isForeignText(commentInfo.commentText)) {
                    const range = new vscode.Range(i, 0, i, line.text.length);
                    const codeLens = new vscode.CodeLens(range, {
                        title: '🌐 Translate',
                        command: 'anas-g-lens.showInlineTranslation',
                        arguments: [document.uri.toString(), i, commentInfo.commentText]
                    });
                    codeLenses.push(codeLens);
                }
            }

            return codeLenses;
        }
    });
    context.subscriptions.push(codeLensProvider);

    // Command: Show Inline Translation (from CodeLens)
    const showInlineTranslationCmd = vscode.commands.registerCommand(
        'anas-g-lens.showInlineTranslation',
        async (uriStr: string, lineIndex: number, text: string) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.uri.toString() !== uriStr) {
                return;
            }

            const config = vscode.workspace.getConfiguration('anasGLens');
            const targetLang = config.get<string>('targetLanguage', 'en');
            const service = config.get<string>('translationService', 'Google Translate (Free Web API)');

            const cacheKey = `${targetLang}:${service}:${text}`;
            let translated = translationCache.get(cacheKey);

            // Set temporary loading decoration
            const loadingDecoration = vscode.window.createTextEditorDecorationType({
                after: {
                    contentText: ' 🌐 Translating...',
                    color: new vscode.ThemeColor('editorGhostText.foreground'),
                    fontStyle: 'italic',
                    margin: '0 0 0 1em'
                }
            });
            const lineRange = new vscode.Range(lineIndex, 0, lineIndex, editor.document.lineAt(lineIndex).text.length);
            editor.setDecorations(loadingDecoration, [lineRange]);

            try {
                if (!translated) {
                    translated = await translateText(text, targetLang, service);
                    translationCache.set(cacheKey, translated);
                }

                // Clear loading decoration
                loadingDecoration.dispose();

                // Create stable inline decoration
                const translationDecoration = vscode.window.createTextEditorDecorationType({
                    after: {
                        contentText: ` ➔ ${translated}`,
                        color: new vscode.ThemeColor('editorGhostText.foreground'),
                        fontStyle: 'italic',
                        margin: '0 0 0 1em'
                    }
                });

                editor.setDecorations(translationDecoration, [lineRange]);

                // Store decoration to dispose later
                const key = editor.document.uri.toString();
                if (!activeDecorations.has(key)) {
                    activeDecorations.set(key, []);
                }
                activeDecorations.get(key)!.push({
                    decorationType: translationDecoration,
                    range: lineRange
                });
            } catch (err: any) {
                loadingDecoration.dispose();
                vscode.window.showErrorMessage(`Translation failed: ${err.message || err}`);
            }
        }
    );
    context.subscriptions.push(showInlineTranslationCmd);

    // Command: Translate Selected Text
    const translateSelectionCmd = vscode.commands.registerCommand(
        'anas-g-lens.translateSelection',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);
            if (!selectedText.trim()) {
                vscode.window.showInformationMessage('Please select some text first.');
                return;
            }

            const config = vscode.workspace.getConfiguration('anasGLens');
            const targetLang = config.get<string>('targetLanguage', 'en');
            const service = config.get<string>('translationService', 'Google Translate (Free Web API)');

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Translating selection...",
                cancellable: false
            }, async () => {
                try {
                    const translated = await translateText(selectedText, targetLang, service);
                    const action = await vscode.window.showInformationMessage(
                        `Translation:\n"${translated}"`,
                        'Replace Selection',
                        'Insert Below',
                        'Close'
                    );

                    if (action === 'Replace Selection') {
                        editor.edit(editBuilder => {
                            editBuilder.replace(selection, translated);
                        });
                    } else if (action === 'Insert Below') {
                        editor.edit(editBuilder => {
                            editBuilder.insert(selection.end, `\n// Translation: ${translated}`);
                        });
                    }
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Translation failed: ${err.message || err}`);
                }
            });
        }
    );
    context.subscriptions.push(translateSelectionCmd);

    // Command: Translate All Comments in File
    const translateFileCommentsCmd = vscode.commands.registerCommand(
        'anas-g-lens.translateFileComments',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const document = editor.document;
            const lineCount = document.lineCount;
            const commentsToTranslate: { lineIndex: number; text: string; range: vscode.Range }[] = [];

            for (let i = 0; i < lineCount; i++) {
                const line = document.lineAt(i);
                const commentInfo = extractCommentText(line.text);
                if (commentInfo && isForeignText(commentInfo.commentText)) {
                    commentsToTranslate.push({
                        lineIndex: i,
                        text: commentInfo.commentText,
                        range: new vscode.Range(i, 0, i, line.text.length)
                    });
                }
            }

            if (commentsToTranslate.length === 0) {
                vscode.window.showInformationMessage('No foreign comments found in the active file.');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Found ${commentsToTranslate.length} foreign comments. Do you want to translate and replace them in-place?`,
                'Yes, Replace inline',
                'No, Cancel'
            );

            if (confirm !== 'Yes, Replace inline') {
                return;
            }

            const config = vscode.workspace.getConfiguration('anasGLens');
            const targetLang = config.get<string>('targetLanguage', 'en');
            const service = config.get<string>('translationService', 'Google Translate (Free Web API)');

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Translating file comments...",
                cancellable: false
            }, async (progress) => {
                let successCount = 0;
                
                // Let's resolve translations in parallel
                try {
                    const promises = commentsToTranslate.map(async (item) => {
                        const cacheKey = `${targetLang}:${service}:${item.text}`;
                        let translated = translationCache.get(cacheKey);
                        if (!translated) {
                            translated = await translateText(item.text, targetLang, service);
                            translationCache.set(cacheKey, translated);
                        }
                        return { item, translated };
                    });

                    const results = await Promise.all(promises);

                    // Apply edits in a workspace edit block to bundle undo/redo
                    const workspaceEdit = new vscode.WorkspaceEdit();
                    for (const { item, translated } of results) {
                        const lineText = document.lineAt(item.lineIndex).text;
                        // Reconstruct line keeping the comment prefix
                        const commentInfo = extractCommentText(lineText);
                        if (commentInfo) {
                            const newCommentLine = lineText.replace(commentInfo.commentText, ` ${translated}`);
                            workspaceEdit.replace(document.uri, item.range, newCommentLine);
                            successCount++;
                        }
                    }

                    await vscode.workspace.applyEdit(workspaceEdit);
                    vscode.window.showInformationMessage(`Successfully translated ${successCount} comments!`);
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Batch translation failed: ${err.message || err}`);
                }
            });
        }
    );
    context.subscriptions.push(translateFileCommentsCmd);

    // Command: Toggle Hover Translation
    const toggleHoverCmd = vscode.commands.registerCommand(
        'anas-g-lens.toggleHoverTranslation',
        async () => {
            const config = vscode.workspace.getConfiguration('anasGLens');
            const current = config.get<boolean>('enableHoverTranslation', true);
            await config.update('enableHoverTranslation', !current, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Hover translation is now ${!current ? 'ENABLED' : 'DISABLED'}.`);
        }
    );
    context.subscriptions.push(toggleHoverCmd);

    // Clear active decorations when document is edited or closed
    const changeDocDisposable = vscode.workspace.onDidChangeTextDocument(event => {
        const key = event.document.uri.toString();
        const decs = activeDecorations.get(key);
        if (decs) {
            decs.forEach(d => d.decorationType.dispose());
            activeDecorations.delete(key);
        }
    });
    context.subscriptions.push(changeDocDisposable);

    const closeDocDisposable = vscode.workspace.onDidCloseTextDocument(doc => {
        const key = doc.uri.toString();
        const decs = activeDecorations.get(key);
        if (decs) {
            decs.forEach(d => d.decorationType.dispose());
            activeDecorations.delete(key);
        }
    });
    context.subscriptions.push(closeDocDisposable);
}

export function deactivate() {
    activeDecorations.forEach(decs => {
        decs.forEach(d => d.decorationType.dispose());
    });
    activeDecorations.clear();
}

function extractCommentText(line: string): { prefix: string; commentText: string } | null {
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
