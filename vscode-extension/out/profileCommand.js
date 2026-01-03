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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileCurrentFile = profileCurrentFile;
const vscode = __importStar(require("vscode"));
const ws_1 = __importDefault(require("ws"));
async function profileCurrentFile(document, provider) {
    const config = vscode.workspace.getConfiguration('cacheExplorer');
    const serverUrl = config.get('serverUrl') || 'ws://localhost:3001/ws';
    const hardwarePreset = config.get('hardwarePreset') || 'modern-desktop';
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Cache Explorer',
        cancellable: true,
    }, async (progress, token) => {
        return new Promise((resolve, reject) => {
            let ws = null;
            let resolved = false;
            const cleanup = () => {
                if (ws) {
                    try {
                        ws.close();
                    }
                    catch {
                        // Ignore close errors
                    }
                    ws = null;
                }
            };
            token.onCancellationRequested(() => {
                if (ws) {
                    ws.send(JSON.stringify({ type: 'cancel' }));
                }
                cleanup();
                if (!resolved) {
                    resolved = true;
                    resolve(null);
                }
            });
            try {
                progress.report({ message: 'Connecting to server...' });
                ws = new ws_1.default(serverUrl);
                ws.on('open', () => {
                    progress.report({ message: 'Sending code...' });
                    const code = document.getText();
                    const language = document.languageId === 'cpp' ? 'cpp' : document.languageId;
                    ws.send(JSON.stringify({
                        code,
                        language,
                        config: hardwarePreset,
                        optLevel: '-O2',
                    }));
                });
                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        switch (message.type) {
                            case 'status':
                                progress.report({ message: `${message.stage}...` });
                                break;
                            case 'progress':
                                if (message.events) {
                                    progress.report({
                                        message: `Processing ${message.events.toLocaleString()} events...`,
                                    });
                                }
                                break;
                            case 'result':
                                cleanup();
                                if (!resolved) {
                                    resolved = true;
                                    // Apply inline decorations if enabled
                                    if (config.get('showInlineAnnotations')) {
                                        applyDecorations(document, message.data);
                                    }
                                    resolve(message.data);
                                }
                                break;
                            case 'error':
                                cleanup();
                                if (!resolved) {
                                    resolved = true;
                                    reject(new Error(message.error || message.message || 'Unknown error'));
                                }
                                break;
                        }
                    }
                    catch (parseError) {
                        console.error('Failed to parse message:', parseError);
                    }
                });
                ws.on('error', (error) => {
                    cleanup();
                    if (!resolved) {
                        resolved = true;
                        reject(new Error(`Connection failed: ${error.message}`));
                    }
                });
                ws.on('close', () => {
                    if (!resolved) {
                        resolved = true;
                        reject(new Error('Connection closed unexpectedly'));
                    }
                });
                // Timeout after 5 minutes
                setTimeout(() => {
                    if (!resolved) {
                        cleanup();
                        resolved = true;
                        reject(new Error('Profile request timed out'));
                    }
                }, 300000);
            }
            catch (error) {
                cleanup();
                if (!resolved) {
                    resolved = true;
                    reject(error);
                }
            }
        });
    });
}
// Decoration types for inline annotations
const hitDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    after: {
        color: 'rgba(0, 200, 0, 0.7)',
        margin: '0 0 0 1em',
    },
});
const missDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    after: {
        color: 'rgba(200, 0, 0, 0.7)',
        margin: '0 0 0 1em',
    },
});
function applyDecorations(document, results) {
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === document);
    if (!editor || !results.hotLines) {
        return;
    }
    const hitDecorations = [];
    const missDecorations = [];
    for (const hotLine of results.hotLines) {
        if (hotLine.line <= 0 || hotLine.line > document.lineCount) {
            continue;
        }
        const line = document.lineAt(hotLine.line - 1);
        const range = new vscode.Range(line.range.end, line.range.end);
        const decoration = {
            range,
            renderOptions: {
                after: {
                    contentText: ` // ${hotLine.missRate.toFixed(1)}% miss rate (${hotLine.misses} misses)`,
                },
            },
        };
        if (hotLine.missRate > 20) {
            missDecorations.push(decoration);
        }
        else if (hotLine.missRate < 5) {
            hitDecorations.push(decoration);
        }
    }
    editor.setDecorations(hitDecorationType, hitDecorations);
    editor.setDecorations(missDecorationType, missDecorations);
}
//# sourceMappingURL=profileCommand.js.map