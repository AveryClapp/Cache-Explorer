import { useState } from 'react'
import Editor from '@monaco-editor/react'
import './App.css'

interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks: number
}

interface HotLine {
  file: string
  line: number
  hits: number
  misses: number
  missRate: number
}

interface CacheResult {
  config: string
  events: number
  levels: {
    l1d: CacheStats
    l2: CacheStats
    l3: CacheStats
  }
  hotLines: HotLine[]
  error?: string
}

const EXAMPLE_CODE = `#include <stdio.h>

#define N 100

int main() {
    int matrix[N][N];

    // Row-major access (cache-friendly)
    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            matrix[i][j] = i + j;
        }
    }

    // Column-major access (cache-unfriendly)
    int sum = 0;
    for (int j = 0; j < N; j++) {
        for (int i = 0; i < N; i++) {
            sum += matrix[i][j];
        }
    }

    printf("Sum: %d\\n", sum);
    return 0;
}
`

function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

function LevelStats({ name, stats }: { name: string; stats: CacheStats }) {
  const hitClass = stats.hitRate > 0.9 ? 'good' : stats.hitRate > 0.7 ? 'ok' : 'bad'
  return (
    <div className="level-stats">
      <div className="level-name">{name}</div>
      <div className="stat">
        <span className="label">Hits:</span>
        <span className="value">{stats.hits.toLocaleString()}</span>
      </div>
      <div className="stat">
        <span className="label">Misses:</span>
        <span className="value">{stats.misses.toLocaleString()}</span>
      </div>
      <div className="stat">
        <span className="label">Hit Rate:</span>
        <span className={`value ${hitClass}`}>{formatPercent(stats.hitRate)}</span>
      </div>
    </div>
  )
}

function App() {
  const [code, setCode] = useState(EXAMPLE_CODE)
  const [config, setConfig] = useState('educational')
  const [optLevel, setOptLevel] = useState('-O0')
  const [result, setResult] = useState<CacheResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('http://localhost:3001/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, config, optLevel }),
      })

      const data = await response.json()

      if (data.error) {
        setError(data.error)
      } else {
        setResult(data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Cache Explorer</h1>
        <p>Visualize how your code interacts with CPU caches</p>
      </header>

      <div className="main">
        <div className="editor-panel">
          <div className="toolbar">
            <select value={config} onChange={(e) => setConfig(e.target.value)}>
              <option value="educational">Educational (small caches)</option>
              <option value="intel">Intel 12th Gen</option>
              <option value="amd">AMD Zen 4</option>
              <option value="apple">Apple M-series</option>
            </select>
            <select value={optLevel} onChange={(e) => setOptLevel(e.target.value)}>
              <option value="-O0">-O0 (no optimization)</option>
              <option value="-O1">-O1</option>
              <option value="-O2">-O2</option>
              <option value="-O3">-O3</option>
            </select>
            <button onClick={runAnalysis} disabled={loading}>
              {loading ? 'Analyzing...' : 'Run Analysis'}
            </button>
          </div>
          <Editor
            height="calc(100vh - 180px)"
            defaultLanguage="c"
            theme="vs-dark"
            value={code}
            onChange={(value) => setCode(value || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
            }}
          />
        </div>

        <div className="results-panel">
          {error && (
            <div className="error">
              <h3>Error</h3>
              <pre>{error}</pre>
            </div>
          )}

          {result && (
            <>
              <div className="summary">
                <h3>Cache Statistics</h3>
                <div className="meta">
                  Config: {result.config} | Events: {result.events.toLocaleString()}
                </div>
                <div className="levels">
                  <LevelStats name="L1" stats={result.levels.l1d} />
                  <LevelStats name="L2" stats={result.levels.l2} />
                  <LevelStats name="L3" stats={result.levels.l3} />
                </div>
              </div>

              {result.hotLines.length > 0 && (
                <div className="hot-lines">
                  <h3>Hottest Lines (by misses)</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th>Misses</th>
                        <th>Miss Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.hotLines.map((line, i) => (
                        <tr key={i}>
                          <td className="location">
                            {line.file}:{line.line}
                          </td>
                          <td>{line.misses}</td>
                          <td className={line.missRate > 0.5 ? 'bad' : line.missRate > 0.2 ? 'ok' : 'good'}>
                            {formatPercent(line.missRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {!result && !error && !loading && (
            <div className="placeholder">
              <p>Click "Run Analysis" to see cache behavior</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
