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
const node_crypto_1 = require("node:crypto");
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
        webviewView.webview.html = this._getHtmlForWebview();
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
    _goToLine(_file, line) {
        const editor = vscode.window.activeTextEditor;
        if (editor && Number.isSafeInteger(line) && line > 0) {
            const lineIndex = Math.min(line - 1, Math.max(0, editor.document.lineCount - 1));
            const position = new vscode.Position(lineIndex, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
        }
    }
    _getHtmlForWebview() {
        const nonce = (0, node_crypto_1.randomBytes)(18).toString('base64');
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Hardware Explorer Results</title>
  <style nonce="${nonce}">
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
      width: 100%;
      border: 0;
      color: inherit;
      font: inherit;
      text-align: left;
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
      width: 100%;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
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
      <p>Use <strong>Hardware Explorer: Profile Current File</strong> to analyze your code.</p>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'updateResults') {
        renderResults(message.results);
      }
    });

    function renderResults(results) {
      const content = document.getElementById('content');
      content.replaceChildren();

      if (!results || !results.levels) {
        content.append(element('div', 'no-results', 'No results available'));
        return;
      }

      const l1d = results.levels.l1d || {};
      const l2 = results.levels.l2 || {};
      const l3 = results.levels.l3 || {};

      const statsSection = section('Cache Statistics');
      const statsGrid = element('div', 'stats-grid');
      statsGrid.append(
        stat('L1 Hit Rate', percent(l1d.hitRate), 'hit-rate'),
        stat('L2 Hit Rate', percent(l2.hitRate), 'hit-rate'),
        stat('L1 Misses', count(l1d.misses), 'miss-rate'),
        stat('Total Events', count(results.totalEvents)),
      );
      statsSection.append(statsGrid);
      content.append(statsSection);

      if (Array.isArray(results.hotLines) && results.hotLines.length > 0) {
        const hotSection = section('Hot Lines');
        const hotLines = element('div', 'hot-lines');
        for (const line of results.hotLines.slice(0, 10)) {
          const button = element('button', 'hot-line');
          button.type = 'button';
          button.append(
            element('span', 'hot-line-location', \`Line \${safeLine(line.line)}\`),
            element('span', 'hot-line-stats', \`\${count(line.misses)} misses (\${percent(line.missRate)})\`),
          );
          button.addEventListener('click', () => goToLine(line.file, line.line));
          hotLines.append(button);
        }
        hotSection.append(hotLines);
        content.append(hotSection);
      }

      if (Array.isArray(results.suggestions) && results.suggestions.length > 0) {
        const suggestionSection = section('Suggestions');
        for (const suggestion of results.suggestions.slice(0, 5)) {
          const severity = ['high', 'medium', 'low'].includes(suggestion.severity) ? suggestion.severity : 'low';
          const item = element('button', \`suggestion \${severity}\`);
          item.type = 'button';
          const heading = element('strong', '', String(suggestion.type || 'Suggestion'));
          item.append(heading, document.createTextNode(\` at line \${safeLine(suggestion.line)}\`));
          item.append(element('div', '', String(suggestion.message || '')));
          if (suggestion.fix) item.append(element('em', '', \`Fix: \${String(suggestion.fix)}\`));
          item.addEventListener('click', () => goToLine(suggestion.file, suggestion.line));
          suggestionSection.append(item);
        }
        content.append(suggestionSection);
      }
    }

    function element(tag, className = '', text = '') {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    }

    function section(title) {
      const node = element('section', 'section');
      node.append(element('div', 'section-title', title));
      return node;
    }

    function stat(label, value, tone = '') {
      const node = element('div', 'stat-box');
      node.append(element('div', 'stat-label', label), element('div', \`stat-value \${tone}\`.trim(), value));
      return node;
    }

    function number(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }

    function count(value) {
      return number(value).toLocaleString();
    }

    function percent(value) {
      return \`\${number(value).toFixed(1)}%\`;
    }

    function safeLine(value) {
      return Number.isSafeInteger(value) && value > 0 ? value : 1;
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