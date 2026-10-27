const vscode = require('vscode');
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
        if (!content) throw new Error('The model returned an empty response.');

        if (multiFile) {
            content = content
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/, '');

            let result;
            try {
                result = JSON.parse(content);
            } catch {
                throw new Error('The AI returned an invalid multi-file response. Please try again.');
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
        const destinations = [];

        for (const file of files) {
            const uri = vscode.Uri.joinPath(root, ...file.path.split('/'));
            destinations.push({ uri, content: file.content });
        }

        const seen = new Set();

        for (const item of destinations) {
            const key = item.uri.toString();
            if (seen.has(key)) {
                throw new Error(`The AI returned the same file path more than once: ${fileName(item.uri)}`);
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
            const parent = vscode.Uri.joinPath(
                item.uri,
                '..'
            );

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
                    messages: [{ role: 'user', content: 'Reply: Connected!' }],
                    max_completion_tokens: 50
                });

                output.appendLine(result.choices[0]?.message?.content || 'No response.');
                output.show(true);
                vscode.window.showInformationMessage('Groq connection succeeded.');
            } catch (error) {
                output.appendLine(errorText(error));
                output.show(true);
                vscode.window.showErrorMessage('Groq test failed: ' + errorText(error));
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
                                label: document.uri.fsPath.split(/[\\/]/).pop(),
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
                            placeHolder: 'Select an existing file, create a file, or select a folder'
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
                                await vscode.workspace.fs.writeFile(saveUri, Buffer.from(''));
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
                            if (state.attachments.some(item => item.uri.toString() === uri.toString())) {
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

                    // A selected file always takes priority over filenames in the prompt.
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
                        // A folder target means generate files inside that folder.
                        if (target && state.targetIsFolder) {
                            root = target;
                            multiFile = true;
                        } else {
                            // No target: detect a request for a folder or multiple files.
                            const mentionsFolder =
                                /\b(folder|directory)\b/i.test(task);
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
                                // No target and no filename in the prompt: create utilityN.py.
                                root = await getWorkspaceRoot();

                                if (!root) {
                                    root = await chooseOutputFolder();
                                }

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

                    vscode.window.showErrorMessage('CodeScale AI: ' + messageText);
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
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                background: var(--vscode-editor-background);
                padding: 16px;
            }
            h2 { margin: 0 0 6px; }
            .muted {
                color: var(--vscode-descriptionForeground);
                font-size: 12px;
            }
            #context, #attachments {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin: 12px 0;
            }
            .chip {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 6px 9px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 6px;
                font-size: 12px;
            }
            #messages {
                display: flex;
                flex-direction: column;
                gap: 10px;
                margin: 14px 0;
            }
            .message {
                padding: 10px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 8px;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
                line-height: 1.5;
            }
            textarea {
                box-sizing: border-box;
                width: 100%;
                min-height: 90px;
                padding: 10px;
                resize: vertical;
                color: var(--vscode-input-foreground);
                background: var(--vscode-input-background);
                border: 1px solid var(--vscode-input-border, transparent);
                border-radius: 6px;
                font: inherit;
            }
            .toolbar {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                margin-top: 8px;
            }
            button {
                padding: 8px 12px;
                border: 1px solid var(--vscode-button-border, transparent);
                border-radius: 5px;
                cursor: pointer;
                font: inherit;
                color: var(--vscode-button-foreground);
                background: var(--vscode-button-background);
            }
            button.secondary {
                color: var(--vscode-button-secondaryForeground);
                background: var(--vscode-button-secondaryBackground);
            }
            button:disabled { opacity: .6; cursor: wait; }
        </style>
    </head>
    <body>
        <h2>CodeScale AI</h2>
        <div class="muted">Your AI coding agent</div>

        <div id="context">
            <span class="chip">Target: <strong id="target">Loading...</strong></span>
            <button class="secondary" id="changeTarget">Change target</button>
        </div>

        <div id="attachments"></div>

        <div id="messages">
            <div class="message">Ask me to create files, edit code, or clean a CSV dataset.</div>
        </div>

        <textarea id="prompt" placeholder="Describe what you want CodeScale AI to do..."></textarea>

        <div class="toolbar">
            <button class="secondary" id="attach">＋ Attach files</button>
            <button id="send">Generate</button>
        </div>

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

            function addMessage(text) {
                const element = document.createElement('div');
                element.className = 'message';
                element.textContent = text;
                messages.appendChild(element);
                element.scrollIntoView({ block: 'end' });
            }

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