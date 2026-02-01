import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { initVimMode } from 'monaco-vim'
import './styles/index.css'

// Components
import {
  Header,
  CommandPalette,
  SettingsToolbar,
  ExamplesSidebar,
  BatchResultsModal,
  ResultsPanel,
  EditorPanel,
} from './components'
import type { ProjectFile, CommandItem, ExampleLangFilter } from './components'

// Types
import type {
  CacheResult,
  ErrorResult,
  Language,
  FileTab,
  Stage,
  DefineEntry,
  CustomCacheConfig,
  PrefetchPolicy,
} from './types'

// Constants
import { DEFAULT_EXAMPLE, API_BASE, WS_URL, PREFETCH_DEFAULTS, defaultCustomConfig } from './constants'

// Hooks
import { createFileTab, getFileExtension, useBaseline } from './hooks'

// Utilities
import { fuzzyMatch } from './utils/formatting'
import { encodeState, decodeState } from './utils/urlState'
import { exportAsJSON, exportAsCSV } from './utils/export'


function App() {
  // Embed mode detection from URL params
  const urlParams = new URLSearchParams(window.location.search)
  const isEmbedMode = urlParams.get('embed') === 'true'
  const isReadOnly = urlParams.get('readonly') === 'true'

  // Multi-file state - use files array instead of single code
  const [files, setFiles] = useState<FileTab[]>(() => [
    createFileTab('main.c', DEFAULT_EXAMPLE, 'c')
  ])
  const [activeFileId, setActiveFileId] = useState<string>(() => files[0]?.id || '')
  const [mainFileId, setMainFileId] = useState<string>(() => files[0]?.id || '')

  // Derived state for current file
  const activeFile = files.find(f => f.id === activeFileId) || files[0]
  const code = activeFile?.code || ''
  const language = activeFile?.language || 'c'

  // File management functions
  const updateActiveCode = useCallback((newCode: string) => {
    setFiles(prev => prev.map(f =>
      f.id === activeFileId ? { ...f, code: newCode } : f
    ))
  }, [activeFileId])

  const updateActiveLanguage = useCallback((newLang: Language) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== activeFileId) return f
      // Update extension if name has one
      const ext = getFileExtension(newLang)
      const baseName = f.name.replace(/\.(c|cpp|rs)$/, '')
      return { ...f, language: newLang, name: baseName + ext }
    }))
  }, [activeFileId])

  const closeFile = useCallback((id: string) => {
    if (files.length <= 1) return // Don't close last file
    const idx = files.findIndex(f => f.id === id)
    setFiles(prev => prev.filter(f => f.id !== id))
    // If closing active file, switch to adjacent
    if (id === activeFileId) {
      const newIdx = Math.min(idx, files.length - 2)
      const newActive = files.filter(f => f.id !== id)[newIdx]
      if (newActive) setActiveFileId(newActive.id)
    }
  }, [files, activeFileId])

  const renameFile = useCallback((id: string, name: string) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, name } : f
    ))
  }, [])

  // FileManager-compatible createFile callback
  const createFile = useCallback((name: string, language: Language) => {
    const newFile = createFileTab(name, '', language)
    setFiles(prev => [...prev, newFile])
    setActiveFileId(newFile.id)
  }, [])

  // Convert files to ProjectFile format for FileManager
  const projectFiles: ProjectFile[] = useMemo(() =>
    files.map(f => ({
      id: f.id,
      name: f.name,
      code: f.code,
      language: f.language,
      isMain: f.id === mainFileId
    }))
  , [files, mainFileId])

  const [config, setConfig] = useState('educational')
  const [optLevel, setOptLevel] = useState('-O0')
  const [prefetchPolicy, setPrefetchPolicy] = useState<PrefetchPolicy>('none')
  const [selectedCompiler, setSelectedCompiler] = useState<string>('')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cache-explorer-theme')
      if (saved === 'light' || saved === 'dark') return saved
    }
    return 'dark'
  })
  const [result, setResult] = useState<CacheResult | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<ErrorResult | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [customConfig, setCustomConfig] = useState<CustomCacheConfig>(defaultCustomConfig)
  const [defines, setDefines] = useState<DefineEntry[]>([])
  const [exampleLangFilter, setExampleLangFilter] = useState<ExampleLangFilter>('all')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [sampleRate, setSampleRate] = useState(1)  // 1 = no sampling
  const [fastMode, setFastMode] = useState(false)  // false = full 3C tracking
  const [eventLimit, setEventLimit] = useState(100000)  // Default 100K events
  const [longRunning, setLongRunning] = useState(false)

  // Use baseline hook for persistent comparison mode
  const {
    baselineResult,
    baselineConfig,
    diffMode,
    setDiffMode,
    setBaseline: setBaselineFromHook,
    clearBaseline: clearBaselineHook,
  } = useBaseline(files)
  const [baselineCode, setBaselineCode] = useState<string | null>(null)
  const [vimMode, setVimMode] = useState(false)  // Vim keybindings toggle
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [mobilePane, setMobilePane] = useState<'editor' | 'results'>('editor')
  const [selectedHotLineFile, setSelectedHotLineFile] = useState<string>('')  // File filter for hot lines
  const [batchResults, setBatchResults] = useState<{config: string; result: CacheResult}[]>([])
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const commandInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const decorationsRef = useRef<string[]>([])  // For hover/miss decorations
  const vimStatusRef = useRef<HTMLDivElement>(null)
  const vimModeRef = useRef<{ dispose: () => void } | null>(null)

  // Theme sync
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cache-explorer-theme', theme)
  }, [theme])


  // Fetch default compiler on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/compilers`)
      .then(res => res.json())
      .then(data => {
        if (data.default) {
          setSelectedCompiler(data.default)
        } else if (data.compilers && data.compilers.length > 0) {
          setSelectedCompiler(data.compilers[0].id)
        }
      })
      .catch(err => {
        console.warn('Failed to fetch compilers:', err)
      })
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
  }

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

  // Mobile detection - update on resize
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K to open command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(true)
        setCommandQuery('')
        setSelectedCommandIndex(0)
      }
      // Ctrl/Cmd + Enter to run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (stage === 'idle') runAnalysis()
      }
      // Escape to close command palette
      if (e.key === 'Escape') {
        setShowCommandPalette(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  // Load state from URL on mount
  useEffect(() => {
    const loadState = async () => {
      const params = new URLSearchParams(window.location.search)
      const shortId = params.get('s')

      // Helper to apply loaded state to the first file
      const applyState = (state: { code: string; config: string; optLevel: string; language?: Language; defines?: DefineEntry[] }) => {
        const lang = state.language || 'c'
        const newFile = createFileTab(`main${getFileExtension(lang)}`, state.code, lang)
        setFiles([newFile])
        setActiveFileId(newFile.id)  // Must update to match new file's ID
        setMainFileId(newFile.id)
        setConfig(state.config)
        setOptLevel(state.optLevel)
        if (state.defines) setDefines(state.defines)
      }

      if (shortId) {
        try {
          const response = await fetch(`${API_BASE}/s/${shortId}`)
          const data = await response.json()
          if (data.state) {
            applyState(data.state)
            return
          }
        } catch { /* ignore */ }
      }

      const hash = window.location.hash.slice(1)
      if (hash) {
        const saved = decodeState(hash)
        if (saved) {
          applyState(saved)
        }
      }
    }
    loadState()
  }, [])

  // Update URL when state changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const encoded = encodeState({ code, config, optLevel, language, defines })
      window.history.replaceState(null, '', `${window.location.pathname}#${encoded}`)
    }, 500)
    return () => clearTimeout(timer)
  }, [code, config, optLevel, language, defines])

  const handleShare = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/shorten`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: { code, config, optLevel, language, defines } }),
      })
      const data = await response.json()
      if (data.id) {
        const url = `${window.location.origin}${window.location.pathname}?s=${data.id}`
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [code, config, optLevel, language, defines])

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

  const cancelAnalysis = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStage('idle')
    setLongRunning(false)
  }, [])

  const runAnalysis = () => {
    // Input validation - check total size across all files
    const totalSize = files.reduce((sum, f) => sum + f.code.length, 0)
    if (totalSize > 100000) {
      setError({ type: 'validation_error', message: 'Code too long (max 100KB total)', suggestion: 'Try smaller programs or use sampling' })
      return
    }
    if (files.every(f => f.code.trim().length === 0)) {
      setError({ type: 'validation_error', message: 'No code to analyze', suggestion: 'Write or paste some code first' })
      return
    }

    // Cancel any ongoing analysis
    cancelAnalysis()

    setStage('connecting')
    setError(null)
    setResult(null)
    setLongRunning(false)

    // Set long-running warning after 10 seconds
    const longRunTimeout = setTimeout(() => setLongRunning(true), 10000)

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      const payload: Record<string, unknown> = { config, optLevel }
      // Send files array for multi-file support, single code for backward compatibility
      if (files.length === 1) {
        payload.code = files[0].code
        payload.language = files[0].language
      } else {
        payload.files = files.map(f => ({ name: f.name, code: f.code, language: f.language }))
        payload.language = files[0].language // Primary language for compilation
      }
      if (config === 'custom') payload.customConfig = customConfig
      if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())
      if (prefetchPolicy !== 'none') payload.prefetch = prefetchPolicy
      if (sampleRate > 1) payload.sample = sampleRate
      if (eventLimit > 0) payload.limit = eventLimit
      if (selectedCompiler) payload.compiler = selectedCompiler
      if (fastMode) payload.fast = true
      ws.send(JSON.stringify(payload))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'status') setStage(msg.stage as Stage)
      else if (msg.type === 'result') {
        clearTimeout(longRunTimeout)
        setLongRunning(false)
        setResult(msg.data as CacheResult)
        setStage('idle')
        wsRef.current = null
        ws.close()
      } else if (msg.type === 'error' || msg.type?.includes('error') || msg.errors) {
        // Handle all error types: 'error', 'compile_error', 'linker_error', etc.
        clearTimeout(longRunTimeout)
        setLongRunning(false)
        setError(msg as ErrorResult)
        setStage('idle')
        wsRef.current = null
        ws.close()
      }
    }

    ws.onerror = () => fallbackToHttp()
    ws.onclose = (e) => { if (!e.wasClean && stage !== 'idle') fallbackToHttp() }

    const fallbackToHttp = async () => {
      wsRef.current = null
      setStage('compiling')

      // Create abort controller for HTTP request
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const payload: Record<string, unknown> = { config, optLevel }
        // Send files array for multi-file support, single code for backward compatibility
        if (files.length === 1) {
          payload.code = files[0].code
          payload.language = files[0].language
        } else {
          payload.files = files.map(f => ({ name: f.name, code: f.code, language: f.language }))
          payload.language = files[0].language
        }
        if (config === 'custom') payload.customConfig = customConfig
        if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())
        if (prefetchPolicy !== 'none') payload.prefetch = prefetchPolicy
        if (sampleRate > 1) payload.sample = sampleRate
        if (eventLimit > 0) payload.limit = eventLimit
        if (fastMode) payload.fast = true

        const response = await fetch(`${API_BASE}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        const data = await response.json()

        if (data.type || data.error) setError(data as ErrorResult)
        else if (data.levels) setResult(data as CacheResult)
        else setError({ type: 'unknown_error', message: 'Unexpected response' })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // Request was cancelled - don't set error
          return
        }
        setError({ type: 'server_error', message: err instanceof Error ? err.message : 'Connection failed' })
      } finally {
        abortControllerRef.current = null
        setStage('idle')
      }
    }
  }

  const isLoading = stage !== 'idle'

  // Batch analysis - compare same code across multiple hardware presets
  const runBatchAnalysis = async () => {
    const configs = ['educational', 'intel', 'amd', 'apple']
    setBatchResults([])
    setBatchRunning(true)
    setShowBatchModal(true)

    for (const cfg of configs) {
      try {
        const payload = {
          code: files.length > 1 ? files.map(f => f.code).join('\n// --- FILE SEPARATOR ---\n') : files[0].code,
          language: files[0].language,
          config: cfg,
          optLevel,
          prefetch: prefetchPolicy,
          sampleRate,
          eventLimit,
          fastMode,
        }
        const response = await fetch(`${API_BASE}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        const data = await response.json()
        if (data.levels) {
          setBatchResults(prev => [...prev, { config: cfg, result: data as CacheResult }])
        }
      } catch {
        // Skip failed configs
      }
    }
    setBatchRunning(false)
  }

  const commands: CommandItem[] = useMemo(() => [
    // Actions (@)
    { id: 'run', icon: '@', label: 'Run analysis', shortcut: '⌘R', action: () => { if (!isLoading) runAnalysis() }, category: 'actions' },
    { id: 'share', icon: '@', label: 'Share / Copy link', shortcut: '⌘S', action: () => { handleShare(); setCopied(true); setTimeout(() => setCopied(false), 2000) }, category: 'actions' },
    { id: 'diff-baseline', icon: '@', label: 'Set as diff baseline', action: () => { if (result) { setBaselineFromHook(result, config, files); setBaselineCode(code) } }, category: 'actions' },
    { id: 'diff-toggle', icon: '@', label: diffMode ? 'Exit diff mode' : 'Enter diff mode', action: () => { if (baselineResult) setDiffMode(!diffMode) }, category: 'actions' },
    { id: 'diff-clear', icon: '@', label: 'Clear diff baseline', action: () => { clearBaselineHook(); setBaselineCode(null) }, category: 'actions' },
    { id: 'export-json', icon: '@', label: 'Export results as JSON', action: () => result && exportAsJSON(result), category: 'actions' },
    { id: 'export-csv', icon: '@', label: 'Export results as CSV', action: () => result && exportAsCSV(result), category: 'actions' },
    { id: 'batch-analyze', icon: '@', label: 'Compare hardware presets', action: runBatchAnalysis, category: 'actions' },
    // Settings (:)
    { id: 'vim', icon: ':', label: vimMode ? 'Disable Vim mode' : 'Enable Vim mode', action: () => setVimMode(!vimMode), category: 'settings' },
    { id: 'lang-c', icon: ':', label: 'Language: C', action: () => updateActiveLanguage('c'), category: 'settings' },
    { id: 'lang-cpp', icon: ':', label: 'Language: C++', action: () => updateActiveLanguage('cpp'), category: 'settings' },
    // Config (*)
    { id: 'sampling-none', icon: '*', label: 'Sampling: All events', action: () => setSampleRate(1), category: 'config' },
    { id: 'sampling-10', icon: '*', label: 'Sampling: 1:10', action: () => setSampleRate(10), category: 'config' },
    { id: 'sampling-100', icon: '*', label: 'Sampling: 1:100', action: () => setSampleRate(100), category: 'config' },
    { id: 'limit-1m', icon: '*', label: 'Event limit: 1M', action: () => setEventLimit(1000000), category: 'config' },
    { id: 'limit-5m', icon: '*', label: 'Event limit: 5M', action: () => setEventLimit(5000000), category: 'config' },
    { id: 'limit-none', icon: '*', label: 'Event limit: None', action: () => setEventLimit(0), category: 'config' },
  ], [isLoading, activeFileId, vimMode, diffMode, baselineResult, config, files, result, code, handleShare, updateActiveLanguage, setBaselineFromHook, clearBaselineHook])

  // Command palette handlers
  const handleCommandSelect = useCallback((cmd: CommandItem) => {
    cmd.action()
    setShowCommandPalette(false)
  }, [])

  const handleCommandNavigate = useCallback((delta: number) => {
    const filtered = commandQuery
      ? commands.filter(cmd => fuzzyMatch(commandQuery, cmd.label) || fuzzyMatch(commandQuery, cmd.category || ''))
      : commands
    setSelectedCommandIndex(prev => Math.max(0, Math.min(filtered.length - 1, prev + delta)))
  }, [commandQuery, commands])

  return (
    <div className={`app${isEmbedMode ? ' embed' : ''}`}>
      {/* Command Palette - hidden in embed mode */}
      {!isEmbedMode && (
        <CommandPalette
          isOpen={showCommandPalette}
          query={commandQuery}
          selectedIndex={selectedCommandIndex}
          onQueryChange={setCommandQuery}
          onSelect={handleCommandSelect}
          onClose={() => setShowCommandPalette(false)}
          onNavigate={handleCommandNavigate}
          inputRef={commandInputRef}
          commands={commands}
        />
      )}

      {/* Batch Results Modal */}
      {showBatchModal && (
        <BatchResultsModal
          results={batchResults}
          running={batchRunning}
          onClose={() => setShowBatchModal(false)}
        />
      )}

      {/* Header - hidden in embed mode */}
      {!isEmbedMode && (
        <Header
          theme={theme}
          diffMode={diffMode}
          baselineResult={baselineResult}
          result={result}
          isLoading={isLoading}
          stage={stage}
          onToggleTheme={toggleTheme}
          onSetDiffMode={setDiffMode}
          onSetBaseline={(r) => { setBaselineFromHook(r, config, files); setBaselineCode(code) }}
          onClearBaseline={() => { clearBaselineHook(); setBaselineCode(null) }}
          onRun={runAnalysis}
          onCancel={cancelAnalysis}
        />
      )}

      {/* Settings Toolbar - Godbolt style */}
      {!isEmbedMode && (
        <SettingsToolbar
          config={config}
          optLevel={optLevel}
          prefetchPolicy={prefetchPolicy}
          defines={defines}
          customConfig={customConfig}
          eventLimit={eventLimit}
          sampleRate={sampleRate}
          fastMode={fastMode}
          onConfigChange={(c) => {
            setConfig(c)
            setPrefetchPolicy(PREFETCH_DEFAULTS[c] || 'none')
          }}
          onOptLevelChange={setOptLevel}
          onPrefetchChange={(p) => setPrefetchPolicy(p as PrefetchPolicy)}
          onDefinesChange={setDefines}
          onCustomConfigChange={setCustomConfig}
          onEventLimitChange={setEventLimit}
          onSampleRateChange={setSampleRate}
          onFastModeChange={setFastMode}
        />
      )}

      {/* Copied Toast */}
      {copied && (
        <div className="toast">Link copied!</div>
      )}

      {/* Mobile Tab Switcher */}
      {isMobile && !isEmbedMode && (
        <div className="mobile-tab-switcher">
          <button
            className={mobilePane === 'editor' ? 'active' : ''}
            onClick={() => setMobilePane('editor')}
          >
            Code
          </button>
          <button
            className={mobilePane === 'results' ? 'active' : ''}
            onClick={() => setMobilePane('results')}
          >
            Results
          </button>
        </div>
      )}

      <div className="workspace">
        {/* Sidebar - Example List */}
        {!isEmbedMode && !isMobile && (
          <ExamplesSidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
            langFilter={exampleLangFilter}
            onLangFilterChange={setExampleLangFilter}
            currentCode={files[0]?.code || ''}
            onLoadExample={(newFiles, mainId) => {
              setFiles(newFiles)
              setActiveFileId(mainId)
              setMainFileId(mainId)
            }}
            onUpdateFile={(code, language, name) => {
              setFiles(prev => prev.map(f => f.id === activeFileId ? { ...f, code, language, name } : f))
            }}
          />
        )}

        <EditorPanel
          code={code}
          language={language}
          theme={theme}
          isReadOnly={isReadOnly}
          isEmbedMode={isEmbedMode}
          diffMode={diffMode}
          baselineCode={baselineCode}
          files={projectFiles}
          activeFileId={activeFileId}
          onFileSelect={setActiveFileId}
          onFileCreate={createFile}
          onFileDelete={closeFile}
          onFileRename={renameFile}
          onSetMainFile={setMainFileId}
          onCodeChange={updateActiveCode}
          onEditorMount={handleEditorMount}
          isLoading={isLoading}
          stage={stage}
          config={config}
          vimMode={vimMode}
          vimStatusRef={vimStatusRef}
          isMobile={isMobile}
          mobilePane={mobilePane}
        />

        <ResultsPanel
          result={result}
          baselineResult={baselineResult}
          baselineConfig={baselineConfig}
          error={error}
          isLoading={isLoading}
          stage={stage}
          longRunning={longRunning}
          diffMode={diffMode}
          showDetails={showDetails}
          onToggleDetails={() => setShowDetails(!showDetails)}
          code={code}
          selectedHotLineFile={selectedHotLineFile}
          onHotLineFileChange={setSelectedHotLineFile}
          editorRef={editorRef}
          copied={copied}
          onShare={handleShare}
          onExportJSON={() => result && exportAsJSON(result)}
          onExportCSV={() => result && exportAsCSV(result)}
          isMobile={isMobile}
          mobilePane={mobilePane}
        />
      </div>

    </div>
  )
}

export default App
