import * as vscode from 'vscode';
import { CacheExplorerProvider } from './cacheExplorerProvider';
import { profileCurrentFile } from './profileCommand';

let cacheExplorerProvider: CacheExplorerProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Cache Explorer extension is now active');

  // Create the provider for the results panel
  cacheExplorerProvider = new CacheExplorerProvider(context.extensionUri);

  // Register the webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'cacheExplorer.resultsView',
      cacheExplorerProvider
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('cacheExplorer.profileCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No file is currently open');
        return;
      }

      const document = editor.document;
      const languageId = document.languageId;

      // Check if the language is supported
      if (!['c', 'cpp', 'rust'].includes(languageId)) {
        vscode.window.showWarningMessage(
          `Cache Explorer doesn't support ${languageId} files. Supported: C, C++, Rust`
        );
        return;
      }

      try {
        const results = await profileCurrentFile(document, cacheExplorerProvider);
        if (results && cacheExplorerProvider) {
          cacheExplorerProvider.updateResults(results);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Cache Explorer: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cacheExplorer.showResults', () => {
      vscode.commands.executeCommand('cacheExplorer.resultsView.focus');
    })
  );

  // Auto-profile on save if enabled
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const config = vscode.workspace.getConfiguration('cacheExplorer');
      if (config.get('autoProfile') && ['c', 'cpp', 'rust'].includes(document.languageId)) {
        try {
          const results = await profileCurrentFile(document, cacheExplorerProvider);
          if (results && cacheExplorerProvider) {
            cacheExplorerProvider.updateResults(results);
          }
        } catch (error) {
          // Silently fail for auto-profile
          console.error('Auto-profile failed:', error);
        }
      }
    })
  );

  // Show welcome message on first activation
  const hasShownWelcome = context.globalState.get('hasShownWelcome');
  if (!hasShownWelcome) {
    vscode.window.showInformationMessage(
      'Cache Explorer: Profile your code with "Cache Explorer: Profile Current File" command',
      'Got it'
    );
    context.globalState.update('hasShownWelcome', true);
  }
}

export function deactivate() {
  console.log('Cache Explorer extension deactivated');
}
