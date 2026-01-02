import * as vscode from 'vscode';
import WebSocket from 'ws';
import { CacheExplorerProvider } from './cacheExplorerProvider';

export interface CacheResult {
  levels: {
    l1d: LevelStats;
    l1i: LevelStats;
    l2: LevelStats;
    l3: LevelStats;
  };
  hotLines: HotLine[];
  suggestions: Suggestion[];
  totalEvents: number;
  config: string;
}

interface LevelStats {
  hits: number;
  misses: number;
  hitRate: number;
  writebacks: number;
}

interface HotLine {
  file: string;
  line: number;
  hits: number;
  misses: number;
  missRate: number;
}

interface Suggestion {
  severity: 'high' | 'medium' | 'low';
  type: string;
  file: string;
  line: number;
  message: string;
  fix?: string;
}

export async function profileCurrentFile(
  document: vscode.TextDocument,
  provider: CacheExplorerProvider | undefined
): Promise<CacheResult | null> {
  const config = vscode.workspace.getConfiguration('cacheExplorer');
  const serverUrl = config.get<string>('serverUrl') || 'ws://localhost:3001/ws';
  const hardwarePreset = config.get<string>('hardwarePreset') || 'modern-desktop';

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Cache Explorer',
      cancellable: true,
    },
    async (progress, token) => {
      return new Promise<CacheResult | null>((resolve, reject) => {
        let ws: WebSocket | null = null;
        let resolved = false;

        const cleanup = () => {
          if (ws) {
            try {
              ws.close();
            } catch {
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

          ws = new WebSocket(serverUrl);

          ws.on('open', () => {
            progress.report({ message: 'Sending code...' });

            const code = document.getText();
            const language = document.languageId === 'cpp' ? 'cpp' : document.languageId;

            ws!.send(
              JSON.stringify({
                code,
                language,
                config: hardwarePreset,
                optLevel: '-O2',
              })
            );
          });

          ws.on('message', (data: WebSocket.Data) => {
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

                    resolve(message.data as CacheResult);
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
            } catch (parseError) {
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
        } catch (error) {
          cleanup();
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        }
      });
    }
  );
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

function applyDecorations(document: vscode.TextDocument, results: CacheResult) {
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document === document
  );

  if (!editor || !results.hotLines) {
    return;
  }

  const hitDecorations: vscode.DecorationOptions[] = [];
  const missDecorations: vscode.DecorationOptions[] = [];

  for (const hotLine of results.hotLines) {
    if (hotLine.line <= 0 || hotLine.line > document.lineCount) {
      continue;
    }

    const line = document.lineAt(hotLine.line - 1);
    const range = new vscode.Range(line.range.end, line.range.end);

    const decoration: vscode.DecorationOptions = {
      range,
      renderOptions: {
        after: {
          contentText: ` // ${hotLine.missRate.toFixed(1)}% miss rate (${hotLine.misses} misses)`,
        },
      },
    };

    if (hotLine.missRate > 20) {
      missDecorations.push(decoration);
    } else if (hotLine.missRate < 5) {
      hitDecorations.push(decoration);
    }
  }

  editor.setDecorations(hitDecorationType, hitDecorations);
  editor.setDecorations(missDecorationType, missDecorations);
}
