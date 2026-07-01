import type { editor } from 'monaco-editor'
import type { CacheResult, ErrorResult, Stage } from '../types'
import {
  ErrorDisplay,
  MetricCards,
  DiffSummary,
  BottleneckSummaryPanel,
  CacheHierarchyViz,
  PrefetchStatsPanel,
  AdvancedStatsPanel,
  ExecutionEnginePanel,
  HardwareProfilePanel,
  LevelDetail,
  ResultProvenancePanel,
  TLBDetail,
  FalseSharingDisplay,
  HotLinesPanel,
  SuggestionsPanel,
  SourceAnnotationsPanel,
  CacheGrid,
  LoadingState,
  EmptyState,
} from './index'

interface ResultsPanelProps {
  result: CacheResult | null
  baselineResult: CacheResult | null
  baselineConfig?: string | null
  error: ErrorResult | null
  isLoading: boolean
  stage: Stage
  longRunning: boolean
  diffMode: boolean
  showDetails: boolean
  onToggleDetails: () => void
  code: string
  selectedHotLineFile: string
  onHotLineFileChange: (file: string) => void
  editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>
  copied: boolean
  onShare: () => void
  onExportJSON?: () => void
  onExportCSV?: () => void
  targetSummary: string
  onRun: () => void
  onOpenHardware: () => void
  onOpenWorkloads: () => void
  onOpenExperiment: () => void
  isMobile: boolean
  mobilePane: 'editor' | 'results'
}

export function ResultsPanel({
  result,
  baselineResult,
  baselineConfig,
  error,
  isLoading,
  stage,
  longRunning,
  diffMode,
  showDetails,
  onToggleDetails,
  code,
  selectedHotLineFile,
  onHotLineFileChange,
  editorRef,
  copied,
  onShare,
  onExportJSON,
  onExportCSV,
  targetSummary,
  onRun,
  onOpenHardware,
  onOpenWorkloads,
  onOpenExperiment,
  isMobile,
  mobilePane,
}: ResultsPanelProps) {
  const execution = result?.subsystems?.execution ?? result?.execution

  return (
    <div className={`results-panel${isMobile && mobilePane !== 'results' ? ' mobile-hidden' : ''}`}>
      <div className="results-header">
        <span className="results-title">Analysis Results</span>
        <div className="results-actions">
          {result && (
            <>
              <button className="btn btn-small" onClick={onExportJSON} title="Download JSON" aria-label="Download result JSON">
                JSON
              </button>
              <button className="btn btn-small" onClick={onExportCSV} title="Download CSV" aria-label="Download result CSV">
                CSV
              </button>
            </>
          )}
          <button className="btn btn-small" onClick={onShare} title="Copy link" aria-label="Copy share link">
            {copied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </div>
      <div className="results-scroll">
        {error && <ErrorDisplay error={error} />}

        {result && (
          <>
            {/* Diff Summary Panel */}
            {diffMode && baselineResult && (
              <DiffSummary result={result} baselineResult={baselineResult} baselineConfig={baselineConfig} />
            )}

            {/* Metric Cards */}
            <MetricCards result={result} baselineResult={baselineResult} diffMode={diffMode} />

            {/* Result Fidelity */}
            <ResultProvenancePanel result={result} />

            {/* Hardware Bottleneck Summary */}
            {result.summary && <BottleneckSummaryPanel summary={result.summary} />}

            {/* Hardware Profile */}
            {result.profile && <HardwareProfilePanel profile={result.profile} cacheConfig={result.cacheConfig} />}

            {/* Cache Hierarchy Visualization */}
            <CacheHierarchyViz result={result} baselineResult={baselineResult} diffMode={diffMode} />

            {/* Prefetch Stats */}
            {result.prefetch && <PrefetchStatsPanel stats={result.prefetch} />}

            {/* Advanced Stats */}
            {result.advancedStats && <AdvancedStatsPanel stats={result.advancedStats} />}

            {/* Execution Engine */}
            {execution && <ExecutionEnginePanel execution={execution} />}

            {/* Source Annotations */}
            {result.sourceAnnotations && <SourceAnnotationsPanel annotations={result.sourceAnnotations} />}

            {/* Toggle Buttons */}
            <div className="toggle-buttons" style={{ margin: 'var(--space-4) 0' }}>
              <button
                className={`btn ${showDetails ? 'active' : ''}`}
                onClick={onToggleDetails}
                aria-expanded={showDetails}
                aria-controls="result-detail-sections"
              >
                {showDetails ? '▼ Details' : '▶ Details'}
              </button>
            </div>

            {showDetails && (
              <div id="result-detail-sections">
                <div className="details-grid">
                  <LevelDetail name="L1 Data" stats={result.levels.l1d || result.levels.l1!} />
                  {result.levels.l1i && <LevelDetail name="L1 Instruction" stats={result.levels.l1i} />}
                  <LevelDetail name="L2" stats={result.levels.l2} />
                  {(result.cacheConfig?.l3?.sizeKB ?? 0) > 0 && <LevelDetail name="L3" stats={result.levels.l3} />}
                </div>
                {result.tlb && (
                  <div className="tlb-grid">
                    <TLBDetail name="Data TLB" stats={result.tlb.dtlb} />
                    <TLBDetail name="Instruction TLB" stats={result.tlb.itlb} />
                  </div>
                )}
              </div>
            )}

            {result.coherence && result.coherence.falseSharingEvents > 0 && (
              <div className="panel warning">
                <div className="panel-header">
                  <span className="panel-title">False Sharing Detected</span>
                  <span className="panel-badge">{result.coherence.falseSharingEvents}</span>
                </div>
              </div>
            )}

            {result.falseSharing && result.falseSharing.length > 0 && (
              <FalseSharingDisplay
                falseSharing={result.falseSharing}
                lineSize={result.cacheConfig?.l1d?.lineSize || 64}
              />
            )}

            <HotLinesPanel
              hotLines={result.hotLines}
              baselineHotLines={diffMode && baselineResult ? baselineResult.hotLines : undefined}
              diffMode={diffMode}
              code={code}
              selectedFile={selectedHotLineFile}
              onFileChange={onHotLineFileChange}
              editorRef={editorRef}
            />

            {result.suggestions && <SuggestionsPanel suggestions={result.suggestions} />}

            {result.cacheState && (
              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">L1 Cache Grid</span>
                  <span className="panel-badge">Final State</span>
                </div>
                <CacheGrid cacheState={result.cacheState.l1d} />
              </div>
            )}
          </>
        )}

        {isLoading && <LoadingState stage={stage} longRunning={longRunning} />}

        {!result && !error && !isLoading && (
          <EmptyState
            targetSummary={targetSummary}
            onRun={onRun}
            onOpenHardware={onOpenHardware}
            onOpenWorkloads={onOpenWorkloads}
            onOpenExperiment={onOpenExperiment}
          />
        )}
      </div>
    </div>
  )
}
