const fs = require('fs');
const path = require('path');

function registerPhase4Commands({
    vscode,
    context,
    output,
    runPhase2,
    errorText,
    askAI,
    getPythonTarget,
    recordHistory,
    fileName,
    maxFileBytes
}) {
    const secretDiagnostics =
        vscode.languages.createDiagnosticCollection('codescale-ai-secrets');

    context.subscriptions.push(secretDiagnostics);

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            secretDiagnostics.delete(document.uri);
        })
    );

    function fail(error) {
        output.appendLine(errorText(error));
        output.show(true);
        vscode.window.showErrorMessage('CodeScale AI: ' + errorText(error));
    }

    async function confirmRun(what) {
        const answer = await vscode.window.showWarningMessage(
            `CodeScale AI will RUN ${what} on your computer. This is not a secure sandbox. Only continue if you trust the code.`,
            { modal: true },
            'Run'
        );

        return answer === 'Run';
    }

    function withProgress(title, task) {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: false
            },
            task
        );
    }

    function ms(seconds) {
        return seconds == null ? '-' : (seconds * 1000).toFixed(3) + ' ms';
    }

    function lastLine(text) {
        return String(text).trim().split('\n').pop().slice(0, 140);
    }

    function parseSizes(text) {
        const sizes = String(text)
            .split(',')
            .map(item => item.trim())
            .filter(Boolean)
            .map(Number);

        const valid =
            sizes.length >= 2 &&
            sizes.length <= 6 &&
            sizes.every(n => Number.isInteger(n) && n >= 1 && n <= 100000);

        return valid ? sizes : null;
    }

    // -------------------------------------------------------------
    // Feature 2: worst-case input finder
    // -------------------------------------------------------------

    function formatWorstCase(result) {
        const slow = result.slowest_observed;

        const lines = [
            `Worst-case search: ${result.function}() with ${result.input_size} integers per input`,
            '',
            slow.timed_out
                ? `Slowest observed: ${slow.pattern} (timed out)`
                : `Slowest observed: ${slow.pattern} (${ms(slow.median_seconds)} median)`,
            ''
        ];

        for (const item of result.results) {
            if (item.error) {
                lines.push(
                    `  ${item.pattern.padEnd(15)} ${item.timed_out ? 'TIMED OUT' : 'ERROR: ' + lastLine(item.error)}`
                );
            } else {
                lines.push(
                    `  ${item.pattern.padEnd(15)} ${ms(item.median_seconds).padStart(12)}   peak memory ${(item.peak_memory_bytes / 1024).toFixed(1)} KB`
                );
            }
        }

        lines.push('', result.label);

        return lines.join('\n');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.findWorstCase', async () => {
            try {
                const uri = await getPythonTarget();

                const functionName = await vscode.window.showInputBox({
                    title: 'Find Worst-Case Input',
                    prompt: 'Function name. It must accept ONE list of integers.',
                    placeHolder: 'function_name',
                    ignoreFocusOut: true
                });

                if (!functionName?.trim()) return;

                const sizeText = await vscode.window.showInputBox({
                    title: 'Input size',
                    prompt: 'How many integers in each generated list? (10 to 100000)',
                    value: '2000',
                    ignoreFocusOut: true,
                    validateInput: value =>
                        /^\d+$/.test(value) && Number(value) >= 10 && Number(value) <= 100000
                            ? null
                            : 'Enter a whole number from 10 to 100000'
                });

                if (!sizeText) return;

                if (!(await confirmRun('your function on generated inputs'))) return;

                const result = await withProgress(
                    'CodeScale AI is testing input patterns...',
                    () => runPhase2({
                        operation: 'find_worst_case',
                        file: uri.fsPath,
                        function: functionName.trim(),
                        size: Number(sizeText),
                        ui_timeout_ms: 120000
                    })
                );

                output.appendLine('='.repeat(60));
                output.appendLine(formatWorstCase(result));
                output.appendLine('');
                output.show(true);

                recordHistory(vscode, {
                    type: 'worst_case',
                    file: fileName(uri),
                    summary: `${functionName.trim()}(): slowest observed input was ${result.slowest_observed.pattern}`,
                    evidence: 'measured'
                });

                vscode.window.showInformationMessage(
                    `Slowest observed input: ${result.slowest_observed.pattern}.`
                );
            } catch (error) {
                fail(error);
            }
        })
    );

    // -------------------------------------------------------------
    // Feature 11: crossover between two versions
    // -------------------------------------------------------------

    function formatCompare(result, firstName, secondName) {
        const label = value =>
            value === 'first' ? 'original' : value === 'second' ? 'candidate' : 'tie';

        const lines = [
            `Crossover search: ${result.function}()`,
            `Original: ${firstName}   Candidate: ${secondName}`,
            ''
        ];

        if (result.status === 'insufficient_data') {
            lines.push(result.message);
        } else {
            lines.push('Input size   Original      Candidate     Faster');

            for (const item of result.observations) {
                lines.push(
                    `${String(item.input_size).padEnd(12)} ${ms(item.first_seconds).padEnd(13)} ${ms(item.second_seconds).padEnd(13)} ${label(item.faster)}`
                );
            }

            lines.push('');

            const crossover = result.observed_crossover;

            lines.push(
                crossover
                    ? `Observed crossover between sizes ${crossover.between_input_sizes[0]} and ${crossover.between_input_sizes[1]}: ${label(crossover.winner_before)} was faster before, ${label(crossover.winner_after)} after.`
                    : 'No crossover observed in the tested sizes.'
            );
        }

        for (const failure of result.failures || []) {
            lines.push(`  Size ${failure.input_size} skipped: ${failure.error}`);
        }

        if (result.limitation) {
            lines.push('', result.limitation);
        }

        return lines.join('\n');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.compareImplementations', async () => {
            try {
                const original = await getPythonTarget();

                const picked = await vscode.window.showOpenDialog({
                    title: 'Choose the CANDIDATE (optimized) Python file',
                    canSelectMany: false,
                    openLabel: 'Use as candidate',
                    filters: { 'Python files': ['py'] }
                });

                if (!picked?.[0]) return;

                const candidate = picked[0];

                const functionName = await vscode.window.showInputBox({
                    title: 'Function to compare',
                    prompt: 'Function name (in both files). It must accept ONE list of integers.',
                    placeHolder: 'function_name',
                    ignoreFocusOut: true
                });

                if (!functionName?.trim()) return;

                const sizesText = await vscode.window.showInputBox({
                    title: 'Input sizes',
                    prompt: '2 to 6 list sizes, separated by commas',
                    value: '100, 500, 1000, 2000, 5000',
                    ignoreFocusOut: true,
                    validateInput: value =>
                        parseSizes(value)
                            ? null
                            : 'Enter 2 to 6 whole numbers from 1 to 100000, separated by commas'
                });

                if (!sizesText) return;

                if (!(await confirmRun('both files on generated inputs'))) return;

                const result = await withProgress(
                    'CodeScale AI is timing both versions...',
                    () => runPhase2({
                        operation: 'compare_implementations',
                        first_file: original.fsPath,
                        second_file: candidate.fsPath,
                        function: functionName.trim(),
                        sizes: parseSizes(sizesText),
                        ui_timeout_ms: 120000
                    })
                );

                output.appendLine('='.repeat(60));
                output.appendLine(
                    formatCompare(result, fileName(original), fileName(candidate))
                );
                output.appendLine('');
                output.show(true);

                const found = Boolean(result.observed_crossover);

                recordHistory(vscode, {
                    type: 'crossover',
                    file: fileName(original),
                    summary: `${functionName.trim()}(): ${found ? 'crossover observed' : 'no crossover observed'}`,
                    evidence: 'measured'
                });

                vscode.window.showInformationMessage(
                    found ? 'A crossover was observed. See the Output panel.' : 'Comparison finished. See the Output panel.'
                );
            } catch (error) {
                fail(error);
            }
        })
    );

    // -------------------------------------------------------------
    // Feature 6: run tests with real pytest counts
    // -------------------------------------------------------------

    function formatTests(result, targetName) {
        const lines = [
            `Test run: ${targetName}`,
            `Discovered: ${result.discovered}   Passed: ${result.passed}   Failed: ${result.failed}   Errors: ${result.errors}   Skipped: ${result.skipped}`
        ];

        if (result.failed_tests.length) {
            lines.push('', 'Failing tests:');

            for (const item of result.failed_tests) {
                lines.push(`  ${item.test} (${item.kind})`);

                if (item.message) lines.push(`      ${item.message}`);
            }
        }

        lines.push('', result.limitation);

        return lines.join('\n');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.runTests', async () => {
            try {
                const options = [];
                const folder = vscode.workspace.workspaceFolders?.[0];

                if (folder) {
                    options.push({
                        label: 'Whole workspace folder',
                        description: folder.name,
                        target: folder.uri.fsPath
                    });
                }

                const active = vscode.window.activeTextEditor?.document.uri;

                if (active?.scheme === 'file' && active.fsPath.toLowerCase().endsWith('.py')) {
                    options.push({
                        label: 'Current Python file',
                        description: fileName(active),
                        target: active.fsPath
                    });
                }

                options.push({
                    label: 'Choose another folder or test file...',
                    description: 'Pick it in a dialog',
                    choose: true
                });

                const picked = await vscode.window.showQuickPick(options, {
                    title: 'What should pytest run?'
                });

                if (!picked) return;

                let target = picked.target;

                if (picked.choose) {
                    const chosen = await vscode.window.showOpenDialog({
                        title: 'Choose a project folder or a test file for pytest',
                        canSelectFiles: true,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: 'Run tests here'
                    });

                    if (!chosen?.[0]) return;

                    target = chosen[0].fsPath;
                }

                if (!(await confirmRun('the selected tests'))) return;

                await vscode.workspace.saveAll(false);

                const result = await withProgress(
                    'CodeScale AI is running pytest...',
                    () => runPhase2({
                        operation: 'run_tests',
                        path: target,
                        timeout_seconds: 100,
                        ui_timeout_ms: 130000
                    })
                );

                const targetName = path.basename(target);

                output.appendLine('='.repeat(60));
                output.appendLine(formatTests(result, targetName));
                output.appendLine('');
                output.show(true);

                recordHistory(vscode, {
                    type: 'run_tests',
                    file: targetName,
                    summary: `${result.passed} passed, ${result.failed} failed, ${result.errors} errors of ${result.discovered}`,
                    evidence: 'tested'
                });

                const message = `Tests: ${result.passed} passed, ${result.failed} failed, ${result.errors} errors (of ${result.discovered}).`;

                if (result.failed || result.errors) {
                    vscode.window.showWarningMessage(message);
                } else {
                    vscode.window.showInformationMessage(message);
                }
            } catch (error) {
                fail(error);
            }
        })
    );

    // -------------------------------------------------------------
    // Feature 14: secret scanner
    // -------------------------------------------------------------

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.scanSecrets', async () => {
            try {
                const editor = vscode.window.activeTextEditor;

                if (!editor) {
                    throw new Error('Open a file in the editor first.');
                }

                const uri = editor.document.uri;

                const result = await runPhase2({
                    operation: 'scan_secrets',
                    text: editor.document.getText()
                });

                const diagnostics = result.findings.map(item => {
                    const line = Math.max(0, item.line - 1);

                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
                        `Possible hardcoded secret (${item.category}): ${item.masked_value}`,
                        vscode.DiagnosticSeverity.Warning
                    );

                    diagnostic.source = 'CodeScale AI';

                    return diagnostic;
                });

                secretDiagnostics.set(uri, diagnostics);

                output.appendLine('='.repeat(60));
                output.appendLine(`Secret scan of ${fileName(uri)}: ${result.count} possible secret(s)`);

                for (const item of result.findings) {
                    output.appendLine(`  line ${item.line}: ${item.category} (${item.masked_value})`);
                }

                output.appendLine(result.limitation);
                output.appendLine('');
                output.show(true);

                recordHistory(vscode, {
                    type: 'scan_secrets',
                    file: fileName(uri),
                    summary: `${result.count} possible secret(s)`,
                    evidence: 'static'
                });

                vscode.window.showInformationMessage(
                    result.count
                        ? `Found ${result.count} possible secret(s). They are marked in the editor.`
                        : 'No likely secrets found.'
                );
            } catch (error) {
                fail(error);
            }
        })
    );

    // -------------------------------------------------------------
    // Feature 12: AI optimization with diff preview
    // -------------------------------------------------------------

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.optimizeWithAI', async () => {
            try {
                const uri = await getPythonTarget();
                const document = await vscode.workspace.openTextDocument(uri);
                const original = document.getText();

                if (Buffer.byteLength(original, 'utf8') > maxFileBytes) {
                    throw new Error(
                        `The file is larger than ${maxFileBytes / 1000} KB, so it was not sent to Groq.`
                    );
                }

                const task =
                    'Optimize this Python file for scalability. Reduce time complexity where possible ' +
                    '(for example replace repeated list scans with sets or dictionaries, and avoid ' +
                    'sorting inside loops) while preserving the exact behavior, function names, ' +
                    'signatures and return values. Keep the code readable and keep comments and ' +
                    'docstrings. Return the complete updated file.';

                const generated = await withProgress(
                    'CodeScale AI is asking Groq for an optimized version...',
                    () => askAI(task, fileName(uri), original, [], false)
                );

                if (generated.trim() === original.trim()) {
                    vscode.window.showInformationMessage(
                        'The AI proposed no changes to this file.'
                    );
                    return;
                }

                const proposed = await vscode.workspace.openTextDocument({
                    content: generated,
                    language: 'python'
                });

                await vscode.commands.executeCommand(
                    'vscode.diff',
                    uri,
                    proposed.uri,
                    `CodeScale AI: ${fileName(uri)} (current vs proposed)`
                );

                const choice = await vscode.window.showInformationMessage(
                    'Review the diff. This is an AI suggestion and has NOT been verified. Apply it, or save it as a separate copy to verify first?',
                    'Apply Changes',
                    'Save as Copy (to verify)',
                    'Discard'
                );

                if (choice === 'Apply Changes') {
                    const edit = new vscode.WorkspaceEdit();

                    edit.replace(
                        uri,
                        new vscode.Range(
                            document.positionAt(0),
                            document.positionAt(document.getText().length)
                        ),
                        generated
                    );

                    const applied = await vscode.workspace.applyEdit(edit);

                    if (!applied) {
                        throw new Error('VS Code could not apply the changes.');
                    }

                    recordHistory(vscode, {
                        type: 'ai_optimize',
                        file: fileName(uri),
                        summary: 'AI suggestion applied (unverified)',
                        evidence: 'ai_suggested'
                    });

                    vscode.window.showInformationMessage(
                        'Changes applied but not saved. Press Ctrl+Z to undo.'
                    );
                } else if (choice === 'Save as Copy (to verify)') {
                    const parsed = path.parse(uri.fsPath);
                    let number = 1;
                    let copyPath;

                    do {
                        copyPath = path.join(
                            parsed.dir,
                            `${parsed.name}.optimized${number > 1 ? number : ''}${parsed.ext}`
                        );
                        number++;
                    } while (fs.existsSync(copyPath));

                    fs.writeFileSync(copyPath, generated, 'utf8');

                    recordHistory(vscode, {
                        type: 'ai_optimize',
                        file: fileName(uri),
                        summary: `AI suggestion saved as ${path.basename(copyPath)} (unverified)`,
                        evidence: 'ai_suggested'
                    });

                    vscode.window.showInformationMessage(
                        `Saved ${path.basename(copyPath)}. Run "CodeScale AI: Verify Optimized Version" to compare it with the original.`
                    );
                } else {
                    recordHistory(vscode, {
                        type: 'ai_optimize',
                        file: fileName(uri),
                        summary: 'AI suggestion discarded',
                        evidence: 'ai_suggested'
                    });
                }
            } catch (error) {
                fail(error);
            }
        })
    );
}

module.exports = { registerPhase4Commands };