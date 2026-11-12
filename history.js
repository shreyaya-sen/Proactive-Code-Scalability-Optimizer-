const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 200;

function historyFolder(vscode) {
    const folder = vscode.workspace.workspaceFolders?.[0];

    return folder ? path.join(folder.uri.fsPath, '.codescale') : null;
}

function readHistory(vscode) {
    const dir = historyFolder(vscode);

    if (!dir) return [];

    try {
        const data = JSON.parse(
            fs.readFileSync(path.join(dir, 'history.json'), 'utf8')
        );

        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

// Stores only: time, tool name, file name, one-line result, evidence type.
// Never stores API keys or source code.
function recordHistory(vscode, entry) {
    try {
        const dir = historyFolder(vscode);

        if (!dir) return;

        fs.mkdirSync(dir, { recursive: true });

        const history = readHistory(vscode);

        history.push({ time: new Date().toISOString(), ...entry });

        fs.writeFileSync(
            path.join(dir, 'history.json'),
            JSON.stringify(history.slice(-MAX_ENTRIES), null, 2)
        );
    } catch {
        // History is best-effort and must never break a command.
    }
}

function registerHistoryCommands({ vscode, context, output, errorText }) {
    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.showHistory', () => {
            try {
                const history = readHistory(vscode);

                output.appendLine('='.repeat(60));
                output.appendLine('CodeScale AI history (most recent 20)');
                output.appendLine('='.repeat(60));

                if (!history.length) {
                    output.appendLine(
                        'No history yet. Run an analysis, benchmark or test first.'
                    );
                }

                for (const item of history.slice(-20)) {
                    output.appendLine(
                        `${new Date(item.time).toLocaleString()}  [${item.type}]  ${item.file || '-'}  -  ${item.summary || ''}  (${item.evidence || 'n/a'})`
                    );
                }

                output.appendLine('');
                output.show(true);
            } catch (error) {
                vscode.window.showErrorMessage('CodeScale AI: ' + errorText(error));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.exportReport', async () => {
            try {
                const dir = historyFolder(vscode);

                if (!dir) {
                    throw new Error('Open a workspace folder first.');
                }

                const history = readHistory(vscode);

                if (!history.length) {
                    throw new Error('There is no history to export yet.');
                }

                const clean = text => String(text ?? '-').replace(/\|/g, '\\|');

                const lines = [
                    '# CodeScale AI Report',
                    '',
                    `Generated: ${new Date().toLocaleString()}`,
                    '',
                    'Evidence labels: static = estimated from code, measured = timed on this machine, tested = checked by running tests, ai_suggested = proposed by AI.',
                    'No API keys or source code are stored in this report.',
                    '',
                    '| Time | Tool | File | Result | Evidence |',
                    '|---|---|---|---|---|'
                ];

                for (const item of history) {
                    lines.push(
                        `| ${clean(new Date(item.time).toLocaleString())} | ${clean(item.type)} | ${clean(item.file)} | ${clean(item.summary)} | ${clean(item.evidence)} |`
                    );
                }

                fs.mkdirSync(dir, { recursive: true });

                const reportPath = path.join(dir, 'report.md');

                fs.writeFileSync(reportPath, lines.join('\n') + '\n');

                const document = await vscode.workspace.openTextDocument(
                    vscode.Uri.file(reportPath)
                );

                await vscode.window.showTextDocument(document);
            } catch (error) {
                vscode.window.showErrorMessage('CodeScale AI: ' + errorText(error));
            }
        })
    );
}

module.exports = { recordHistory, registerHistoryCommands };