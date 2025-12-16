export interface CacheAnnotation {
  line: number
  severity: 'good' | 'moderate' | 'bad'
  message: string
  suggestion: string
}

export interface AnalysisResult {
  annotations: CacheAnnotation[]
  metrics: {
    estimatedMissRatio: number
    hotFunctions: string[]
  }
}
