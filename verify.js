const path = require('path');

function registerVerifyCommand({
    vscode,
    context,
    output,
    runPhase2,
    errorText,
    recordHistory
}) {
    function formatVerify(result) {
        const lines = [
            `Correctness check: ${result.function}()`,
            `Passed ${result.passed} of ${result.total_cases} test case(s).`,
            ''
        ];

        for (const item of result.results || []) {
            if (item.passed) {
                lines.push(`  Case ${item.case}: passed`);
                continue;
            }

            if (item.status === 'mismatch') {
                lines.push(`  Case ${item.case}: MISMATCH`);
                lines.push(`      original:  ${JSON.stringify(item.original_result)}`);
                lines.push(`      candidate: ${JSON.stringify(item.candidate_result)}`);
            } else if (item.status === 'timeout') {
                lines.push(`  Case ${item.case}: TIMEOUT`);
            } else {
                lines.push(`  Case ${item.case}: ${String(item.status).toUpperCase()}`);

                if (item.details) {
                    lines.push(`      ${String(item.details).trim().slice(-300)}`);
                }
            }
        }

        lines.push('');
        lines.push(result.all_passed
            ? 'All supplied test cases matched.'
            : 'Some test cases did not match.');
        lines.push(result.limitation);

        return lines.join('\n');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('codescale-ai.verifyImplementations', async () => {
            try {
                const editor = vscode.window.activeTextEditor;

                if (!editor || !editor.document.uri.fsPath.toLowerCase().endsWith('.py')) {
                    throw new Error('Open the ORIGINAL Python file in the editor first.');
                }

                if (editor.document.isDirty) {
                    const saved = await editor.document.save();

                    if (!saved) {
                        throw new Error('Save the original file before continuing.');
                    }
                }

                const original = editor.document.uri;

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
                    prompt: 'Enter the function name (it must exist in both files)',
                    placeHolder: 'function_name',
                    ignoreFocusOut: true
                });

                if (!functionName?.trim()) return;

                const casesText = await vscode.window.showInputBox({
                    title: 'Test cases (JSON)',
                    prompt: 'A list of test cases. Each test case is a list of the function arguments. Example for a function taking one list: [[[3,1,2]], [[]]]',
                    value: '[[[3,1,2]], [[]]]',
                    ignoreFocusOut: true
                });

                if (!casesText?.trim()) return;

                let testCases;

                try {
                    testCases = JSON.parse(casesText);
                } catch {
                    throw new Error('Test cases are not valid JSON.');
                }

                if (!Array.isArray(testCases) || !testCases.length ||
                    !testCases.every(Array.isArray)) {
                    throw new Error('Test cases must be a non-empty list of argument lists.');
                }

                const answer = await vscode.window.showWarningMessage(
                    'CodeScale AI will RUN both files on your computer to compare them. This is not a secure sandbox. Only continue if you trust both files.',
                    { modal: true },
                    'Run Comparison'
                );

                if (answer !== 'Run Comparison') return;

                const result = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'CodeScale AI is comparing the two files...',
                        cancellable: false
                    },
                    () => runPhase2({
                        operation: 'verify',
                        original_file: original.fsPath,
                        candidate_file: candidate.fsPath,
                        function: functionName.trim(),
                        test_cases: testCases
                    })
                );

                output.appendLine('='.repeat(60));
                output.appendLine(
                    `Original: ${path.basename(original.fsPath)}   Candidate: ${path.basename(candidate.fsPath)}`
                );
                output.appendLine(formatVerify(result));
                output.appendLine('');
                output.show(true);

                recordHistory(vscode, {
                    type: 'verify',
                    file: path.basename(original.fsPath),
                    summary: `${functionName.trim()}(): ${result.passed}/${result.total_cases} cases matched`,
                    evidence: 'tested'
                });

                vscode.window.showInformationMessage(
                    `Correctness check: ${result.passed} of ${result.total_cases} passed.`
                );
            } catch (error) {
                output.appendLine(errorText(error));
                output.show(true);
                vscode.window.showErrorMessage('CodeScale AI: ' + errorText(error));
            }
        })
    );
}

module.exports = { registerVerifyCommand };