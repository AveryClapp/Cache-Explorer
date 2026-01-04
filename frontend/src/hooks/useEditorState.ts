import { useRef, useEffect } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { initVimMode } from 'monaco-vim'

interface ErrorResult {
  type: string
  errors?: CompileError[]
  summary?: string
  message?: string
  suggestion?: string
}

interface CompileError {
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
  suggestion?: string
  sourceLine?: string
}

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
  threads?: number
}

interface CacheResult {
  config: string
  events: number
  multicore?: boolean
  cores?: number
  threads?: number
  cacheConfig?: unknown
  levels: {
    l1?: CacheStats
    l1d?: CacheStats
    l1i?: CacheStats
    l2: CacheStats
    l3: CacheStats
  }
  coherence?: unknown
  hotLines: HotLine[]
  falseSharing?: unknown
  suggestions?: unknown
  timeline?: TimelineEvent[]
  prefetch?: unknown
  cacheState?: unknown
  tlb?: unknown
}

interface TimelineEvent {
  i: number
  t: 'R' | 'W' | 'I'
  l: 1 | 2 | 3 | 4
  a?: number
  f?: string
  n?: number
}

export interface EditorState {
  editorRef: React.MutableRefObject<editor.IStandaloneCodeEditor | null>
  monacoRef: React.MutableRefObject<Monaco | null>
  decorationsRef: React.MutableRefObject<string[]>
  stepDecorationsRef: React.MutableRefObject<string[]>
  vimStatusRef: React.MutableRefObject<HTMLDivElement | null>
  vimModeRef: React.MutableRefObject<{ dispose: () => void } | null>
  handleEditorMount: (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => void
}

export function useEditorState(
  vimMode: boolean,
  error: ErrorResult | null,
  result: CacheResult | null,
  timeline: TimelineEvent[],
  scrubberIndex: number
): EditorState {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const decorationsRef = useRef<string[]>([])
  const stepDecorationsRef = useRef<string[]>([])
  const vimStatusRef = useRef<HTMLDivElement | null>(null)
  const vimModeRef = useRef<{ dispose: () => void } | null>(null)

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
  }

  // Vim mode initialization effect
  useEffect(() => {
    if (vimMode && editorRef.current && vimStatusRef.current) {
      vimModeRef.current = initVimMode(editorRef.current, vimStatusRef.current)
    } else if (vimModeRef.current) {
      vimModeRef.current.dispose()
      vimModeRef.current = null
    }
    return () => {
      if (vimModeRef.current) {
        vimModeRef.current.dispose()
        vimModeRef.current = null
      }
    }
  }, [vimMode])

  // Apply error markers (red squiggles) for compile errors
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return

    const monaco = monacoRef.current
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    // Clear existing markers
    monaco.editor.setModelMarkers(model, 'cache-explorer', [])

    if (!error || !error.errors || error.errors.length === 0) return

    // Create markers for each error
    const markers: editor.IMarkerData[] = error.errors.map(err => ({
      severity: err.severity === 'error'
        ? monaco.MarkerSeverity.Error
        : monaco.MarkerSeverity.Warning,
      message: err.message + (err.suggestion ? `\n\nHint: ${err.suggestion}` : ''),
      startLineNumber: err.line,
      startColumn: err.column,
      endLineNumber: err.line,
      // Estimate end column: find the end of the problematic token/line
      endColumn: err.column + (err.sourceLine
        ? Math.min(20, err.sourceLine.length - err.column + 1)
        : 10),
      source: 'Cache Explorer'
    }))

    monaco.editor.setModelMarkers(model, 'cache-explorer', markers)
  }, [error])

  // Apply decorations for cache analysis results
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !result) {
      if (editorRef.current && decorationsRef.current.length > 0) {
        decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, [])
      }
      return
    }

    const monaco = monacoRef.current
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    const decorations: editor.IModelDeltaDecoration[] = []

    for (const line of result.hotLines) {
      const fileName = line.file.split('/').pop() || line.file
      if (fileName.includes('cache-explorer') || fileName.startsWith('/tmp/')) {
        const lineNum = line.line
        if (lineNum > 0 && lineNum <= model.getLineCount()) {
          let className = 'line-good'
          let inlineClass = 'inline-good'
          if (line.missRate > 0.5) {
            className = 'line-bad'
            inlineClass = 'inline-bad'
          } else if (line.missRate > 0.2) {
            className = 'line-warn'
            inlineClass = 'inline-warn'
          }

          // Background highlight for the whole line
          decorations.push({
            range: new monaco.Range(lineNum, 1, lineNum, 1),
            options: {
              isWholeLine: true,
              className,
              glyphMarginClassName: className.replace('line-', 'glyph-'),
              glyphMarginHoverMessage: {
                value: `**${line.misses.toLocaleString()} misses** (${(line.missRate * 100).toFixed(1)}% miss rate)\n\n${line.hits.toLocaleString()} hits total`
              }
            }
          })

          // Inline annotation at end of line showing miss info
          const lineContent = model.getLineContent(lineNum)
          decorations.push({
            range: new monaco.Range(lineNum, lineContent.length + 1, lineNum, lineContent.length + 1),
            options: {
              after: {
                content: ` // ${line.misses} misses (${(line.missRate * 100).toFixed(0)}%)`,
                inlineClassName: inlineClass
              }
            }
          })
        }
      }
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations)
  }, [result])

  // Highlight current line when stepping through timeline
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !timeline.length) {
      if (editorRef.current && stepDecorationsRef.current.length > 0) {
        stepDecorationsRef.current = editorRef.current.deltaDecorations(stepDecorationsRef.current, [])
      }
      return
    }

    const monaco = monacoRef.current
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    const currentEvent = timeline[scrubberIndex - 1]
    const decorations: editor.IModelDeltaDecoration[] = []

    if (currentEvent?.n && currentEvent.n > 0 && currentEvent.n <= model.getLineCount()) {
      const lineNum = currentEvent.n
      decorations.push({
        range: new monaco.Range(lineNum, 1, lineNum, 1),
        options: {
          isWholeLine: true,
          className: 'line-step-highlight',
          glyphMarginClassName: 'glyph-step',
        }
      })
      // Scroll the line into view
      editor.revealLineInCenterIfOutsideViewport(lineNum)
    }

    stepDecorationsRef.current = editor.deltaDecorations(stepDecorationsRef.current, decorations)
  }, [timeline, scrubberIndex])

  return {
    editorRef,
    monacoRef,
    decorationsRef,
    stepDecorationsRef,
    vimStatusRef,
    vimModeRef,
    handleEditorMount
  }
}
