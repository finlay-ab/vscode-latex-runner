import * as vscode from 'vscode';
import * as cp from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    const provider = new LatexDebugProvider(context);
    
    // Play button command
    let runCommand = vscode.commands.registerCommand('vscode-latex-runner.runBuild', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            vscode.debug.startDebugging(undefined, {
                type: 'latex-build',
                name: 'Build LaTeX',
                request: 'launch'
            });
        }
    });

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('latex-build', provider),
        runCommand
    );
}

class LatexDebugProvider implements vscode.DebugConfigurationProvider {
    constructor(private context: vscode.ExtensionContext) {}

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
        
        this.hideSpecificJunkFiles(editor.document.fileName);
        this.checkAndSuggestPdfViewer();

        // Check if Tectonic is installed globally
        cp.exec('tectonic --version', (err: any) => {
            const terminalName = 'LaTeX Build';
            const terminal = vscode.window.terminals.find(t => t.name === terminalName) 
                          || vscode.window.createTerminal(terminalName);
            
            terminal.show();

            if (err) {
                vscode.window.showErrorMessage(
                    'Tectonic not found. Install instant LaTeX engine?', 
                    'Install Now'
                ).then(selection => {
                    if (selection === 'Install Now') {
                        vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: "Installing Tectonic...",
                            cancellable: false
                        }, (progress) => {
                            return new Promise((resolve) => {
                                // Install -> Move -> Absolute Path Run
                                // We use /usr/local/bin/tectonic directly for the first build
                                // to ensure it works even if $PATH hasn't refreshed yet.
                                const installCmd = `curl --proto '=https' --tlsv1.2 -fsSL https://drop-sh.fullyjustified.net | sh && sudo mv ./tectonic /usr/local/bin/`;
                                const buildCmd = `cd "$(dirname "${filePath}")" && /usr/local/bin/tectonic "${filePath}" && code "${pdfPath}"`;
                                
                                terminal.sendText(`${installCmd} && ${buildCmd}`);
                                
                                setTimeout(() => { resolve(true); }, 5000); 
                            });
                        });
                    }
                });
            } else {
                // Tectonic found: Run build immediately
                terminal.sendText(`cd "$(dirname "${filePath}")" && tectonic "${filePath}" && code "${pdfPath}"`);
            }
        });

        return undefined; 
    }

    private hideSpecificJunkFiles(texFilePath: string) {
        const config = vscode.workspace.getConfiguration('files');
        const exclude = config.get<Record<string, boolean>>('exclude', {});
        const fileName = texFilePath.split('/').pop() || "";
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

    private checkAndSuggestPdfViewer() {
        const shouldIgnore = this.context.globalState.get<boolean>('ignorePdfPrompt', false);
        const isInstalled = vscode.extensions.getExtension('mathematic.vscode-pdf');
        if (shouldIgnore || isInstalled) { return; }

        vscode.window.showInformationMessage(
            'Install "PDF Viewer" by Mathematic Inc to view your results directly in VS Code?',
            'Install Now',
            'Don\'t Remind Me'
        ).then(selection => {
            if (selection === 'Install Now') {
                vscode.commands.executeCommand('extension.open', 'mathematic.vscode-pdf');
            } else if (selection === 'Don\'t Remind Me') {
                this.context.globalState.update('ignorePdfPrompt', true);
            }
        });
    }
}

export function deactivate() {}