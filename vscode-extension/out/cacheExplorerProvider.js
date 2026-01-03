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
exports.CacheExplorerProvider = void 0;
const vscode = __importStar(require("vscode"));
class CacheExplorerProvider {
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage((data) => {
            switch (data.type) {
                case 'goToLine':
                    this._goToLine(data.file, data.line);
                    break;
            }
        });
    }
    updateResults(results) {
        this._results = results;
        if (this._view) {
            this._view.webview.postMessage({ type: 'updateResults', results });
        }
    }
    _goToLine(file, line) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const position = new vscode.Position(line - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
        }
    }
    _getHtmlForWebview(webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cache Explorer Results</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 10px;
      margin: 0;
    }

    .section {
      margin-bottom: 16px;
    }

    .section-title {
      font-weight: bold;
      margin-bottom: 8px;
      color: var(--vscode-textLink-foreground);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }

    .stat-box {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px;
      text-align: center;
    }

    .stat-label {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }

    .stat-value {
      font-size: 1.2em;
      font-weight: bold;
    }

    .hit-rate {
      color: var(--vscode-charts-green);
    }

    .miss-rate {
      color: var(--vscode-charts-red);
    }

    .hot-lines {
      max-height: 200px;
      overflow-y: auto;
    }

    .hot-line {
      padding: 4px 8px;
      margin: 2px 0;
      background: var(--vscode-editor-background);
      border-radius: 2px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
    }

    .hot-line:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .hot-line-location {
      color: var(--vscode-textLink-foreground);
    }

    .hot-line-stats {
      color: var(--vscode-descriptionForeground);
    }

    .suggestion {
      padding: 8px;
      margin: 4px 0;
      border-radius: 4px;
      border-left: 3px solid;
    }

    .suggestion.high {
      border-color: var(--vscode-charts-red);
      background: rgba(255, 0, 0, 0.1);
    }

    .suggestion.medium {
      border-color: var(--vscode-charts-yellow);
      background: rgba(255, 200, 0, 0.1);
    }

    .suggestion.low {
      border-color: var(--vscode-charts-blue);
      background: rgba(0, 100, 255, 0.1);
    }

    .no-results {
      text-align: center;
      padding: 20px;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div id="content">
    <div class="no-results">
      <p>No results yet.</p>
      <p>Use <strong>Cache Explorer: Profile Current File</strong> to analyze your code.</p>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'updateResults') {
        renderResults(message.results);
      }
    });

    function renderResults(results) {
      const content = document.getElementById('content');

      if (!results || !results.levels) {
        content.innerHTML = '<div class="no-results">No results available</div>';
        return;
      }

      const l1d = results.levels.l1d || {};
      const l2 = results.levels.l2 || {};
      const l3 = results.levels.l3 || {};

      let html = \`
        <div class="section">
          <div class="section-title">Cache Statistics</div>
          <div class="stats-grid">
            <div class="stat-box">
              <div class="stat-label">L1 Hit Rate</div>
              <div class="stat-value hit-rate">\${(l1d.hitRate || 0).toFixed(1)}%</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">L2 Hit Rate</div>
              <div class="stat-value hit-rate">\${(l2.hitRate || 0).toFixed(1)}%</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">L1 Misses</div>
              <div class="stat-value miss-rate">\${(l1d.misses || 0).toLocaleString()}</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Total Events</div>
              <div class="stat-value">\${(results.totalEvents || 0).toLocaleString()}</div>
            </div>
          </div>
        </div>
      \`;

      if (results.hotLines && results.hotLines.length > 0) {
        html += \`
          <div class="section">
            <div class="section-title">Hot Lines</div>
            <div class="hot-lines">
        \`;

        for (const line of results.hotLines.slice(0, 10)) {
          html += \`
            <div class="hot-line" onclick="goToLine('\${line.file}', \${line.line})">
              <span class="hot-line-location">Line \${line.line}</span>
              <span class="hot-line-stats">\${line.misses} misses (\${line.missRate.toFixed(1)}%)</span>
            </div>
          \`;
        }

        html += '</div></div>';
      }

      if (results.suggestions && results.suggestions.length > 0) {
        html += \`
          <div class="section">
            <div class="section-title">Suggestions</div>
        \`;

        for (const suggestion of results.suggestions.slice(0, 5)) {
          html += \`
            <div class="suggestion \${suggestion.severity}" onclick="goToLine('\${suggestion.file}', \${suggestion.line})">
              <strong>\${suggestion.type}</strong> at line \${suggestion.line}<br>
              \${suggestion.message}
              \${suggestion.fix ? \`<br><em>Fix: \${suggestion.fix}</em>\` : ''}
            </div>
          \`;
        }

        html += '</div>';
      }

      content.innerHTML = html;
    }

    function goToLine(file, line) {
      vscode.postMessage({ type: 'goToLine', file, line });
    }
  </script>
</body>
</html>`;
    }
}
exports.CacheExplorerProvider = CacheExplorerProvider;
CacheExplorerProvider.viewType = 'cacheExplorer.resultsView';
//# sourceMappingURL=cacheExplorerProvider.js.map