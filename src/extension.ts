import * as vscode from 'vscode';
import * as cp from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    const provider = new LatexDebugProvider(context);
    
    // Register the command triggered by the top-right editor Play button
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
        
        // Ensure we are looking at a LaTeX file
        if (!editor || (!editor.document.fileName.endsWith('.tex') && !editor.document.fileName.endsWith('.latex'))) {
            vscode.window.showErrorMessage('Please open a .tex file to build.');
            return undefined; 
        }

        const filePath = editor.document.fileName;
        const pdfPath = filePath.substring(0, filePath.lastIndexOf('.')) + '.pdf';
        
        // Hide ONLY the junk files specifically for THIS LaTeX project name
        this.hideSpecificJunkFiles(editor.document.fileName);

        // Check for the Mathematic Inc PDF viewer
        this.checkAndSuggestPdfViewer();

        // Check for Tectonic engine and run
        cp.exec('tectonic --version', (err: any) => {
            const terminalName = 'LaTeX Build';
            const terminal = vscode.window.terminals.find(t => t.name === terminalName) 
                          || vscode.window.createTerminal(terminalName);
            
            terminal.show();

            // The command switches to the file's folder first to avoid permission errors
            if (err) {
                vscode.window.showErrorMessage(
                    'Tectonic not found. Install instant LaTeX engine?', 
                    'Install Now'
                ).then(selection => {
                    if (selection === 'Install Now') {
                        // Progress Bar Logic
                        vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: "Installing Tectonic...",
                            cancellable: false
                        }, (progress) => {
                            return new Promise((resolve) => {
                                // Installs tectonic and then compiles with auto-install enabled
                                terminal.sendText(`sudo apt-get update && sudo apt-get install -y tectonic && cd "$(dirname "${filePath}")" && tectonic --auto-install "${filePath}" && code "${pdfPath}"`);
                                
                                // Resolves the progress bar after giving the terminal time to start
                                setTimeout(() => { resolve(true); }, 5000); 
                            });
                        });
                    }
                });
            } else {
                // Using --auto-install to handle missing packages silently
                terminal.sendText(`cd "$(dirname "${filePath}")" && tectonic --auto-install "${filePath}" && code "${pdfPath}"`);
            }
        });

        // Abort actual debugging UI so it doesn't hang on a "loading" bar
        return undefined; 
    }

    private hideSpecificJunkFiles(texFilePath: string) {
        const config = vscode.workspace.getConfiguration('files');
        const exclude = config.get<Record<string, boolean>>('exclude', {});
        
        const pathParts = texFilePath.split('/');
        const fileName = pathParts[pathParts.length - 1];
        const baseName = fileName.substring(0, fileName.lastIndexOf('.'));

        // Tectonic is much cleaner, but we'll keep the logic to hide any potential local logs
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