const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk').default;

const MODEL = 'openai/gpt-oss-120b';
const SECRET_KEY = 'codescale-ai.groqApiKey';

function activate(context) {
    const output = vscode.window.createOutputChannel('CodeScale AI');
    context.subscriptions.push(output);

    function errorText(error) {
        return error instanceof Error ? error.message : String(error);
    }

    function fileName(uri) {
        return uri.fsPath.split(/[\\/]/).pop() || 'untitled';
    }

    function getClient(apiKey) {
        return new Groq({ apiKey });
    }

    function languageFromName(name) {
        const ext = name.split('.').pop()?.toLowerCase();

        const languages = {
            py: 'python', html: 'html', css: 'css',
            js: 'javascript', ts: 'typescript', json: 'json',
            csv: 'csv', txt: 'plaintext', java: 'java',
            sql: 'sql', md: 'markdown', xml: 'xml'
        };

        return languages[ext] || 'plaintext';
    }

    // ---------------------------------------------------------------
    // Python analysis engine (analyzer/analyzer.py)
    // ---------------------------------------------------------------

    function enginePython() {
        const root = context.extensionPath;

        const venvPython = process.platform === 'win32'
            ? path.join(root, '.venv', 'Scripts', 'python.exe')
            : path.join(root, '.venv', 'bin', 'python');

        if (fs.existsSync(venvPython)) {
            return { command: venvPython, args: [] };
        }

        return { command: 'uv', args: ['run', 'python'] };
    }

    function runEngine(filePath) {
        const engine = enginePython();
        const script = path.join(context.extensionPath, 'analyzer', 'analyzer.py');

        return new Promise((resolve, reject) => {
            cp.execFile(
                engine.command,
                [...engine.args, script, filePath],
                {
                    cwd: context.extensionPath,
                    timeout: 30000,
                    maxBuffer: 10 * 1024 * 1024,
                    encoding: 'utf8'
                },
                (error, stdout, stderr) => {
                    if (error && !stdout) {
                        if (error.code === 'ENOENT') {
                            reject(new Error(
                                'Could not start the Python engine. ' +
                                'In the project folder, run: uv sync'
                            ));
                            return;
                        }

                        const detail = (stderr || error.message || '').trim().slice(0, 400);
                        reject(new Error('The Python engine failed. ' + detail));
                        return;
                    }

                    try {
                        resolve(JSON.parse(stdout));
                    } catch {
                        const detail = (stderr || '').trim().slice(0, 300);
                        reject(new Error(
                            'The Python engine returned output that is not valid JSON. ' +
                            detail
                        ));
                    }
                }
            );
        });
    }

    async function analyzeFile(uri) {
        if (!uri || uri.scheme !== 'file') {
            throw new Error('Open a saved Python file first.');
        }

        if (!uri.fsPath.toLowerCase().endsWith('.py')) {
            throw new Error(
                `${fileName(uri)} is not a Python file. The analyzer supports .py files only.`
            );
        }

        // The engine reads the file from disk, so save unsaved edits first.
        const open = vscode.workspace.textDocuments.find(
            document => document.uri.toString() === uri.toString()
        );

        if (open && open.isDirty) {
            await open.save();
        }

        const data = await runEngine(uri.fsPath);

        if (data.status !== 'success') {
            const where = data.line ? ` (line ${data.line})` : '';
            throw new Error(`${data.error || 'Analysis failed'}${where}`);
        }

        return data;
    }

    function reportAnalysis(name, data) {
        const functions = data.functions || [];
        let total = 0;

        output.appendLine('='.repeat(60));
        output.appendLine(`Analysis of ${name}`);
        output.appendLine('='.repeat(60));

        if (!functions.length) {
            output.appendLine('No functions found in this file.');
        }

        for (const fn of functions) {
            output.appendLine('');
            output.appendLine(`${fn.function}()  (line ${fn.line})`);
            output.appendLine(`  Time:  ${fn.time_complexity_estimate}`);
            output.appendLine(`  Space: ${fn.auxiliary_space_estimate}`);

            if (!fn.findings.length) {
                output.appendLine('  No findings.');
            }

            for (const finding of fn.findings) {
                total++;
                output.appendLine(
                    `  [${finding.severity.toUpperCase()}] line ${finding.line}: ${finding.category}`
                );
                output.appendLine(`      ${finding.message}`);
                output.appendLine(`      Suggestion: ${finding.suggestion}`);
            }
        }

        output.appendLine('');

        return `${total} finding(s) in ${functions.length} function(s) of ${name}.`;
    }

    async function askAI(task, targetName, currentCode, attachments, multiFile) {
        const apiKey = await context.secrets.get(SECRET_KEY);

        if (!apiKey) {
            throw new Error('Run CodeScale AI: Set Groq API Key first.');
        }

        const attachedText = attachments.map(item =>
            `ATTACHMENT: ${item.name}\n${item.content}`
        ).join('\n\n');

        const systemPrompt = multiFile
            ? `You are CodeScale AI, a careful coding agent.
Return ONLY valid JSON in exactly this format:
{
  "files": [
    {
      "path": "folder/file.html",
      "content": "complete file contents"
    }
  ]
}
Create every file requested by the user. Include separate HTML and CSS files when requested, and link them correctly. Paths must be relative to the requested output folder. Do not use Markdown fences. Do not include explanations outside JSON. Do not invent database functionality.`
            : `You are CodeScale AI, a careful coding agent.
Return ONLY the complete contents of the selected target file.
Do not return Markdown fences or explanations.
Do not create another file instead of the selected target.
Preserve existing functionality unless the user asks to change it.
For CSV cleaning, preserve the header, remove exact duplicate rows, trim surrounding whitespace, and do not invent missing data.
Do not claim to execute code or tests.`;

        const response = await getClient(apiKey).chat.completions.create({
            model: MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content:
                        `REQUEST:\n${task}\n\n` +
                        `TARGET: ${targetName || '(not selected)'}\n\n` +
                        `CURRENT CONTENT:\n${currentCode || '(empty)'}\n\n` +
                        `ATTACHMENTS:\n${attachedText || '(none)'}`
                }
            ],
            max_completion_tokens: 10000
        });

        let content = response.choices[0]?.message?.content?.trim();

        if (!content) {
            throw new Error('The model returned an empty response.');
        }

        if (multiFile) {
            content = content
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/, '');

            let result;

            try {
                result = JSON.parse(content);
            } catch {
                throw new Error(
                    'The AI returned an invalid multi-file response. Please try again.'
                );
            }

            if (!Array.isArray(result.files) || result.files.length === 0) {
                throw new Error('The AI did not return any files.');
            }

            for (const file of result.files) {
                if (
                    typeof file.path !== 'string' ||
                    typeof file.content !== 'string' ||
                    !file.path.trim()
                ) {
                    throw new Error('The AI returned an invalid file entry.');
                }

                const normalized = file.path.replace(/\\/g, '/');

                if (
                    normalized.startsWith('/') ||
                    normalized.split('/').includes('..') ||
                    /^[a-zA-Z]:/.test(normalized)
                ) {
                    throw new Error('The AI returned an unsafe file path.');
                }

                file.path = normalized;
            }

            return result.files;
        }

        return content
            .replace(/^```[a-zA-Z0-9_-]*\s*\r?\n/, '')
            .replace(/\r?\n```\s*$/, '');
    }

    async function exists(uri) {
        return vscode.workspace.fs.stat(uri).then(
            () => true,
            () => false
        );
    }

    async function getWorkspaceRoot() {
        return vscode.workspace.workspaceFolders?.[0]?.uri || null;
    }

    async function nextUtilityFile(root) {
        let number = 1;

        while (true) {
            const uri = vscode.Uri.joinPath(root, `utility${number}.py`);
            if (!(await exists(uri))) return uri;
            number++;
        }
    }

    async function chooseOutputFolder() {
        const root = await getWorkspaceRoot();

        if (root) return root;

        const selected = await vscode.window.showOpenDialog({
            title: 'Choose the folder for your generated files',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Use this folder'
        });

        return selected?.[0] || null;
    }

    async function saveGeneratedFiles(files, root) {
        const destinations = files.map(file => ({
            uri: vscode.Uri.joinPath(root, ...file.path.split('/')),
            content: file.content
        }));

        const seen = new Set();

        for (const item of destinations) {
            const key = item.uri.toString();

            if (seen.has(key)) {
                throw new Error(
                    `The AI returned the same file path more than once: ${fileName(item.uri)}`
                );
            }

            seen.add(key);
        }

        const existing = [];

        for (const item of destinations) {
            if (await exists(item.uri)) existing.push(item.uri);
        }

        if (existing.length) {
            const names = existing.map(fileName).join(', ');

            const answer = await vscode.window.showWarningMessage(
                `These files already exist: ${names}. Replace them?`,
                { modal: true },
                'Replace Existing Files',
                'Cancel'
            );

            if (answer !== 'Replace Existing Files') return false;
        }

        for (const item of destinations) {
            const parent = vscode.Uri.joinPath(item.uri, '..');
            await vscode.workspace.fs.createDirectory(parent);
        }

        for (const item of destinations) {
            await vscode.workspace.fs.writeFile(
                item.uri,
                Buffer.from(item.content, 'utf8')
            );
        }

        const first = destinations[0];
        const document = await vscode.workspace.openTextDocument(first.uri);

        await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);

        return true;
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.setApiKey', async () => {
            const key = await vscode.window.showInputBox({
                title: 'Set Groq API Key',
                prompt: 'Enter your Groq API key',
                password: true,
                ignoreFocusOut: true
            });

            if (key === undefined) return;

            if (!key.trim()) {
                vscode.window.showErrorMessage('API key cannot be empty.');
                return;
            }

            await context.secrets.store(SECRET_KEY, key.trim());
            vscode.window.showInformationMessage('Groq API key saved securely.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.checkApiKey', async () => {
            const key = await context.secrets.get(SECRET_KEY);

            vscode.window.showInformationMessage(
                key ? 'Groq API key is saved.' : 'Groq API key is not saved.'
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.testGroq', async () => {
            try {
                const key = await context.secrets.get(SECRET_KEY);

                if (!key) throw new Error('Set your Groq API key first.');

                const result = await getClient(key).chat.completions.create({
                    model: MODEL,
                    messages: [
                        { role: 'user', content: 'Reply with the single word: Connected' }
                    ],
                    max_completion_tokens: 500
                });

                const reply = result.choices[0]?.message?.content?.trim();

                output.appendLine(reply || 'No response.');
                output.show(true);

                if (!reply) {
                    throw new Error('Groq answered, but the reply was empty.');
                }

                vscode.window.showInformationMessage('Groq connection succeeded.');
            } catch (error) {
                output.appendLine(errorText(error));
                output.show(true);
                vscode.window.showErrorMessage(
                    'Groq test failed: ' + errorText(error)
                );
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.openChat', () => {
            const panel = vscode.window.createWebviewPanel(
                'codescaleAIChat',
                'CodeScale AI',
                vscode.ViewColumn.Beside,
                { enableScripts: true }
            );

            const state = {
                target: vscode.window.activeTextEditor?.document.uri || null,
                targetIsFolder: false,
                attachments: []
            };

            function targetName() {
                if (!state.target) return 'No target selected';

                return state.targetIsFolder
                    ? `${fileName(state.target)} (folder)`
                    : fileName(state.target);
            }

            function updateChat() {
                panel.webview.postMessage({
                    command: 'state',
                    target: targetName(),
                    attachments: state.attachments.map(item => item.name)
                });
            }

            panel.webview.html = getChatHtml();

            panel.webview.onDidReceiveMessage(async message => {
                try {
                    if (message.command === 'inspectCode') {
                        try {
                            const uri =
                                state.target && !state.targetIsFolder
                                    ? state.target
                                    : vscode.window.activeTextEditor?.document.uri;

                            const data = await analyzeFile(uri);
                            const summary = reportAnalysis(fileName(uri), data);

                            output.show(true);

                            panel.webview.postMessage({
                                command: 'inspectResult',
                                text: summary + ' Details are in the CodeScale AI output panel.'
                            });
                        } catch (error) {
                            output.appendLine(errorText(error));

                            panel.webview.postMessage({
                                command: 'inspectResult',
                                text: 'Error: ' + errorText(error)
                            });
                        }

                        return;
                    }

                    if (message.command === 'chooseTarget') {
                        const choices = [
                            { label: '$(file-plus) Create a new file', kind: 'newFile' },
                            { label: '$(folder-opened) Select a folder', kind: 'folder' }
                        ];

                        const seen = new Set();

                        for (const document of vscode.workspace.textDocuments) {
                            if (document.uri.scheme !== 'file') continue;

                            const key = document.uri.toString();
                            if (seen.has(key)) continue;
                            seen.add(key);

                            choices.push({
                                label: fileName(document.uri),
                                description: vscode.workspace.asRelativePath(document.uri),
                                kind: 'file',
                                uri: document.uri
                            });
                        }

                        for (const folder of vscode.workspace.workspaceFolders || []) {
                            const files = await vscode.workspace.findFiles(
                                new vscode.RelativePattern(folder, '**/*'),
                                '**/{node_modules,.git,.venv}/**',
                                200
                            );

                            for (const uri of files) {
                                const key = uri.toString();

                                if (seen.has(key)) continue;
                                seen.add(key);

                                choices.push({
                                    label: fileName(uri),
                                    description: vscode.workspace.asRelativePath(uri),
                                    kind: 'file',
                                    uri
                                });
                            }
                        }

                        const picked = await vscode.window.showQuickPick(choices, {
                            title: 'Choose CodeScale AI target',
                            placeHolder:
                                'Select an existing file, create a file, or select a folder'
                        });

                        if (!picked) return;

                        if (picked.kind === 'newFile') {
                            const saveUri = await vscode.window.showSaveDialog({
                                title: 'Choose the new target file name and location',
                                saveLabel: 'Set target file'
                            });

                            if (!saveUri) return;

                            if (await exists(saveUri)) {
                                const answer = await vscode.window.showWarningMessage(
                                    `${fileName(saveUri)} already exists. Use it as the target?`,
                                    { modal: true },
                                    'Use Existing File'
                                );

                                if (answer !== 'Use Existing File') return;
                            } else {
                                await vscode.workspace.fs.writeFile(
                                    saveUri,
                                    Buffer.from('')
                                );
                            }

                            state.target = saveUri;
                            state.targetIsFolder = false;
                        } else if (picked.kind === 'folder') {
                            const folders = await vscode.window.showOpenDialog({
                                title: 'Select target folder',
                                canSelectFiles: false,
                                canSelectFolders: true,
                                canSelectMany: false
                            });

                            if (!folders?.[0]) return;

                            state.target = folders[0];
                            state.targetIsFolder = true;
                        } else {
                            state.target = picked.uri;
                            state.targetIsFolder = false;
                        }

                        updateChat();
                        return;
                    }

                    if (message.command === 'attachFiles') {
                        const files = await vscode.window.showOpenDialog({
                            canSelectMany: true,
                            openLabel: 'Attach to CodeScale AI',
                            filters: {
                                'Supported files': [
                                    'csv', 'txt', 'py', 'js', 'ts', 'html',
                                    'css', 'json', 'md', 'xml', 'yaml', 'yml',
                                    'log', 'sql', 'java', 'c', 'cpp', 'pdf',
                                    'png', 'jpg', 'jpeg', 'webp'
                                ],
                                'All files': ['*']
                            }
                        });

                        if (!files) return;

                        for (const uri of files) {
                            if (
                                state.attachments.some(
                                    item => item.uri.toString() === uri.toString()
                                )
                            ) {
                                continue;
                            }

                            const bytes = await vscode.workspace.fs.readFile(uri);
                            const ext = fileName(uri).split('.').pop()?.toLowerCase() ?? '';
                            const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext);
                            const isPdf = ext === 'pdf';

                            state.attachments.push({
                                uri,
                                name: fileName(uri),
                                content: isImage || isPdf
                                    ? `[${isImage ? 'Image' : 'PDF'} attached. This version does not extract image or PDF contents.]`
                                    : Buffer.from(bytes).toString('utf8').slice(0, 30000)
                            });
                        }

                        updateChat();
                        return;
                    }

                    if (message.command === 'removeAttachment') {
                        state.attachments = state.attachments.filter(
                            item => item.name !== message.name
                        );

                        updateChat();
                        return;
                    }

                    if (message.command !== 'sendMessage') return;

                    const task = String(message.text || '').trim();
                    if (!task) return;

                    let target = state.target;
                    let root;
                    let multiFile = false;
                    let currentCode = '';
                    let outputName = '';

                    if (target && !state.targetIsFolder) {
                        outputName = fileName(target);

                        if (await exists(target)) {
                            currentCode = Buffer.from(
                                await vscode.workspace.fs.readFile(target)
                            ).toString('utf8').slice(0, 30000);

                            const answer = await vscode.window.showWarningMessage(
                                `CodeScale AI will update ${outputName}. Continue?`,
                                { modal: true },
                                'Continue',
                                'Cancel'
                            );

                            if (answer !== 'Continue') {
                                panel.webview.postMessage({
                                    command: 'response',
                                    text: 'Cancelled. No file was changed.'
                                });
                                return;
                            }
                        }
                    } else {
                        if (target && state.targetIsFolder) {
                            root = target;
                            multiFile = true;
                        } else {
                            const mentionsFolder = /\b(folder|directory)\b/i.test(task);
                            const mentionsFiles =
                                /\b(?:files|separate files|two files|multiple files)\b/i.test(task);

                            const explicitFile =
                                /\b(?:create|make|write|generate|add)\b[\s\S]*?\b[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+\b/i.test(task);

                            if (mentionsFolder || mentionsFiles) {
                                multiFile = true;
                                root = await chooseOutputFolder();

                                if (!root) {
                                    panel.webview.postMessage({
                                        command: 'response',
                                        text: 'Cancelled. No files were created.'
                                    });
                                    return;
                                }
                            } else if (explicitFile) {
                                const match = task.match(
                                    /\b[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+\b/
                                );

                                const name = match?.[0] || 'utility1.py';
                                const workspace = await getWorkspaceRoot();

                                if (workspace) {
                                    target = vscode.Uri.joinPath(workspace, name);
                                } else {
                                    target = await vscode.window.showSaveDialog({
                                        title: 'Choose where to save the new file',
                                        defaultUri: vscode.Uri.file(name),
                                        saveLabel: 'Save file'
                                    });
                                }

                                if (!target) {
                                    panel.webview.postMessage({
                                        command: 'response',
                                        text: 'Cancelled. No file was created.'
                                    });
                                    return;
                                }

                                outputName = fileName(target);

                                if (await exists(target)) {
                                    const answer = await vscode.window.showWarningMessage(
                                        `${outputName} already exists. Replace it?`,
                                        { modal: true },
                                        'Replace',
                                        'Cancel'
                                    );

                                    if (answer !== 'Replace') {
                                        panel.webview.postMessage({
                                            command: 'response',
                                            text: 'Cancelled. No file was changed.'
                                        });
                                        return;
                                    }
                                }
                            } else {
                                root = await getWorkspaceRoot();

                                if (!root) root = await chooseOutputFolder();

                                if (!root) {
                                    panel.webview.postMessage({
                                        command: 'response',
                                        text: 'Cancelled. No file was created.'
                                    });
                                    return;
                                }

                                target = await nextUtilityFile(root);
                                outputName = fileName(target);
                            }
                        }
                    }

                    const attachments = state.attachments.slice();

                    panel.webview.postMessage({
                        command: 'response',
                        text: 'Working on your request...'
                    });

                    if (multiFile) {
                        const files = await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: 'CodeScale AI is creating your files...',
                                cancellable: false
                            },
                            async () => askAI(
                                task,
                                root.fsPath,
                                '',
                                attachments,
                                true
                            )
                        );

                        const saved = await saveGeneratedFiles(files, root);

                        if (!saved) {
                            panel.webview.postMessage({
                                command: 'response',
                                text: 'Cancelled. No files were changed.'
                            });
                            return;
                        }

                        panel.webview.postMessage({
                            command: 'response',
                            text: `Saved ${files.length} file(s) in ${root.fsPath}.`
                        });

                        state.target = root;
                        state.targetIsFolder = true;
                        updateChat();
                        return;
                    }

                    if (!target) {
                        throw new Error('No target file could be determined.');
                    }

                    const generated = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: 'CodeScale AI is working...',
                            cancellable: false
                        },
                        async () => askAI(
                            task,
                            outputName,
                            currentCode,
                            attachments,
                            false
                        )
                    );

                    const preview = await vscode.workspace.openTextDocument({
                        content: generated,
                        language: languageFromName(outputName)
                    });

                    await vscode.window.showTextDocument(preview, {
                        viewColumn: vscode.ViewColumn.Beside,
                        preview: true
                    });

                    const apply = await vscode.window.showInformationMessage(
                        `Review the result. Save it to ${outputName}?`,
                        'Save Changes',
                        'Cancel'
                    );

                    if (apply !== 'Save Changes') {
                        panel.webview.postMessage({
                            command: 'response',
                            text: 'Cancelled. No file was changed.'
                        });
                        return;
                    }

                    const parent = vscode.Uri.joinPath(target, '..');
                    await vscode.workspace.fs.createDirectory(parent);

                    await vscode.workspace.fs.writeFile(
                        target,
                        Buffer.from(generated, 'utf8')
                    );

                    state.target = target;
                    state.targetIsFolder = false;
                    updateChat();

                    panel.webview.postMessage({
                        command: 'response',
                        text: `Saved ${outputName} successfully.`
                    });
                } catch (error) {
                    const messageText = errorText(error);
                    output.appendLine(messageText);

                    panel.webview.postMessage({
                        command: 'response',
                        text: 'Error: ' + messageText
                    });

                    vscode.window.showErrorMessage(
                        'CodeScale AI: ' + messageText
                    );
                }
            });

            updateChat();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.readWorkspace', async () => {
            const folders = vscode.workspace.workspaceFolders || [];

            if (!folders.length) {
                vscode.window.showWarningMessage('Open a workspace folder first.');
                return;
            }

            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folders[0], '**/*'),
                '**/{node_modules,.git,.venv}/**',
                100
            );

            vscode.window.showInformationMessage(
                `Found ${files.length} files in ${folders[0].name}.`
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.helloWorld', () => {
            vscode.window.showInformationMessage('Hello World from CodeScale AI!');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.analyzeCurrentFile', async () => {
            try {
                const editor = vscode.window.activeTextEditor;

                if (!editor) {
                    throw new Error('Open a Python file in the editor first.');
                }

                const uri = editor.document.uri;

                const data = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'CodeScale AI is analyzing your file...',
                        cancellable: false
                    },
                    () => analyzeFile(uri)
                );

                const summary = reportAnalysis(fileName(uri), data);

                output.show(true);
                vscode.window.showInformationMessage('CodeScale AI: ' + summary);
            } catch (error) {
                output.appendLine(errorText(error));
                output.show(true);
                vscode.window.showErrorMessage(
                    'CodeScale AI: ' + errorText(error)
                );
            }
        })
    );

    vscode.window.showInformationMessage('CodeScale AI extension activated!');
}

function getChatHtml() {
    return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <style>
            :root {
                --blue-950: #071629;
                --blue-900: #0b203b;
                --blue-800: #12365c;
                --blue-700: #18518a;
                --blue-500: #388bdf;
                --blue-300: #8cc8ff;
                --blue-200: #c2e2ff;
                --blue-100: #eaf5ff;
                --text: #eaf4ff;
                --muted: #9eb7d1;
                --border: #244568;
            }

            * { box-sizing: border-box; }

            body {
                margin: 0;
                padding: 16px;
                color: var(--text);
                background: var(--blue-950);
                font-family: var(--vscode-font-family);
                font-size: 13px;
            }

            .app-title {
                margin: 0 0 5px;
                font-size: 21px;
                font-weight: 650;
                letter-spacing: -0.5px;
            }

            .app-subtitle {
                margin-bottom: 18px;
                color: var(--muted);
                font-size: 12px;
            }

            .panel {
                margin-bottom: 14px;
                overflow: hidden;
                border: 1px solid var(--border);
                border-radius: 10px;
                background: var(--blue-900);
            }

            .panel-heading {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                width: 100%;
                padding: 12px;
                border: 0;
                border-radius: 0;
                color: var(--text);
                background: var(--blue-800);
                text-align: left;
                font: inherit;
                font-weight: 600;
                cursor: pointer;
            }

            .panel-heading:hover {
                background: var(--blue-700);
            }

            .chevron {
                color: var(--blue-200);
                transition: transform 180ms ease;
            }

            .panel-heading[aria-expanded="false"] .chevron {
                transform: rotate(-90deg);
            }

            .panel-content { padding: 14px; }

            .panel-content[hidden] {
                display: none;
            }

            /* CodeScale Mascot Stage */

            .mascot-stage {
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 100%;
                height: 350px;
                overflow: hidden;
                border: 1px solid #d5d8dc;
                border-radius: 9px;
                background: linear-gradient(
                    180deg,
                    #c6cbd1 0%,
                    #d3d7db 55%,
                    #dcdfe2 100%
                );
            }

            .mascot-scaler {
                position: absolute;
                left: 50%;
                top: 50%;
                width: 560px;
                height: 800px;
                flex: none;
                transform-origin: center center;
            }

            .mascot-fig {
                position: relative;
                width: 560px;
                height: 800px;
                animation: mascot-bob 4s ease-in-out infinite;
            }

            .mascot-fig > * {
                position: absolute;
            }

            .mascot-shadow {
                left: 120px;
                top: 762px;
                width: 320px;
                height: 34px;
                border-radius: 50%;
                background: radial-gradient(
                    ellipse at center,
                    rgba(70,80,90,.35) 0%,
                    rgba(70,80,90,0) 70%
                );
                animation: mascot-shadow 4s ease-in-out infinite;
            }

            .mascot-leg {
                top: 690px;
                width: 82px;
                height: 88px;
                border-radius: 30px 30px 40px 40px;
                background: linear-gradient(
                    90deg,
                    #e6dccf,
                    #f6efe5 45%,
                    #e9e0d3
                );
                box-shadow: inset 0 -8px 12px rgba(150,130,110,.18);
            }

            .mascot-leg.l { left: 182px; }
            .mascot-leg.r { left: 304px; }

            .mascot-arm {
                top: 462px;
                width: 86px;
                height: 214px;
                border-radius: 44px 44px 50px 50px;
                background: linear-gradient(
                    90deg,
                    #f7f0e6,
                    #efe6da 60%,
                    #e2d8ca
                );
                box-shadow:
                    inset 0 -10px 16px rgba(150,130,110,.2),
                    0 6px 14px rgba(90,100,110,.12);
            }

            .mascot-arm.l {
                left: 112px;
                transform: rotate(18deg);
            }

            .mascot-arm.r {
                left: 362px;
                transform: rotate(-18deg);
                background: linear-gradient(
                    270deg,
                    #f7f0e6,
                    #efe6da 60%,
                    #e2d8ca
                );
            }

            .mascot-body {
                left: 172px;
                top: 436px;
                width: 216px;
                height: 270px;
                border-radius: 46% 46% 34% 34% / 22% 22% 16% 16%;
                background: radial-gradient(
                    ellipse at 40% 25%,
                    #fffaf2 0%,
                    #f4ece1 55%,
                    #e6dccf 100%
                );
                box-shadow:
                    inset 0 -14px 22px rgba(150,130,110,.2),
                    0 10px 20px rgba(90,100,110,.12);
            }

            .mascot-helmet {
                left: 9px;
                top: 4px;
                width: 542px;
                height: 450px;
                border-radius: 50% 50% 46% 46% / 64% 64% 36% 36%;
                background: radial-gradient(
                    ellipse at 38% 22%,
                    #fffefb 0%,
                    #f7f1e7 38%,
                    #ebe2d5 75%,
                    #ddd2c3 100%
                );
                box-shadow:
                    inset -18px -22px 36px rgba(150,128,105,.22),
                    inset 14px 10px 30px rgba(255,255,255,.7),
                    0 18px 28px rgba(90,100,110,.15);
            }

            .mascot-face {
                left: 56px;
                top: 252px;
                width: 448px;
                height: 202px;
                border-radius: 46% 46% 50% 50% / 26% 26% 74% 74%;
                background: radial-gradient(
                    ellipse at 50% 60%,
                    #f7f0e6 0%,
                    #f0e7da 70%,
                    #e8ddcf 100%
                );
                box-shadow:
                    inset 0 16px 20px -6px rgba(120,98,75,.38),
                    inset 0 -6px 12px rgba(150,130,110,.12);
                overflow: hidden;
            }

            .mascot-face::after {
                content: "";
                position: absolute;
                inset: 0;
                border-radius: inherit;
                box-shadow: inset 0 0 0 2px rgba(255,255,255,.25);
            }

            .mascot-brand {
                left: 0;
                width: 560px;
                top: 152px;
                text-align: center;
                font: 800 50px/1 "Nunito", "Varela Round",
                      ui-rounded, "Segoe UI", system-ui, sans-serif;
                letter-spacing: .5px;
                color: #6f6b66;
                text-shadow: 0 1px 0 rgba(255,255,255,.5);
            }

            .mascot-eye {
                top: 276px;
                width: 58px;
                height: 82px;
                border-radius: 50%;
                background: radial-gradient(
                    ellipse at 38% 30%,
                    #4a4a4a 0%,
                    #161616 28%,
                    #000 70%
                );
                box-shadow: 0 2px 4px rgba(0,0,0,.25);
                animation: mascot-blink 5s infinite;
                transform-origin: center;
            }

            .mascot-eye::after {
                content: "";
                position: absolute;
                left: 14px;
                top: 14px;
                width: 12px;
                height: 16px;
                border-radius: 50%;
                background: rgba(255,255,255,.3);
                filter: blur(1px);
            }

            .mascot-eye.l { left: 122px; }
            .mascot-eye.r { left: 384px; }

            .mascot-blush {
                top: 330px;
                width: 92px;
                height: 58px;
                border-radius: 50%;
                background: radial-gradient(
                    ellipse at center,
                    rgba(240,170,150,.55) 0%,
                    rgba(240,170,150,0) 70%
                );
            }

            .mascot-blush.l { left: 70px; }
            .mascot-blush.r { left: 400px; }

            .mascot-mouth {
                left: 270px;
                top: 338px;
                width: 22px;
                height: 8px;
                border-top: 3px solid #6a5f58;
                border-radius: 50% 50% 0 0;
            }

            @keyframes mascot-bob {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-8px); }
            }

            @keyframes mascot-shadow {
                0%, 100% {
                    transform: scaleX(1);
                    opacity: 1;
                }
                50% {
                    transform: scaleX(.92);
                    opacity: .8;
                }
            }

            @keyframes mascot-blink {
                0%, 92%, 100% { transform: scaleY(1); }
                95% { transform: scaleY(.08); }
            }

            .robot-caption {
                margin: 12px 0;
                color: var(--muted);
                font-size: 12px;
                line-height: 1.5;
                text-align: center;
            }

            .primary-button {
                width: 100%;
                padding: 10px 12px;
                border: 1px solid #69adf0;
                border-radius: 6px;
                color: #fff;
                background: #1765ad;
                font: inherit;
                font-weight: 600;
                cursor: pointer;
            }

            .primary-button:hover {
                background: #247bc9;
            }

            #inspectStatus {
                margin-top: 9px;
                color: var(--muted);
                font-size: 11px;
                line-height: 1.5;
            }

            #context, #attachments {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 7px;
                margin-bottom: 10px;
            }

            .chip {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                max-width: 100%;
                padding: 6px 8px;
                overflow-wrap: anywhere;
                border: 1px solid var(--border);
                border-radius: 6px;
                color: var(--blue-100);
                background: var(--blue-950);
                font-size: 11px;
            }

            .secondary-button {
                padding: 7px 9px;
                border: 1px solid #315b83;
                border-radius: 5px;
                color: var(--blue-100);
                background: #12365c;
                font: inherit;
                cursor: pointer;
            }

            .secondary-button:hover {
                background: #18518a;
            }

            #messages {
                display: flex;
                flex-direction: column;
                gap: 9px;
                max-height: 340px;
                margin: 12px 0;
                overflow-y: auto;
            }

            .message {
                padding: 10px;
                border: 1px solid var(--border);
                border-radius: 7px;
                background: var(--blue-950);
                color: var(--blue-100);
                white-space: pre-wrap;
                overflow-wrap: anywhere;
                line-height: 1.5;
            }

            textarea {
                display: block;
                width: 100%;
                min-height: 95px;
                padding: 10px;
                resize: vertical;
                border: 1px solid #315b83;
                border-radius: 7px;
                outline: none;
                color: var(--text);
                background: var(--blue-950);
                font: inherit;
                line-height: 1.5;
            }

            textarea:focus {
                border-color: var(--blue-500);
            }

            textarea::placeholder {
                color: #8da8c5;
            }

            .toolbar {
                display: flex;
                gap: 8px;
                margin-top: 9px;
            }

            .toolbar button { flex: 1; }

            button:focus-visible {
                outline: 2px solid var(--blue-300);
                outline-offset: 2px;
            }

            button:disabled {
                opacity: .6;
                cursor: wait;
            }

            @media (prefers-reduced-motion: reduce) {
                .mascot-fig,
                .mascot-shadow,
                .mascot-eye {
                    animation: none;
                }

                .chevron { transition: none; }
            }
        </style>
    </head>

    <body>
        <h1 class="app-title">CodeScale AI</h1>
        <div class="app-subtitle">
            Code analysis and AI-assisted development
        </div>

        <section class="panel">
            <button
                class="panel-heading"
                id="robotToggle"
                aria-expanded="true"
                aria-controls="robotContent"
            >
                <span>Robot Assistant</span>
                <span class="chevron" aria-hidden="true">▼</span>
            </button>

            <div class="panel-content" id="robotContent">

                <div class="mascot-stage" id="mascotStage">
                    <div class="mascot-scaler" id="mascotScaler">
                        <div class="mascot-fig">

                            <div class="mascot-shadow"></div>

                            <div class="mascot-leg l"></div>
                            <div class="mascot-leg r"></div>

                            <div class="mascot-arm l"></div>
                            <div class="mascot-arm r"></div>

                            <div class="mascot-body"></div>
                            <div class="mascot-helmet"></div>

                            <div class="mascot-brand">CodeScale</div>
                            <div class="mascot-face"></div>

                            <div class="mascot-blush l"></div>
                            <div class="mascot-blush r"></div>

                            <div class="mascot-eye l"></div>
                            <div class="mascot-eye r"></div>

                            <div class="mascot-mouth"></div>

                        </div>
                    </div>
                </div>

                <div class="robot-caption">
                    Your CodeScale AI assistant
                </div>

                <button class="primary-button" id="inspectCode">
                    Inspect Code
                </button>

                <div id="inspectStatus" role="status" aria-live="polite">
                    Click Inspect Code to analyze the target Python file.
                </div>
            </div>
        </section>

        <section class="panel">
            <button
                class="panel-heading"
                id="chatToggle"
                aria-expanded="true"
                aria-controls="chatContent"
            >
                <span>Chat with CodeScale AI</span>
                <span class="chevron" aria-hidden="true">▼</span>
            </button>

            <div class="panel-content" id="chatContent">
                <div id="context">
                    <span class="chip">
                        Target: <strong id="target">Loading...</strong>
                    </span>
                    <button class="secondary-button" id="changeTarget">
                        Change target
                    </button>
                </div>

                <div id="attachments"></div>

                <div id="messages" aria-live="polite">
                    <div class="message">
                        Ask me to create files, edit code, or clean a CSV dataset.
                    </div>
                </div>

                <textarea
                    id="prompt"
                    placeholder="Describe what you want CodeScale AI to do..."
                    aria-label="Message CodeScale AI"
                ></textarea>

                <div class="toolbar">
                    <button class="secondary-button" id="attach">
                        + Attach files
                    </button>
                    <button class="primary-button" id="send">Generate</button>
                </div>
            </div>
        </section>

        <script>
            const vscode = acquireVsCodeApi();

            const promptBox = document.getElementById('prompt');
            const sendButton = document.getElementById('send');
            const attachButton = document.getElementById('attach');
            const targetButton = document.getElementById('changeTarget');
            const targetLabel = document.getElementById('target');
            const attachmentsBox = document.getElementById('attachments');
            const messages = document.getElementById('messages');

            let busy = false;

            /* Mascot responsive scaling */

            function fitMascot() {
                const stage = document.getElementById('mascotStage');
                const scaler = document.getElementById('mascotScaler');

                if (!stage || !scaler) return;

                const scale = Math.min(
                    (stage.clientWidth - 8) / 560,
                    (stage.clientHeight - 8) / 800
                );

                scaler.style.transform =
                    'translate(-50%, -50%) scale(' + scale + ')';
            }

            window.addEventListener('resize', fitMascot);

            if (typeof ResizeObserver !== 'undefined') {
                const mascotObserver = new ResizeObserver(fitMascot);
                mascotObserver.observe(
                    document.getElementById('mascotStage')
                );
            }

            fitMascot();

            function addMessage(text) {
                const element = document.createElement('div');
                element.className = 'message';
                element.textContent = text;
                messages.appendChild(element);
                element.scrollIntoView({ block: 'end' });
            }

            function setupCollapse(buttonId, contentId) {
                const button = document.getElementById(buttonId);
                const content = document.getElementById(contentId);

                button.addEventListener('click', () => {
                    const expanded =
                        button.getAttribute('aria-expanded') === 'true';

                    button.setAttribute('aria-expanded', String(!expanded));
                    content.hidden = expanded;

                    if (!expanded && contentId === 'robotContent') {
                        requestAnimationFrame(fitMascot);
                    }
                });
            }

            setupCollapse('robotToggle', 'robotContent');
            setupCollapse('chatToggle', 'chatContent');

            const inspectButton = document.getElementById('inspectCode');
            const inspectStatus = document.getElementById('inspectStatus');

            inspectButton.addEventListener('click', () => {
                inspectButton.disabled = true;
                inspectStatus.textContent = 'Analyzing...';
                vscode.postMessage({ command: 'inspectCode' });
            });

            function sendMessage() {
                const text = promptBox.value.trim();

                if (!text || busy) return;

                addMessage('You: ' + text);
                promptBox.value = '';
                busy = true;
                sendButton.disabled = true;
                sendButton.textContent = 'Working...';

                vscode.postMessage({ command: 'sendMessage', text });
            }

            sendButton.addEventListener('click', sendMessage);

            attachButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'attachFiles' });
            });

            targetButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'chooseTarget' });
            });

            promptBox.addEventListener('keydown', event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                }
            });

            window.addEventListener('message', event => {
                const data = event.data;

                if (data.command === 'state') {
                    targetLabel.textContent = data.target;
                    attachmentsBox.replaceChildren();

                    for (const name of data.attachments) {
                        const chip = document.createElement('span');
                        chip.className = 'chip';
                        chip.textContent = name + ' ×';
                        chip.title = 'Click to remove this attachment';
                        chip.style.cursor = 'pointer';

                        chip.addEventListener('click', () => {
                            vscode.postMessage({
                                command: 'removeAttachment',
                                name
                            });
                        });

                        attachmentsBox.appendChild(chip);
                    }
                }

                if (data.command === 'inspectResult') {
                    inspectStatus.textContent = data.text;
                    inspectButton.disabled = false;
                }

                if (data.command === 'response') {
                    addMessage('CodeScale AI: ' + data.text);

                    busy = false;
                    sendButton.disabled = false;
                    sendButton.textContent = 'Generate';
                }
            });
        </script>
    </body>
    </html>`;
}
function deactivate() {}

module.exports = { activate, deactivate };