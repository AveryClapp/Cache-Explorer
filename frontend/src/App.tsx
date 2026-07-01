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
  ExperimentResultsModal,
  HardwareExplorerModal,
  WorkloadCatalogModal,
  ResultsPanel,
  EditorPanel,
} from './components'
import type { ProjectFile, CommandItem, ExampleLangFilter } from './components'

// Types
import type {
  CacheResult,
  ErrorResult,
  HardwareExperimentResult,
  HardwareProfile,
  Language,
  FileTab,
  Stage,
  DefineEntry,
  CustomCacheConfig,
  PrefetchPolicy,
  SourceAnnotation,
  ShareableState,
  ExperimentVariantSource,
  WorkloadSnapshot,
  WorkloadVerificationResponse,
} from './types'

// Constants
import {
  DEFAULT_EXAMPLE,
  EXAMPLES,
  EXPERIMENT_TEMPLATES,
  API_BASE,
  WS_URL,
  PREFETCH_DEFAULTS,
  defaultCustomConfig,
} from './constants'

// Hooks
import {
  createFileTab,
  getFileExtension,
  normalizeProgressMessage,
  useBaseline,
  useThrottledProgress,
} from './hooks'

// Utilities
import { fuzzyMatch } from './utils/formatting'
import { encodeState, decodeState } from './utils/state'
import {
  exportAsJSON,
  exportAsCSV,
  exportBatchResultsAsCSV,
  exportBatchResultsAsJSON,
  exportExperimentAsCSV,
  exportExperimentAsJSON,
} from './utils/export'

function annotationClass(annotation: SourceAnnotation) {
  return `hw-${annotation.subsystem} ${annotation.severity}`
}

function annotationBadge(annotation: SourceAnnotation) {
  const subsystem = annotation.subsystem
    ? annotation.subsystem[0].toUpperCase() + annotation.subsystem.slice(1)
    : 'Hardware'
  const share = (annotation.metrics.share * 100).toFixed(0)
  return `${subsystem} ${share}%`
}

const BATCH_HARDWARE_CONFIGS = ['educational', 'intel', 'amd', 'apple']
const HARDWARE_RUN_SET_STORAGE_KEY = 'cache-explorer-hardware-run-set'

function hardwareConfigsOrDefault(configs: string[]) {
  return configs.length > 0 ? configs : BATCH_HARDWARE_CONFIGS
}

function readStoredHardwareRunSet() {
  if (typeof window === 'undefined') return BATCH_HARDWARE_CONFIGS
  try {
    const raw = localStorage.getItem(HARDWARE_RUN_SET_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return BATCH_HARDWARE_CONFIGS
    const configs = Array.from(new Set(parsed.filter(item => typeof item === 'string' && item.trim())))
    return configs.length > 0 ? configs : BATCH_HARDWARE_CONFIGS
  } catch {
    return BATCH_HARDWARE_CONFIGS
  }
}

function parseExperimentVariants(value: string) {
  return value
    .split(/\r?\n/)
    .map(variant => variant.trim())
    .filter(Boolean)
}

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
    setExperimentVariantSources(null)
    setExperimentVariantSourceLabel(null)
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

  const loadExampleByKey = useCallback((exampleKey: string) => {
    const example = EXAMPLES[exampleKey]
    if (!example) return
    setExperimentVariantSources(null)
    setExperimentVariantSourceLabel(null)

    if (example.files && example.files.length > 0) {
      const newFiles = example.files.map(file => ({
        ...createFileTab(file.name, file.code, file.language),
        isMain: file.isMain,
      }))
      const mainFile = newFiles.find(file => file.isMain) || newFiles[0]
      if (!mainFile) return
      setFiles(newFiles)
      setActiveFileId(mainFile.id)
      setMainFileId(mainFile.id)
      return
    }

    const newFile = createFileTab(`main${getFileExtension(example.language)}`, example.code, example.language)
    setFiles([newFile])
    setActiveFileId(newFile.id)
    setMainFileId(newFile.id)
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
  const longRunTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [customConfig, setCustomConfig] = useState<CustomCacheConfig>(defaultCustomConfig)
  const [defines, setDefines] = useState<DefineEntry[]>([])
  const [exampleLangFilter, setExampleLangFilter] = useState<ExampleLangFilter>('all')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [sampleRate, setSampleRate] = useState(1)  // 1 = no sampling
  const [fastMode, setFastMode] = useState(false)  // false = full 3C tracking
  const [cacheSegments, setCacheSegments] = useState(false)
  const [eventLimit, setEventLimit] = useState(1000000)  // Default 1M events
  const [longRunning, setLongRunning] = useState(false)
  const { progress, queueProgress, clearProgress } = useThrottledProgress()

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
  const [experimentResult, setExperimentResult] = useState<HardwareExperimentResult | null>(null)
  const [showExperimentModal, setShowExperimentModal] = useState(false)
  const [experimentRunning, setExperimentRunning] = useState(false)
  const [experimentError, setExperimentError] = useState<string | null>(null)
  const [experimentVariants, setExperimentVariants] = useState('direct\ntiled:RUN_TILED=1')
  const [experimentVariantSources, setExperimentVariantSources] = useState<ExperimentVariantSource[] | null>(null)
  const [experimentVariantSourceLabel, setExperimentVariantSourceLabel] = useState<string | null>(null)
  const [selectedExperimentTemplateId, setSelectedExperimentTemplateId] = useState(EXPERIMENT_TEMPLATES[0]?.id || '')
  const [hardwareProfiles, setHardwareProfiles] = useState<HardwareProfile[]>([])
  const [showHardwareExplorer, setShowHardwareExplorer] = useState(false)
  const [hardwareProfilesLoading, setHardwareProfilesLoading] = useState(false)
  const [hardwareProfilesError, setHardwareProfilesError] = useState<string | null>(null)
  const [selectedHardwareProfileId, setSelectedHardwareProfileId] = useState('')
  const [runHardwareConfigIds, setRunHardwareConfigIds] = useState<string[]>(readStoredHardwareRunSet)
  const [showWorkloadCatalog, setShowWorkloadCatalog] = useState(false)
  const [workloads, setWorkloads] = useState<WorkloadSnapshot[]>([])
  const [workloadsLoading, setWorkloadsLoading] = useState(false)
  const [workloadsVerifying, setWorkloadsVerifying] = useState(false)
  const [workloadsError, setWorkloadsError] = useState<string | null>(null)
  const [workloadVerification, setWorkloadVerification] = useState<WorkloadVerificationResponse | null>(null)
  const [batchTotal, setBatchTotal] = useState(BATCH_HARDWARE_CONFIGS.length)
  const commandInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const decorationsRef = useRef<string[]>([])  // For hover/miss decorations
  const vimStatusRef = useRef<HTMLDivElement>(null)
  const vimModeRef = useRef<{ dispose: () => void } | null>(null)

  const shareState = useMemo<ShareableState>(() => ({
    code,
    config,
    optLevel,
    language,
    files: files.map(file => ({
      name: file.name,
      code: file.code,
      language: file.language,
      isMain: file.id === mainFileId,
    })),
    activeFileName: activeFile?.name,
    mainFileName: files.find(file => file.id === mainFileId)?.name,
    defines,
    prefetchPolicy,
    selectedCompiler: selectedCompiler || undefined,
    sampleRate,
    eventLimit,
    fastMode,
    cacheSegments,
    customConfig: config === 'custom' ? customConfig : undefined,
    runHardwareConfigIds,
    experimentVariants,
  }), [
    activeFileId,
    cacheSegments,
    code,
    config,
    customConfig,
    defines,
    eventLimit,
    experimentVariants,
    fastMode,
    files,
    language,
    mainFileId,
    optLevel,
    prefetchPolicy,
    runHardwareConfigIds,
    sampleRate,
    selectedCompiler,
  ])

  // Theme sync
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cache-explorer-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(HARDWARE_RUN_SET_STORAGE_KEY, JSON.stringify(runHardwareConfigIds))
  }, [runHardwareConfigIds])


  // Fetch default compiler on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/compilers`)
      .then(res => res.json())
      .then(data => {
        if (data.default) {
          setSelectedCompiler(prev => prev || data.default)
        } else if (data.compilers && data.compilers.length > 0) {
          setSelectedCompiler(prev => prev || data.compilers[0].id)
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
      const applyState = (state: ShareableState) => {
        const sharedFiles = Array.isArray(state.files)
          ? state.files.filter(file => file.name && typeof file.code === 'string' && file.language)
          : []

        if (sharedFiles.length > 0) {
          const newFiles = sharedFiles.map(file => ({
            ...createFileTab(file.name, file.code, file.language),
            isMain: file.isMain,
          }))
          const mainFile = newFiles.find(file => file.name === state.mainFileName)
            || newFiles.find(file => file.isMain)
            || newFiles[0]
          const active = newFiles.find(file => file.name === state.activeFileName) || mainFile

          setFiles(newFiles)
          setActiveFileId(active.id)
          setMainFileId(mainFile.id)
        } else {
          const lang = state.language || 'c'
          const newFile = createFileTab(`main${getFileExtension(lang)}`, state.code, lang)
          setFiles([newFile])
          setActiveFileId(newFile.id)
          setMainFileId(newFile.id)
        }
        setConfig(state.config)
        setOptLevel(state.optLevel)
        if (state.defines) setDefines(state.defines)
        if (state.prefetchPolicy) setPrefetchPolicy(state.prefetchPolicy)
        if (state.selectedCompiler) setSelectedCompiler(state.selectedCompiler)
        if (typeof state.sampleRate === 'number') setSampleRate(state.sampleRate)
        if (typeof state.eventLimit === 'number') setEventLimit(state.eventLimit)
        if (typeof state.fastMode === 'boolean') setFastMode(state.fastMode)
        if (typeof state.cacheSegments === 'boolean') setCacheSegments(state.cacheSegments)
        if (state.customConfig) setCustomConfig({ ...defaultCustomConfig, ...state.customConfig })
        if (Array.isArray(state.runHardwareConfigIds)) {
          const nextRunSet = Array.from(new Set(state.runHardwareConfigIds.filter(Boolean)))
          if (nextRunSet.length > 0) setRunHardwareConfigIds(nextRunSet)
        }
        if (state.experimentVariants) setExperimentVariants(state.experimentVariants)
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
      const encoded = encodeState(shareState)
      window.history.replaceState(null, '', `${window.location.pathname}#${encoded}`)
    }, 500)
    return () => clearTimeout(timer)
  }, [shareState])

  const handleShare = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/shorten`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: shareState }),
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
  }, [shareState])

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
    const inlineBadges = new Map<number, { parts: string[]; className: string }>()

    const addInlineBadge = (lineNumber: number, text: string, className: string) => {
      const current = inlineBadges.get(lineNumber)
      if (current) {
        current.parts.push(text)
        if (className.startsWith('inline-hw')) current.className = className
      } else {
        inlineBadges.set(lineNumber, { parts: [text], className })
      }
    }

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

          addInlineBadge(
            lineNum,
            `${line.misses} misses (${(line.missRate * 100).toFixed(0)}%)`,
            inlineClass,
          )
        }
      }
    }

    for (const annotation of result.sourceAnnotations || []) {
      const fileName = annotation.file.split('/').pop() || annotation.file
      if (fileName.includes('cache-explorer') || annotation.file.startsWith('/tmp/')) {
        const lineNum = annotation.line
        if (lineNum > 0 && lineNum <= model.getLineCount()) {
          const className = `line-${annotationClass(annotation)}`
          decorations.push({
            range: new monaco.Range(lineNum, 1, lineNum, 1),
            options: {
              isWholeLine: true,
              className,
              glyphMarginClassName: `glyph-${annotationClass(annotation)}`,
              glyphMarginHoverMessage: {
                value: `**${annotation.label}**\n\n${annotation.detail}\n\n${annotation.metrics.cycles.toLocaleString()} cycles`
              }
            }
          })
          addInlineBadge(lineNum, annotationBadge(annotation), `inline-${annotationClass(annotation)}`)
        }
      }
    }

    for (const [lineNum, badge] of inlineBadges) {
      const lineContent = model.getLineContent(lineNum)
      decorations.push({
        range: new monaco.Range(lineNum, lineContent.length + 1, lineNum, lineContent.length + 1),
        options: {
          after: {
            content: ` // ${badge.parts.join(' | ')}`,
            inlineClassName: badge.className
          }
        }
      })
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
    if (longRunTimeoutRef.current) {
      clearTimeout(longRunTimeoutRef.current)
      longRunTimeoutRef.current = null
    }
    setStage('idle')
    setLongRunning(false)
    clearProgress()
  }, [clearProgress])

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
    clearProgress()

    // Set long-running warning after 10 seconds
    longRunTimeoutRef.current = setTimeout(() => setLongRunning(true), 10000)

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
      payload.limit = eventLimit
      if (selectedCompiler) payload.compiler = selectedCompiler
      if (fastMode) payload.fast = true
      if (cacheSegments) payload.cacheSegments = true
      ws.send(JSON.stringify(payload))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'status') setStage(msg.stage as Stage)
      else if (msg.type === 'progress' && msg.eventsProcessed !== undefined) {
        queueProgress(normalizeProgressMessage(msg))
        setStage('processing')
      } else if (msg.type === 'result') {
        if (longRunTimeoutRef.current) {
          clearTimeout(longRunTimeoutRef.current)
          longRunTimeoutRef.current = null
        }
        setLongRunning(false)
        clearProgress()
        setResult(msg.data as CacheResult)
        setStage('idle')
        wsRef.current = null
        ws.close()
      } else if (msg.type === 'error' || msg.type?.includes('error') || msg.errors) {
        if (longRunTimeoutRef.current) {
          clearTimeout(longRunTimeoutRef.current)
          longRunTimeoutRef.current = null
        }
        setLongRunning(false)
        clearProgress()
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
      clearProgress()

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
        payload.limit = eventLimit
        if (fastMode) payload.fast = true
        if (cacheSegments) payload.cacheSegments = true

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
        if (longRunTimeoutRef.current) {
          clearTimeout(longRunTimeoutRef.current)
          longRunTimeoutRef.current = null
        }
        setLongRunning(false)
        clearProgress()
        setStage('idle')
      }
    }
  }

  const isLoading = stage !== 'idle'

  const makeHardwarePayload = useCallback(() => {
    const payload: Record<string, unknown> = {
      optLevel,
    }

    if (files.length === 1) {
      payload.code = files[0].code
      payload.language = files[0].language
    } else {
      payload.files = files.map(f => ({ name: f.name, code: f.code, language: f.language }))
      payload.language = files[0].language
    }

    if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())
    if (prefetchPolicy !== 'none') payload.prefetch = prefetchPolicy
    if (sampleRate > 1) payload.sample = sampleRate
    payload.limit = eventLimit
    if (selectedCompiler) payload.compiler = selectedCompiler
    if (fastMode) payload.fast = true
    if (cacheSegments) payload.cacheSegments = true

    return payload
  }, [cacheSegments, defines, eventLimit, fastMode, files, optLevel, prefetchPolicy, sampleRate, selectedCompiler])

  // Batch analysis - compare same code across multiple hardware presets
  const runBatchAnalysis = useCallback(async () => {
    const configsToRun = hardwareConfigsOrDefault(runHardwareConfigIds)
    setBatchResults([])
    setBatchRunning(true)
    setBatchTotal(configsToRun.length)
    setShowBatchModal(true)

    const canUseCompareEndpoint =
      files.length === 1 && (files[0].language === 'c' || files[0].language === 'cpp')

    if (canUseCompareEndpoint) {
      try {
        const response = await fetch(`${API_BASE}/compare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...makeHardwarePayload(),
            configs: configsToRun,
          }),
        })
        const data = await response.json()

        if (response.ok && data.configs) {
          setBatchResults(
            configsToRun
              .filter(cfg => data.configs[cfg])
              .map(cfg => ({ config: cfg, result: data.configs[cfg] as CacheResult }))
          )
          setBatchRunning(false)
          return
        }
      } catch {
        // Fall back to per-config analysis below.
      }
    }

    for (const cfg of configsToRun) {
      try {
        const payload = {
          ...makeHardwarePayload(),
          config: cfg,
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
  }, [files, makeHardwarePayload, runHardwareConfigIds])

  const openExperimentModal = useCallback(() => {
    setShowExperimentModal(true)
  }, [])

  const loadWorkloads = useCallback(async () => {
    setWorkloadsLoading(true)
    setWorkloadsError(null)
    try {
      const response = await fetch(`${API_BASE}/api/workloads`)
      const data = await response.json()
      if (!response.ok || !Array.isArray(data.workloads)) {
        setWorkloadsError(data.message || data.error || 'Failed to load workloads')
        return
      }
      setWorkloads(data.workloads as WorkloadSnapshot[])
    } catch (err) {
      setWorkloadsError(err instanceof Error ? err.message : 'Failed to load workloads')
    } finally {
      setWorkloadsLoading(false)
    }
  }, [])

  const verifyWorkloads = useCallback(async () => {
    setWorkloadsVerifying(true)
    setWorkloadsError(null)
    try {
      const response = await fetch(`${API_BASE}/api/workloads/verify`)
      const data = await response.json()
      if (!response.ok || !data.summary || !Array.isArray(data.workloads)) {
        setWorkloadsError(data.message || data.error || 'Failed to verify workloads')
        return
      }
      setWorkloadVerification(data as WorkloadVerificationResponse)
    } catch (err) {
      setWorkloadsError(err instanceof Error ? err.message : 'Failed to verify workloads')
    } finally {
      setWorkloadsVerifying(false)
    }
  }, [])

  const openWorkloadCatalog = useCallback(() => {
    setShowWorkloadCatalog(true)
    if (workloads.length === 0 && !workloadsLoading) {
      void loadWorkloads()
    }
  }, [loadWorkloads, workloads.length, workloadsLoading])

  const exampleKeyForPath = useCallback((examplePath: string) => {
    const base = examplePath.split('/').pop()?.replace(/\.(c|cpp|cc|cxx|rs|zig)$/, '')
    if (!base) return null
    if (Object.prototype.hasOwnProperty.call(EXAMPLES, base)) return base
    if (base === 'cache_blocking' && EXAMPLES.blocking) return 'blocking'
    return null
  }, [])

  const exampleForPath = useCallback((examplePath: string) => {
    const key = exampleKeyForPath(examplePath)
    return key ? EXAMPLES[key] : null
  }, [exampleKeyForPath])

  const sourceVariantsForWorkload = useCallback((workload: WorkloadSnapshot): ExperimentVariantSource[] | null => {
    const needsStructuredVariants = workload.variants.some(variant =>
      (variant.example && variant.example !== workload.example)
      || Boolean(variant.prefetch)
      || Boolean(variant.optLevel)
      || typeof variant.limit === 'number'
    )
    if (!needsStructuredVariants) return null

    const sourceVariants = workload.variants.map(variant => {
      const example = exampleForPath(variant.example || workload.example)
      if (!example) return null

      const source: ExperimentVariantSource = {
        id: variant.id,
        language: example.language,
        optLevel: variant.optLevel || workload.optLevel,
        limit: variant.limit ?? workload.limit,
        prefetch: variant.prefetch,
        defines: variant.defines || [],
      }
      if (example.files && example.files.length > 0) {
        source.files = example.files
      } else {
        source.code = example.code
      }
      return source
    })

    if (sourceVariants.some(variant => !variant)) return null
    return sourceVariants as ExperimentVariantSource[]
  }, [exampleForPath])

  const loadWorkload = useCallback((workload: WorkloadSnapshot) => {
    const exampleKey = exampleKeyForPath(workload.example)
    if (exampleKey) loadExampleByKey(exampleKey)
    setConfig(workload.config)
    setSelectedHardwareProfileId(workload.config)
    setRunHardwareConfigIds([workload.config])
    setPrefetchPolicy((workload.prefetch as PrefetchPolicy | undefined) || PREFETCH_DEFAULTS[workload.config] || 'none')
    if (workload.optLevel) setOptLevel(workload.optLevel)
    if (typeof workload.limit === 'number') setEventLimit(workload.limit)
    setExperimentVariants(workload.variants.map(variant => {
      const defines = (variant.defines || []).join(',')
      return defines ? `${variant.id}:${defines}` : variant.id
    }).join('\n'))

    const sourceVariants = sourceVariantsForWorkload(workload)
    if (sourceVariants) {
      setExperimentVariantSources(sourceVariants)
      setExperimentVariantSourceLabel(`Variant set ${workload.id}`)
    } else {
      setExperimentVariantSources(null)
      setExperimentVariantSourceLabel(null)
    }
    setExperimentResult(null)
    setExperimentError(null)
    setShowWorkloadCatalog(false)
    setShowExperimentModal(true)
  }, [exampleKeyForPath, loadExampleByKey, sourceVariantsForWorkload])

  const applyExperimentTemplate = useCallback(() => {
    const template = EXPERIMENT_TEMPLATES.find(item => item.id === selectedExperimentTemplateId)
    if (!template) return

    setExperimentVariants(template.variants.join('\n'))
    setExperimentVariantSources(null)
    setExperimentVariantSourceLabel(null)
    if (template.exampleKey) loadExampleByKey(template.exampleKey)
    if (template.optLevel) setOptLevel(template.optLevel)
    if (template.prefetchPolicy) setPrefetchPolicy(template.prefetchPolicy)
    if (typeof template.eventLimit === 'number') setEventLimit(template.eventLimit)
    if (typeof template.fastMode === 'boolean') setFastMode(template.fastMode)
    if (typeof template.cacheSegments === 'boolean') setCacheSegments(template.cacheSegments)
  }, [loadExampleByKey, selectedExperimentTemplateId])

  const loadHardwareProfiles = useCallback(async () => {
    setHardwareProfilesLoading(true)
    setHardwareProfilesError(null)

    try {
      const response = await fetch(`${API_BASE}/profiles`)
      const data = await response.json()
      if (!response.ok || !Array.isArray(data.profiles)) {
        setHardwareProfilesError(data.message || data.error || 'Failed to load profiles')
        return
      }

      const profiles = data.profiles as HardwareProfile[]
      const canonicalIds = new Map<string, string>()
      for (const profile of profiles) {
        canonicalIds.set(profile.id, profile.id)
        for (const alias of profile.aliases || []) {
          canonicalIds.set(alias, profile.id)
        }
      }
      setHardwareProfiles(profiles)
      setRunHardwareConfigIds(prev => {
        const normalized = Array.from(new Set(
          prev.map(profileId => canonicalIds.get(profileId)).filter((profileId): profileId is string => Boolean(profileId))
        ))
        if (normalized.length > 0) return normalized

        const defaults = BATCH_HARDWARE_CONFIGS.filter(profileId => canonicalIds.has(profileId))
        return defaults.length > 0 ? defaults : profiles.slice(0, 1).map(profile => profile.id)
      })
      setSelectedHardwareProfileId(prev => {
        const normalized = canonicalIds.get(prev)
        if (normalized) return normalized
        return profiles.find(profile => profile.id === config)?.id || profiles[0]?.id || ''
      })
    } catch (err) {
      setHardwareProfilesError(err instanceof Error ? err.message : 'Failed to load profiles')
    } finally {
      setHardwareProfilesLoading(false)
    }
  }, [config])

  const openHardwareExplorer = useCallback(() => {
    setShowHardwareExplorer(true)
    if (hardwareProfiles.length === 0 && !hardwareProfilesLoading) {
      void loadHardwareProfiles()
    }
  }, [hardwareProfiles.length, hardwareProfilesLoading, loadHardwareProfiles])

  const applyHardwareProfile = useCallback((profileId: string) => {
    setConfig(profileId)
    setPrefetchPolicy(PREFETCH_DEFAULTS[profileId] || 'none')
    setSelectedHardwareProfileId(profileId)
    setRunHardwareConfigIds(prev => prev.includes(profileId) ? prev : [...prev, profileId])
  }, [])

  const toggleRunHardwareConfig = useCallback((profileId: string) => {
    setRunHardwareConfigIds(prev => {
      if (!prev.includes(profileId)) return [...prev, profileId]
      if (prev.length === 1) return prev
      return prev.filter(id => id !== profileId)
    })
  }, [])

  const compareHardwareRunSet = useCallback(() => {
    setShowHardwareExplorer(false)
    void runBatchAnalysis()
  }, [runBatchAnalysis])

  const openExperimentFromExplorer = useCallback(() => {
    setShowHardwareExplorer(false)
    setShowExperimentModal(true)
  }, [])

  const runExperimentAnalysis = useCallback(async () => {
    const variants = experimentVariantSources || parseExperimentVariants(experimentVariants)
    if (variants.length === 0) {
      setExperimentError('Add at least one variant')
      return
    }

    setExperimentResult(null)
    setExperimentError(null)
    setExperimentRunning(true)
    setShowExperimentModal(true)

    try {
      const response = await fetch(`${API_BASE}/experiment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...makeHardwarePayload(),
          variants,
          configs: hardwareConfigsOrDefault(runHardwareConfigIds),
        }),
      })
      const data = await response.json()

      if (response.ok && data.summary && data.variants) {
        setExperimentResult(data as HardwareExperimentResult)
      } else {
        setExperimentError(data.message || data.error || 'Experiment failed')
      }
    } catch (err) {
      setExperimentError(err instanceof Error ? err.message : 'Experiment failed')
    } finally {
      setExperimentRunning(false)
    }
  }, [experimentVariantSources, experimentVariants, makeHardwarePayload, runHardwareConfigIds])

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
    { id: 'hardware-experiment', icon: '@', label: 'Open hardware experiment', action: openExperimentModal, category: 'actions' },
    { id: 'hardware-explorer', icon: '@', label: 'Open hardware explorer', action: openHardwareExplorer, category: 'actions' },
    { id: 'workloads', icon: '@', label: 'Open verified workloads', action: openWorkloadCatalog, category: 'actions' },
    // Settings (:)
    { id: 'vim', icon: ':', label: vimMode ? 'Disable Vim mode' : 'Enable Vim mode', action: () => setVimMode(!vimMode), category: 'settings' },
    { id: 'lang-c', icon: ':', label: 'Language: C', action: () => updateActiveLanguage('c'), category: 'settings' },
    { id: 'lang-cpp', icon: ':', label: 'Language: C++', action: () => updateActiveLanguage('cpp'), category: 'settings' },
    { id: 'lang-rust', icon: ':', label: 'Language: Rust', action: () => updateActiveLanguage('rust'), category: 'settings' },
    // Config (*)
    { id: 'sampling-none', icon: '*', label: 'Sampling: All events', action: () => setSampleRate(1), category: 'config' },
    { id: 'sampling-10', icon: '*', label: 'Sampling: 1:10', action: () => setSampleRate(10), category: 'config' },
    { id: 'sampling-100', icon: '*', label: 'Sampling: 1:100', action: () => setSampleRate(100), category: 'config' },
    { id: 'limit-1m', icon: '*', label: 'Event limit: 1M', action: () => setEventLimit(1000000), category: 'config' },
    { id: 'limit-5m', icon: '*', label: 'Event limit: 5M', action: () => setEventLimit(5000000), category: 'config' },
    { id: 'limit-none', icon: '*', label: 'Event limit: None', action: () => setEventLimit(0), category: 'config' },
  ], [isLoading, activeFileId, vimMode, diffMode, baselineResult, config, files, result, code, handleShare, updateActiveLanguage, setBaselineFromHook, clearBaselineHook, runBatchAnalysis, openExperimentModal, openHardwareExplorer, openWorkloadCatalog])

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
          total={batchTotal}
          onExportCSV={() => exportBatchResultsAsCSV(batchResults)}
          onExportJSON={() => exportBatchResultsAsJSON(batchResults)}
          onClose={() => setShowBatchModal(false)}
        />
      )}

      {/* Hardware Experiment Modal */}
      {showExperimentModal && (
        <ExperimentResultsModal
          result={experimentResult}
          running={experimentRunning}
          error={experimentError}
          variantsText={experimentVariants}
          variantSourceLabel={experimentVariantSourceLabel}
          hardwareConfigIds={hardwareConfigsOrDefault(runHardwareConfigIds)}
          templates={EXPERIMENT_TEMPLATES}
          selectedTemplateId={selectedExperimentTemplateId}
          onVariantsTextChange={(value) => {
            setExperimentVariants(value)
            setExperimentVariantSources(null)
            setExperimentVariantSourceLabel(null)
          }}
          onTemplateChange={setSelectedExperimentTemplateId}
          onApplyTemplate={applyExperimentTemplate}
          onRun={runExperimentAnalysis}
          onExportCSV={() => experimentResult && exportExperimentAsCSV(experimentResult)}
          onExportJSON={() => experimentResult && exportExperimentAsJSON(experimentResult)}
          onClose={() => setShowExperimentModal(false)}
        />
      )}

      {/* Hardware Explorer Modal */}
      {showHardwareExplorer && (
        <HardwareExplorerModal
          profiles={hardwareProfiles}
          selectedId={selectedHardwareProfileId}
          activeId={config}
          runConfigIds={runHardwareConfigIds}
          loading={hardwareProfilesLoading}
          error={hardwareProfilesError}
          onSelect={setSelectedHardwareProfileId}
          onApply={applyHardwareProfile}
          onToggleRunConfig={toggleRunHardwareConfig}
          onCompareRunSet={compareHardwareRunSet}
          onOpenExperiment={openExperimentFromExplorer}
          onRefresh={loadHardwareProfiles}
          onClose={() => setShowHardwareExplorer(false)}
        />
      )}

      {/* Verified Workloads Modal */}
      {showWorkloadCatalog && (
        <WorkloadCatalogModal
          workloads={workloads}
          verification={workloadVerification}
          loading={workloadsLoading}
          verifying={workloadsVerifying}
          error={workloadsError}
          onRefresh={loadWorkloads}
          onVerify={verifyWorkloads}
          onLoadWorkload={loadWorkload}
          onClose={() => setShowWorkloadCatalog(false)}
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
          onCompareHardware={runBatchAnalysis}
          onExploreHardware={openHardwareExplorer}
          onOpenWorkloads={openWorkloadCatalog}
          onRunExperiment={openExperimentModal}
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
          cacheSegments={cacheSegments}
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
          onCacheSegmentsChange={setCacheSegments}
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
            onLoadExample={loadExampleByKey}
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
          progress={progress}
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
          onRun={runAnalysis}
          onOpenWorkloads={openWorkloadCatalog}
          onOpenExperiment={openExperimentModal}
          isMobile={isMobile}
          mobilePane={mobilePane}
        />
      </div>

    </div>
  )
}

export default App
