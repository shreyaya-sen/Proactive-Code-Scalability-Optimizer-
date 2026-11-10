const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Groq = require('groq-sdk').default;

const MODEL = 'openai/gpt-oss-120b';
const SECRET_KEY = 'codescale-ai.groqApiKey';
const MAX_FILE_BYTES = 30000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

function activate(context) {
    const output = vscode.window.createOutputChannel('CodeScale AI');
    const diagnosticCollection =
        vscode.languages.createDiagnosticCollection('codescale-ai');

    context.subscriptions.push(output, diagnosticCollection);

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
            py: 'python',
            html: 'html',
            css: 'css',
            js: 'javascript',
            ts: 'typescript',
            json: 'json',
            csv: 'csv',
            txt: 'plaintext',
            java: 'java',
            sql: 'sql',
            md: 'markdown',
            xml: 'xml'
        };

        return languages[ext] || 'plaintext';
    }

    // ---------------------------------------------------------------
    // Python engine
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
        const script = path.join(
            context.extensionPath,
            'analyzer',
            'analyzer.py'
        );

        return new Promise((resolve, reject) => {
            cp.execFile(
                engine.command,
                [...engine.args, script, filePath],
                {
                    cwd: context.extensionPath,
                    timeout: 30000,
                    maxBuffer: MAX_OUTPUT_BYTES,
                    encoding: 'utf8'
                },
                (error, stdout, stderr) => {
                    if (error && !stdout) {
                        if (error.code === 'ENOENT') {
                            reject(new Error(
                                'Could not start Python. Run uv sync in the project folder.'
                            ));
                            return;
                        }

                        reject(new Error(
                            'Python analysis failed: ' +
                            (stderr || error.message).trim().slice(0, 500)
                        ));
                        return;
                    }

                    try {
                        resolve(JSON.parse(stdout));
                    } catch {
                        reject(new Error(
                            'The Python engine returned invalid JSON. ' +
                            (stderr || '').trim().slice(0, 300)
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
            throw new Error('The analyzer supports Python files only.');
        }

        const document = vscode.workspace.textDocuments.find(
            item => item.uri.toString() === uri.toString()
        );

        if (document?.isDirty) {
            const saved = await document.save();

            if (!saved) {
                throw new Error('The file could not be saved before analysis.');
            }
        }

        const data = await runEngine(uri.fsPath);

        if (data.status !== 'success') {
            const where = data.line ? ` (line ${data.line})` : '';
            throw new Error(`${data.error || 'Analysis failed'}${where}`);
        }

        return data;
    }

    function publishAnalysisDiagnostics(uri, data) {
        const diagnostics = [];

        for (const fn of data.functions || []) {
            for (const finding of fn.findings || []) {
                const line = Math.max(0, Number(finding.line || 1) - 1);
                const endLine = Math.max(
                    line,
                    Number(finding.end_line || finding.line || 1) - 1
                );

                const range = new vscode.Range(
                    line,
                    0,
                    endLine,
                    Number.MAX_SAFE_INTEGER
                );

                const severity =
                    String(finding.severity).toLowerCase() === 'high'
                        ? vscode.DiagnosticSeverity.Error
                        : String(finding.severity).toLowerCase() === 'medium'
                            ? vscode.DiagnosticSeverity.Warning
                            : vscode.DiagnosticSeverity.Information;

                const diagnostic = new vscode.Diagnostic(
                    range,
                    `${finding.category || 'Code finding'}: ${finding.message || ''}\nSuggestion: ${finding.suggestion || 'Review this code.'}`,
                    severity
                );

                diagnostic.source = 'CodeScale AI';
                diagnostic.code = finding.id || finding.category || 'finding';

                diagnostics.push(diagnostic);
            }
        }

        diagnosticCollection.set(uri, diagnostics);
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
            output.appendLine(`${fn.function}() (line ${fn.line})`);
            output.appendLine(`  Time:  ${fn.time_complexity_estimate}`);
            output.appendLine(`  Space: ${fn.auxiliary_space_estimate}`);

            if (!fn.findings.length) {
                output.appendLine('  No findings.');
            }

            for (const finding of fn.findings) {
                total++;

                output.appendLine(
                    `  [${String(finding.severity).toUpperCase()}] line ${finding.line}: ${finding.category}`
                );
                output.appendLine(`      ${finding.message}`);
                output.appendLine(`      Suggestion: ${finding.suggestion}`);
            }
        }

        output.appendLine('');

        return `${total} finding(s) in ${functions.length} function(s) of ${name}.`;
    }

    // ---------------------------------------------------------------
    // Phase 2 Python CLI integration
    // ---------------------------------------------------------------

    function runPhase2(request) {
        const engine = enginePython();

        return new Promise((resolve, reject) => {
            const child = cp.spawn(
                engine.command,
                [
                    ...engine.args,
                    '-m',
                    'analyzer.phase2_cli'
                ],
                {
                    cwd: context.extensionPath,
                    windowsHide: true
                }
            );

            let stdout = '';
            let stderr = '';
            let settled = false;

            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                child.kill();
                reject(new Error('Phase 2 operation timed out.'));
            }, 60000);

            function finish(error, result) {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);

                if (error) reject(error);
                else resolve(result);
            }

            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');

            child.stdout.on('data', chunk => {
                stdout += chunk;

                if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES) {
                    child.kill();
                    finish(new Error('Phase 2 output exceeded the size limit.'));
                }
            });

            child.stderr.on('data', chunk => {
                stderr += chunk.slice(0, 50000);
            });

            child.on('error', error => {
                finish(new Error(
                    'Could not start the Phase 2 Python engine: ' + error.message
                ));
            });

            child.on('close', code => {
                if (settled) return;

                if (code !== 0) {
                    finish(new Error(
                        (stderr || `Phase 2 process exited with code ${code}`)
                            .trim()
                            .slice(0, 1000)
                    ));
                    return;
                }

                try {
                    const result = JSON.parse(stdout);

                    if (result.status === 'error') {
                        finish(new Error(result.error || 'Phase 2 operation failed.'));
                        return;
                    }

                    finish(null, result);
                } catch {
                    finish(new Error(
                        'Phase 2 returned invalid JSON. ' +
                        stderr.trim().slice(0, 300)
                    ));
                }
            });

            child.stdin.on('error', error => {
                finish(new Error('Could not send the Phase 2 request: ' + error.message));
            });

            child.stdin.end(JSON.stringify(request));
        });
    }

    async function getPythonTarget() {
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            throw new Error('Open a Python file in the editor first.');
        }

        const uri = editor.document.uri;

        if (uri.scheme !== 'file' || !uri.fsPath.toLowerCase().endsWith('.py')) {
            throw new Error('Select a saved Python file first.');
        }

        if (editor.document.isDirty) {
            const saved = await editor.document.save();

            if (!saved) {
                throw new Error('Save the Python file before continuing.');
            }
        }

        return uri;
    }

    // ---------------------------------------------------------------
    // Phase 2 result formatters
    // ---------------------------------------------------------------

    function formatSuggestTests(result) {
        const suggestions = result.suggestions || [];

        if (!suggestions.length) {
            return 'No test suggestions found for this file.';
        }

        return suggestions.map((s, i) => {
            const lines = [`${i + 1}. [${s.category || 'general'}] ${s.test || s.description || 'No description'}`];

            if (s.reason) lines.push(`   Why: ${s.reason}`);

            return lines.join('\n');
        }).join('\n\n');
    }

    function formatRecommendDSA(result) {
        const recommendations = result.recommendations || [];

        if (!recommendations.length) {
            return 'No data structure improvements found — code looks efficient!';
        }

        return recommendations.map((r, i) => {
            const lines = [`${i + 1}. ${r.function || 'Unknown function'} (line ${r.line || '?'})`];

            if (r.issue) lines.push(`   Issue: ${r.issue}`);
            if (r.current_structure) lines.push(`   Currently using: ${r.current_structure}`);
            if (r.recommended_structure) lines.push(`   Recommended: ${r.recommended_structure}`);
            if (r.reason) lines.push(`   Why: ${r.reason}`);
            if (r.complexity_before && r.complexity_after) {
                lines.push(`   Complexity: ${r.complexity_before} → ${r.complexity_after}`);
            }

            return lines.join('\n');
        }).join('\n\n');
    }

    function formatBenchmark(result) {
        const measurements = result.measurements || [];
        const fnName = result.function || 'function';

        if (!measurements.length) {
            return 'No benchmark results returned.';
        }

        const lines = [`Results for ${fnName}:`];

        for (const m of measurements) {
            if (m.error) {
                lines.push(`  Error: ${m.error}`);
                continue;
            }

            const ms = m.median_seconds != null
                ? (m.median_seconds * 1000).toFixed(3) + ' ms'
                : '—';

            const mem = m.peak_memory_bytes != null
                ? (m.peak_memory_bytes / 1024).toFixed(1) + ' KB'
                : '—';

            lines.push(`  Time: ${ms}   Peak memory: ${mem}`);
        }

        lines.push('');
        lines.push('(Empirical measurement — open Output panel for full details)');

        return lines.join('\n');
    }

    function formatAnalyze(result) {
        const functions = result.functions || [];

        if (!functions.length) {
            return 'No functions found in this file.';
        }

        return functions.map(fn => {
            const lines = [`${fn.function}() — line ${fn.line}`];

            lines.push(`  Time:  ${fn.time_complexity_estimate || '—'}`);
            lines.push(`  Space: ${fn.auxiliary_space_estimate || '—'}`);

            const findings = fn.findings || [];

            if (findings.length) {
                lines.push(`  Findings (${findings.length}):`);

                for (const f of findings) {
                    lines.push(`    [${String(f.severity || '').toUpperCase()}] line ${f.line}: ${f.category}`);
                    lines.push(`      ${f.message}`);
                }
            } else {
                lines.push('  No issues found.');
            }

            return lines.join('\n');
        }).join('\n\n');
    }

    // ---------------------------------------------------------------
    // Groq AI
    // ---------------------------------------------------------------

    async function confirmCodeSharing() {
        const answer = await vscode.window.showWarningMessage(
            'CodeScale AI will send your request, selected code, and attached text files to Groq for AI processing. Do not continue if they contain passwords, API keys, personal information, or confidential data.',
            { modal: true },
            'I Understand — Continue',
            'Cancel'
        );

        return answer === 'I Understand — Continue';
    }

    async function askAI(
        task,
        targetName,
        currentCode,
        attachments,
        multiFile
    ) {
        const apiKey = await context.secrets.get(SECRET_KEY);

        if (!apiKey) {
            throw new Error('Run CodeScale AI: Set Groq API Key first.');
        }

        const approved = await confirmCodeSharing();

        if (!approved) {
            throw new Error('Cancelled. No code was sent to Groq.');
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
                throw new Error('The AI returned invalid multi-file JSON.');
            }

            if (!Array.isArray(result.files) || result.files.length === 0) {
                throw new Error('The AI did not return any files.');
            }

            const seen = new Set();

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

                if (seen.has(normalized.toLowerCase())) {
                    throw new Error('The AI returned a duplicate file path.');
                }

                seen.add(normalized.toLowerCase());
                file.path = normalized;
            }

            return result.files;
        }

        return content
            .replace(/^```[a-zA-Z0-9_-]*\s*\r?\n/, '')
            .replace(/\r?\n```\s*$/, '');
    }

    // ---------------------------------------------------------------
    // File utilities
    // ---------------------------------------------------------------

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
                throw new Error('The AI returned a duplicate destination.');
            }

            seen.add(key);
        }

        const existing = [];

        for (const item of destinations) {
            if (await exists(item.uri)) {
                existing.push(item.uri);
            }
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

        const edit = new vscode.WorkspaceEdit();

        for (const item of destinations) {
            const parent = vscode.Uri.joinPath(item.uri, '..');

            await vscode.workspace.fs.createDirectory(parent);

            if (await exists(item.uri)) {
                const document = await vscode.workspace.openTextDocument(item.uri);

                edit.replace(
                    item.uri,
                    new vscode.Range(
                        document.positionAt(0),
                        document.positionAt(document.getText().length)
                    ),
                    item.content
                );
            } else {
                edit.createFile(item.uri);
                edit.insert(item.uri, new vscode.Position(0, 0), item.content);
            }
        }

        const applied = await vscode.workspace.applyEdit(edit);

        if (!applied) {
            throw new Error('VS Code could not apply the generated file changes.');
        }

        const first = destinations[0];
        const document = await vscode.workspace.openTextDocument(first.uri);

        await vscode.window.showTextDocument(
            document,
            vscode.ViewColumn.Beside
        );

        return true;
    }

    async function saveSingleGeneratedFile(target, generated) {
        const edit = new vscode.WorkspaceEdit();

        if (await exists(target)) {
            const document = await vscode.workspace.openTextDocument(target);

            edit.replace(
                target,
                new vscode.Range(
                    document.positionAt(0),
                    document.positionAt(document.getText().length)
                ),
                generated
            );
        } else {
            edit.createFile(target);
            edit.insert(target, new vscode.Position(0, 0), generated);
        }

        const applied = await vscode.workspace.applyEdit(edit);

        if (!applied) {
            throw new Error('VS Code could not apply the generated changes.');
        }

        return vscode.workspace.openTextDocument(target);
    }

    // ---------------------------------------------------------------
    // API key commands
    // ---------------------------------------------------------------

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

            vscode.window.showInformationMessage(
                'Groq API key saved securely.'
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.checkApiKey', async () => {
            const key = await context.secrets.get(SECRET_KEY);

            vscode.window.showInformationMessage(
                key
                    ? 'Groq API key is saved.'
                    : 'Groq API key is not saved.'
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.testGroq', async () => {
            try {
                const key = await context.secrets.get(SECRET_KEY);

                if (!key) {
                    throw new Error('Set your Groq API key first.');
                }

                const result = await getClient(key).chat.completions.create({
                    model: MODEL,
                    messages: [
                        {
                            role: 'user',
                            content: 'Reply with the single word: Connected'
                        }
                    ],
                    max_completion_tokens: 500
                });

                const reply = result.choices[0]?.message?.content?.trim();

                output.appendLine(reply || 'No response.');
                output.show(true);

                if (!reply) {
                    throw new Error('Groq returned an empty response.');
                }

                vscode.window.showInformationMessage(
                    'Groq connection succeeded.'
                );
            } catch (error) {
                output.appendLine(errorText(error));
                output.show(true);

                vscode.window.showErrorMessage(
                    'Groq test failed: ' + errorText(error)
                );
            }
        })
    );

    // ---------------------------------------------------------------
    // Phase 2 commands (command palette)
    // ---------------------------------------------------------------

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.suggestTests', async () => {
            try {
                const uri = await getPythonTarget();

                const result = await runPhase2({
                    operation: 'suggest_tests',
                    file: uri.fsPath
                });

                output.appendLine('Phase 2 — Test suggestions');
                output.appendLine(formatSuggestTests(result));
                output.show(true);

                vscode.window.showInformationMessage(
                    'CodeScale AI generated test suggestions.'
                );
            } catch (error) {
                output.appendLine(errorText(error));
                output.show(true);
                vscode.window.showErrorMessage(errorText(error));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.benchmarkFunction', async () => {
            try {
                const uri = await getPythonTarget();

                const functionName = await vscode.window.showInputBox({
                    title: 'Benchmark Python Function',
                    prompt: 'Enter the exact function name to benchmark',
                    placeHolder: 'function_name',
                    ignoreFocusOut: true
                });

                if (!functionName?.trim()) return;

                const result = await runPhase2({
                    operation: 'benchmark',
                    file: uri.fsPath,
                    function: functionName.trim()
                });

                output.appendLine('Phase 2 — Benchmark results');
                output.appendLine(formatBenchmark(result));
                output.show(true);

                vscode.window.showInformationMessage(
                    `Benchmark completed for ${functionName}.`
                );
            } catch (error) {
                output.appendLine(errorText(error));
                output.show(true);
                vscode.window.showErrorMessage(errorText(error));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.suggestDSA', async () => {
            try {
                const uri = await getPythonTarget();

                const result = await runPhase2({
                    operation: 'recommend_dsa',
                    file: uri.fsPath
                });

                output.appendLine('Phase 2 — Data structure and algorithm suggestions');
                output.appendLine(formatRecommendDSA(result));
                output.show(true);

                vscode.window.showInformationMessage(
                    'CodeScale AI generated DSA suggestions.'
                );
            } catch (error) {
                output.appendLine(errorText(error));
                output.show(true);
                vscode.window.showErrorMessage(errorText(error));
            }
        })
    );

    // ---------------------------------------------------------------
    // CodeScale AI chat
    // ---------------------------------------------------------------

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.openChat', () => {
            const nonce = crypto.randomBytes(16).toString('base64');

            const panel = vscode.window.createWebviewPanel(
                'codescaleAIChat',
                'CodeScale AI',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    localResourceRoots: []
                }
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

            // Load the HTML from disk and inject nonce + CSP source
            const htmlPath = path.join(
                context.extensionPath,
                'webview',
                'chat.html'
            );

            let html = fs.readFileSync(htmlPath, 'utf8');

            html = html
                .replace(/\{\{NONCE\}\}/g, nonce)
                .replace(/\{\{CSP_SOURCE\}\}/g, panel.webview.cspSource);

            panel.webview.html = html;

            panel.webview.onDidReceiveMessage(async message => {
                try {
                    if (message.command === 'inspectCode') {
                        try {
                            const uri =
                                state.target && !state.targetIsFolder
                                    ? state.target
                                    : vscode.window.activeTextEditor?.document.uri;

                            const data = await analyzeFile(uri);

                            publishAnalysisDiagnostics(uri, data);

                            const summary = reportAnalysis(
                                fileName(uri),
                                data
                            );

                            output.show(true);

                            panel.webview.postMessage({
                                command: 'inspectResult',
                                text: summary +
                                    ' Details are in the CodeScale AI output panel.'
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

                    // Phase 2 buttons from the Analysis Tools panel
                    if (message.command === 'phase2') {
                        await handlePhase2PanelRequest(
                            message.operation,
                            panel,
                            state
                        );
                        return;
                    }

                    if (message.command === 'chooseTarget') {
                        const choices = [
                            {
                                label: '$(file-plus) Create a new file',
                                kind: 'newFile'
                            },
                            {
                                label: '$(folder-opened) Select a folder',
                                kind: 'folder'
                            }
                        ];

                        const seen = new Set();

                        for (const document of vscode.workspace.textDocuments) {
                            if (document.uri.scheme !== 'file') continue;

                            const key = document.uri.toString();

                            if (seen.has(key)) continue;

                            seen.add(key);

                            choices.push({
                                label: fileName(document.uri),
                                description: vscode.workspace.asRelativePath(
                                    document.uri
                                ),
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

                        const picked = await vscode.window.showQuickPick(
                            choices,
                            {
                                title: 'Choose CodeScale AI target',
                                placeHolder:
                                    'Select an existing file, create a file, or select a folder'
                            }
                        );

                        if (!picked) return;

                        if (picked.kind === 'newFile') {
                            const saveUri = await vscode.window.showSaveDialog({
                                title: 'Choose the new target file name and location',
                                saveLabel: 'Set target file'
                            });

                            if (!saveUri) return;

                            if (await exists(saveUri)) {
                                const answer =
                                    await vscode.window.showWarningMessage(
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

                            const bytes =
                                await vscode.workspace.fs.readFile(uri);

                            const ext = fileName(uri)
                                .split('.')
                                .pop()
                                ?.toLowerCase() ?? '';

                            const isImage = [
                                'png', 'jpg', 'jpeg', 'webp'
                            ].includes(ext);

                            const isPdf = ext === 'pdf';

                            if (bytes.byteLength > MAX_FILE_BYTES && !isImage && !isPdf) {
                                vscode.window.showWarningMessage(
                                    `${fileName(uri)} is larger than 30 KB and was not attached.`
                                );
                                continue;
                            }

                            state.attachments.push({
                                uri,
                                name: fileName(uri),
                                content: isImage || isPdf
                                    ? `[${isImage ? 'Image' : 'PDF'} attached. This version does not extract image or PDF contents.]`
                                    : Buffer.from(bytes).toString('utf8')
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
                            const openDocument =
                                vscode.workspace.textDocuments.find(
                                    document =>
                                        document.uri.toString() === target.toString()
                                );

                            if (openDocument?.isDirty) {
                                const saved = await openDocument.save();

                                if (!saved) {
                                    throw new Error(
                                        'Save the target file before asking CodeScale AI to edit it.'
                                    );
                                }
                            }

                            const bytes =
                                await vscode.workspace.fs.readFile(target);

                            if (bytes.byteLength > MAX_FILE_BYTES) {
                                throw new Error(
                                    `The target file is larger than ${MAX_FILE_BYTES / 1000} KB. It was not sent to Groq.`
                                );
                            }

                            currentCode = Buffer.from(bytes).toString('utf8');

                            const answer =
                                await vscode.window.showWarningMessage(
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
                                    const answer =
                                        await vscode.window.showWarningMessage(
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

                                    const bytes =
                                        await vscode.workspace.fs.readFile(target);

                                    if (bytes.byteLength > MAX_FILE_BYTES) {
                                        throw new Error(
                                            'The existing target file is too large to send to Groq.'
                                        );
                                    }

                                    currentCode =
                                        Buffer.from(bytes).toString('utf8');
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
                            () => askAI(
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
                        () => askAI(
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

                    const savedDocument =
                        await saveSingleGeneratedFile(target, generated);

                    await vscode.window.showTextDocument(
                        savedDocument,
                        vscode.ViewColumn.Beside
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

    // ---------------------------------------------------------------
    // Phase 2 panel request handler (called from chat webview buttons)
    // ---------------------------------------------------------------

    async function handlePhase2PanelRequest(operation, panel, state) {
        const labels = {
            suggest_tests: 'Suggest Tests',
            recommend_dsa: 'Suggest Data Structures',
            benchmark: 'Benchmark Function',
            analyze: 'Analyze Complexity'
        };

        const label = labels[operation] || operation;

        try {
            // All Phase 2 ops need a Python file — use target or active editor
            const uri = (() => {
                if (state.target && !state.targetIsFolder) {
                    const fp = state.target.fsPath || '';

                    if (fp.toLowerCase().endsWith('.py')) return state.target;
                }

                const active = vscode.window.activeTextEditor?.document.uri;

                if (active?.fsPath?.toLowerCase().endsWith('.py')) return active;

                return null;
            })();

            if (!uri) {
                panel.webview.postMessage({
                    command: 'phase2Result',
                    label,
                    text: 'No Python file selected. Open a .py file or set it as the target.'
                });
                return;
            }

            // Save if dirty
            const doc = vscode.workspace.textDocuments.find(
                d => d.uri.toString() === uri.toString()
            );

            if (doc?.isDirty) {
                const saved = await doc.save();

                if (!saved) {
                    panel.webview.postMessage({
                        command: 'phase2Result',
                        label,
                        text: 'Save the file before running analysis.'
                    });
                    return;
                }
            }

            // Benchmark needs a function name
            if (operation === 'benchmark') {
                const functionName = await vscode.window.showInputBox({
                    title: 'Benchmark Python Function',
                    prompt: 'Enter the exact function name to benchmark',
                    placeHolder: 'function_name',
                    ignoreFocusOut: true
                });

                if (!functionName?.trim()) {
                    panel.webview.postMessage({
                        command: 'phase2Result',
                        label,
                        text: 'Cancelled — no function name entered.'
                    });
                    return;
                }

                const result = await runPhase2({
                    operation: 'benchmark',
                    file: uri.fsPath,
                    function: functionName.trim()
                });

                panel.webview.postMessage({
                    command: 'phase2Result',
                    label,
                    text: formatBenchmark(result)
                });
                return;
            }

            // analyze uses the main engine (runEngine), not phase2_cli
            if (operation === 'analyze') {
                const data = await analyzeFile(uri);

                publishAnalysisDiagnostics(uri, data);

                panel.webview.postMessage({
                    command: 'phase2Result',
                    label,
                    text: formatAnalyze(data)
                });
                return;
            }

            // suggest_tests and recommend_dsa go through phase2_cli
            const result = await runPhase2({
                operation,
                file: uri.fsPath
            });

            const text = operation === 'suggest_tests'
                ? formatSuggestTests(result)
                : formatRecommendDSA(result);

            panel.webview.postMessage({
                command: 'phase2Result',
                label,
                text
            });
        } catch (error) {
            panel.webview.postMessage({
                command: 'phase2Result',
                label,
                text: 'Error: ' + errorText(error)
            });
        }
    }

    // ---------------------------------------------------------------
    // Workspace commands
    // ---------------------------------------------------------------

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.readWorkspace', async () => {
            const folders = vscode.workspace.workspaceFolders || [];

            if (!folders.length) {
                vscode.window.showWarningMessage(
                    'Open a workspace folder first.'
                );
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
            vscode.window.showInformationMessage(
                'Hello World from CodeScale AI!'
            );
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

                publishAnalysisDiagnostics(uri, data);

                const summary = reportAnalysis(fileName(uri), data);

                output.show(true);

                vscode.window.showInformationMessage(
                    'CodeScale AI: ' + summary
                );
            } catch (error) {
                output.appendLine(errorText(error));
                output.show(true);

                vscode.window.showErrorMessage(
                    'CodeScale AI: ' + errorText(error)
                );
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            diagnosticCollection.delete(document.uri);
        })
    );
}

function deactivate() {}

module.exports = { activate, deactivate };