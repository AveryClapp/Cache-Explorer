import type { AnalysisResult } from '../types'

export async function analyzeCode(
  code: string,
  optimizationLevel: string
): Promise<AnalysisResult> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      optimization: optimizationLevel,
    }),
  })

  if (!response.ok) {
    throw new Error(`Analysis failed: ${response.statusText}`)
  }

  return response.json()
}
