"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const cacheExplorerProvider_1 = require("./cacheExplorerProvider");
const profileCommand_1 = require("./profileCommand");
let cacheExplorerProvider;
function activate(context) {
    console.log('Cache Explorer extension is now active');
    // Create the provider for the results panel
    cacheExplorerProvider = new cacheExplorerProvider_1.CacheExplorerProvider(context.extensionUri);
    // Register the webview provider
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('cacheExplorer.resultsView', cacheExplorerProvider));
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('cacheExplorer.profileCurrentFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No file is currently open');
            return;
        }
        const document = editor.document;
        const languageId = document.languageId;
        // Check if the language is supported
        if (!['c', 'cpp', 'rust'].includes(languageId)) {
            vscode.window.showWarningMessage(`Cache Explorer doesn't support ${languageId} files. Supported: C, C++, Rust`);
            return;
        }
        try {
            const results = await (0, profileCommand_1.profileCurrentFile)(document, cacheExplorerProvider);
            if (results && cacheExplorerProvider) {
                cacheExplorerProvider.updateResults(results);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Cache Explorer: ${message}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('cacheExplorer.showResults', () => {
        vscode.commands.executeCommand('cacheExplorer.resultsView.focus');
    }));
    // Auto-profile on save if enabled
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
        const config = vscode.workspace.getConfiguration('cacheExplorer');
        if (config.get('autoProfile') && ['c', 'cpp', 'rust'].includes(document.languageId)) {
            try {
                const results = await (0, profileCommand_1.profileCurrentFile)(document, cacheExplorerProvider);
                if (results && cacheExplorerProvider) {
                    cacheExplorerProvider.updateResults(results);
                }
            }
            catch (error) {
                // Silently fail for auto-profile
                console.error('Auto-profile failed:', error);
            }
        }
    }));
    // Show welcome message on first activation
    const hasShownWelcome = context.globalState.get('hasShownWelcome');
    if (!hasShownWelcome) {
        vscode.window.showInformationMessage('Cache Explorer: Profile your code with "Cache Explorer: Profile Current File" command', 'Got it');
        context.globalState.update('hasShownWelcome', true);
    }
}
function deactivate() {
    console.log('Cache Explorer extension deactivated');
}
//# sourceMappingURL=extension.js.map