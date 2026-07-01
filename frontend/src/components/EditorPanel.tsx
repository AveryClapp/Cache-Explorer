import Editor, { DiffEditor } from '@monaco-editor/react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { FileManager } from './FileManager'
import type { ProjectFile } from './FileManager'
import type { Language, Stage } from '../types'

interface EditorPanelProps {
  // Editor state
  code: string
  language: Language
  theme: 'dark' | 'light'
  isReadOnly: boolean
  isEmbedMode: boolean

  // Diff mode
  diffMode: boolean
  baselineCode: string | null

  // File management
  files: ProjectFile[]
  activeFileId: string
  onFileSelect: (id: string) => void
  onFileCreate: (name: string, language: Language) => void
  onFileDelete: (id: string) => void
  onFileRename: (id: string, name: string) => void
  onSetMainFile: (id: string) => void

  // Editor callbacks
  onCodeChange: (code: string) => void
  onEditorMount: (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => void

  // Status bar
  isLoading: boolean
  stage: Stage
  progress: { eventsProcessed: number; eventsTotal: number } | null
  config: string
  vimMode: boolean
  vimStatusRef: React.RefObject<HTMLDivElement | null>

  // Mobile
  isMobile: boolean
  mobilePane: 'editor' | 'results'
}

const stageText: Record<Stage, string> = {
  idle: '',
  connecting: 'Connecting...',
  preparing: 'Preparing...',
  compiling: 'Compiling...',
  running: 'Running...',
  processing: 'Simulating...',
  done: ''
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export function EditorPanel({
  code,
  language,
  theme,
  isReadOnly,
  isEmbedMode,
  diffMode,
  baselineCode,
  files,
  activeFileId,
  onFileSelect,
  onFileCreate,
  onFileDelete,
  onFileRename,
  onSetMainFile,
  onCodeChange,
  onEditorMount,
  isLoading,
  stage,
  progress,
  config,
  vimMode,
  vimStatusRef,
  isMobile,
  mobilePane,
}: EditorPanelProps) {
  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'rust' ? 'rust' : language === 'zig' ? 'rust' : 'c'
  const processedEvents = Math.max(0, progress?.eventsProcessed ?? 0)
  const totalEvents = Math.max(0, progress?.eventsTotal ?? 0)
  const hasProgress = Boolean(progress)
  const hasTotal = totalEvents > 0
  const displayProcessedEvents = hasTotal
    ? stage === 'done'
      ? totalEvents
      : Math.min(processedEvents, totalEvents)
    : processedEvents
  const progressPct = hasTotal ? clampPercent((displayProcessedEvents / totalEvents) * 100) : 0
  const statusLabel = isLoading
    ? hasTotal
      ? `${stageText[stage] || 'Processing...'} ${formatCount(displayProcessedEvents)} / ${formatCount(totalEvents)} events (${Math.round(progressPct)}%)`
      : hasProgress
        ? `${stageText[stage] || 'Processing...'} ${formatCount(displayProcessedEvents)} events`
        : stageText[stage]
    : 'Ready'

  return (
    <div className={`editor-area${isMobile && mobilePane !== 'editor' ? ' mobile-hidden' : ''}`}>
      {/* Tab Bar */}
      {!isEmbedMode && (
        <div className="tab-bar">
          <FileManager
            files={files}
            activeFileId={activeFileId}
            onFileSelect={onFileSelect}
            onFileCreate={onFileCreate}
            onFileDelete={onFileDelete}
            onFileRename={onFileRename}
            onSetMainFile={onSetMainFile}
          />
        </div>
      )}

      <div className="editor-container">
        {diffMode && baselineCode ? (
          <>
            <div className="diff-labels">
              <span className="diff-label baseline">Baseline</span>
              <span className="diff-label current">Current</span>
            </div>
            <DiffEditor
              height="calc(100% - 28px)"
              language={monacoLanguage}
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              original={baselineCode}
              modified={code}
              onMount={(editor) => {
                const modifiedEditor = editor.getModifiedEditor()
                modifiedEditor.onDidChangeModelContent(() => {
                  const newValue = modifiedEditor.getValue()
                  onCodeChange(newValue)
                })
              }}
              options={{ minimap: { enabled: false }, fontSize: 13, readOnly: false, originalEditable: false, renderSideBySide: true }}
            />
          </>
        ) : (
          <Editor
            height="100%"
            language={monacoLanguage}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={code}
            onChange={(value) => !isReadOnly && onCodeChange(value || '')}
            onMount={onEditorMount}
            options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', scrollBeyondLastLine: false, glyphMargin: true, readOnly: isReadOnly }}
          />
        )}
      </div>

      {/* Status Bar */}
      {!isEmbedMode && (
        <div className="status-bar">
          <div className="status-bar-left">
            <span className={`status-item analysis-status${isLoading ? ' active' : ''}`}>
              <span className={`status-indicator ${isLoading ? 'running' : 'idle'}`} />
              <span className="status-text">{statusLabel}</span>
              {isLoading && hasProgress && (
                <span
                  className={`analysis-progress${hasTotal ? '' : ' indeterminate'}`}
                  aria-label={hasTotal ? `Analysis progress ${Math.round(progressPct)} percent` : 'Analysis progress'}
                  aria-valuemin={hasTotal ? 0 : undefined}
                  aria-valuemax={hasTotal ? 100 : undefined}
                  aria-valuenow={hasTotal ? Math.round(progressPct) : undefined}
                  role={hasTotal ? 'progressbar' : 'status'}
                >
                  <span
                    className="analysis-progress-fill"
                    style={hasTotal ? { width: `${progressPct}%` } : undefined}
                  />
                </span>
              )}
            </span>
            <span className="status-item">{language.toUpperCase()}</span>
          </div>
          <div className="status-bar-right">
            {vimMode && <span className="status-item">VIM</span>}
            <span className="status-item">{config}</span>
          </div>
        </div>
      )}
      {vimMode && !isEmbedMode && <div ref={vimStatusRef} className="vim-status-bar" />}
    </div>
  )
}
