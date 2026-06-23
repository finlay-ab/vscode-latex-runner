import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
const TECTONIC_VERSION = '0.14.1';

function escapeShellDoubleQuotes(value: string): string {
    return value.replace(/"/g, '\\"');
}

function getLocalTectonicBinary(): string {
    return process.platform === 'win32'
        ? path.join(os.homedir(), '.local', 'bin', 'tectonic.exe')
        : path.join(os.homedir(), '.local', 'bin', 'tectonic');
}

function canRunBinary(binaryPath: string): boolean {
    return cp.spawnSync(
        binaryPath,
        ['--version'],
        {
            stdio: 'ignore',
            windowsHide: true,
        }
    ).status === 0;
}

function hasTectonic(): boolean {
    return canRunBinary(getLocalTectonicBinary()) || canRunBinary(process.platform === 'win32' ? 'tectonic.exe' : 'tectonic');
}

function getTectonicBuildCommand(filePath: string, pdfPath: string): string {
    const safeFilePath = escapeShellDoubleQuotes(filePath);
    const safePdfPath = escapeShellDoubleQuotes(pdfPath);

    if (process.platform === 'win32') {
        const sourceDirectory = escapeShellDoubleQuotes(path.dirname(filePath));
        const localBinary = escapeShellDoubleQuotes(getLocalTectonicBinary());

        return `Set-Location -LiteralPath "${sourceDirectory}"; & "${localBinary}" "${safeFilePath}"; if ($LASTEXITCODE -eq 0) { code "${safePdfPath}" }`;
    }

    return `cd "$(dirname \"${safeFilePath}\")" && "$HOME/.local/bin/tectonic" "${safeFilePath}" && code "${safePdfPath}"`;
}

class LatexDebugProvider implements vscode.DebugConfigurationProvider {
    constructor(private context: vscode.ExtensionContext) { }

    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {

        const editor = vscode.window.activeTextEditor;

        if (!editor || (!editor.document.fileName.endsWith('.tex') && !editor.document.fileName.endsWith('.latex'))) {
            vscode.window.showErrorMessage('Please open a .tex file to build.');
            return undefined;
        }

        const filePath = editor.document.fileName;
        const pdfPath = filePath.substring(0, filePath.lastIndexOf('.')) + '.pdf';

        // hideSpecificJunkFiles (inlined)
        {
            const config = vscode.workspace.getConfiguration('files');
            const exclude = config.get<Record<string, boolean>>('exclude', {});
            const fileName = filePath.split('/').pop() || "";
            const baseName = fileName.substring(0, fileName.lastIndexOf('.'));

            const updatedExclude = {
                ...exclude,
                [`**/${baseName}.aux`]: true,
                [`**/${baseName}.log`]: true,
                [`**/${baseName}.gz`]: true,
                [`**/${baseName}.out`]: true
            };

            config.update('exclude', updatedExclude, vscode.ConfigurationTarget.Workspace);
        }

        const terminalName = 'LaTeX Build';
        const terminal = vscode.window.terminals.find(t => t.name === terminalName)
            || vscode.window.createTerminal(terminalName);

        terminal.show();

        if (!hasTectonic()) {
            vscode.window.showErrorMessage(
                'Tectonic not found. Install instant LaTeX engine?',
                'Install Now'
            ).then(
                selection => {
                    if (selection === 'Install Now') {
                        vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: 'Installing Tectonic...',
                                cancellable: false
                            }, () => {
                                return new Promise(
                                    (resolve) => {
                                        terminal.sendText((process.platform === 'win32'
                                            ? [
                                                "$tectonicBin = Join-Path $HOME '.local\\bin'",
                                                'New-Item -ItemType Directory -Force $tectonicBin | Out-Null',
                                                "$archive = Join-Path $env:TEMP 'tectonic.zip'",
                                                "$extractDir = Join-Path $env:TEMP 'tectonic-install'",
                                                `Invoke-WebRequest -Uri 'https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-pc-windows-msvc.zip' -OutFile $archive`,
                                                'Expand-Archive -Path $archive -DestinationPath $extractDir -Force',
                                                "Move-Item -Force (Join-Path $extractDir 'tectonic.exe') (Join-Path $tectonicBin 'tectonic.exe')",
                                            ].join('; ')
                                            : 'mkdir -p "$HOME/.local/bin" && curl -sSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40' + TECTONIC_VERSION + '/' + (process.platform === 'darwin' ? ('tectonic-' + TECTONIC_VERSION + '-x86_64-apple-darwin.tar.gz') : ('tectonic-' + TECTONIC_VERSION + '-x86_64-unknown-linux-musl.tar.gz')) + '" | tar -xz && mv ./tectonic "$HOME/.local/bin/"')
                                            + ' && ' + getTectonicBuildCommand(filePath, pdfPath));
                                        setTimeout(() => { resolve(true); }, 5000);
                                    }
                                );
                            }
                        );
                    }
                }
            );
        } else {
            // Tectonic found: Run build immediately
            terminal.sendText(getTectonicBuildCommand(filePath, pdfPath));
        }

        return undefined;
    }

    
}

export function activate(context: vscode.ExtensionContext) {
    // Play button command

    // Check for Tectonic immediately upon extension activation
    if (!hasTectonic()) {
        vscode.window.showErrorMessage(
            'Tectonic not found. Install instant LaTeX engine?',
            'Install Now'
        ).then(
            selection => {
                if (selection === 'Install Now') {
                    vscode.commands.executeCommand('vscode-latex-runner.runBuild');
                }
            }
        );
    }

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('latex-build', new LatexDebugProvider(context)),
        vscode.commands.registerCommand(
            'vscode-latex-runner.runBuild', () => {
                if (vscode.window.activeTextEditor) {
                    vscode.debug.startDebugging(
                        undefined,
                        {
                            type: 'latex-build',
                            name: 'Build LaTeX',
                            request: 'launch'
                        }
                    );
                }
            }
        )
    );
}


export function deactivate() { }