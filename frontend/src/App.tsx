import { useState } from 'react'
import { analyzeCode } from './api/client'
import './App.css'

function App() {
  const [code, setCode] = useState(DEFAULT_CODE)
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)

  const handleAnalyze = async () => {
    setLoading(true)
    try {
      const analysis = await analyzeCode(code, '-O0')
      setResult(JSON.stringify(analysis, null, 2))
    } catch (error) {
      setResult(`Error: ${error}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>Cache Explorer</h1>

      <div style={{ marginBottom: '10px' }}>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{
            width: '100%',
            height: '300px',
            fontFamily: 'monospace',
            fontSize: '14px',
            padding: '10px'
          }}
        />
      </div>

      <button onClick={handleAnalyze} disabled={loading}>
        {loading ? 'Analyzing...' : 'Analyze Code'}
      </button>

      {result && (
        <div style={{ marginTop: '20px' }}>
          <h3>Result:</h3>
          <pre style={{
            background: '#f5f5f5',
            padding: '10px',
            overflow: 'auto'
          }}>
            {result}
          </pre>
        </div>
      )}
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
