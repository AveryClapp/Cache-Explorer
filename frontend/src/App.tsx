import { useState } from 'react'
import CodeEditor from './components/CodeEditor'
import Visualization from './components/Visualization'
import { analyzeCode } from './api/client'
import type { AnalysisResult } from './types'
import './App.css'

function App() {
  const [code, setCode] = useState(DEFAULT_CODE)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)

  const handleAnalyze = async () => {
    setLoading(true)
    try {
      const analysis = await analyzeCode(code, '-O0')
      setResult(analysis)
    } catch (error) {
      console.error('Analysis failed:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Cache Explorer</h1>
        <button onClick={handleAnalyze} disabled={loading}>
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
      </header>
      <div className="main">
        <CodeEditor code={code} onChange={setCode} />
        <Visualization result={result} />
      </div>
    </div>
  )
}

const DEFAULT_CODE = `#include <iostream>

int main() {
    int arr[1000];
    for (int i = 0; i < 1000; i++) {
        arr[i] = i * 2;
    }
    return 0;
}
`

export default App
