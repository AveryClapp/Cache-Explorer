import type { LineMetric } from '../utils/lineMetrics'
import type { editor } from 'monaco-editor'
import type { CacheResult, ErrorResult, Stage } from '../types'
import { MemoryEvidencePanel } from './MemoryEvidencePanel'
import { TopologyPanel } from './TopologyPanel'
import { ErrorDisplay } from './ErrorDisplay'
import { MetricCards } from './MetricCards'
import { DiffSummary } from './DiffSummary'
import { BottleneckSummaryPanel } from './BottleneckSummaryPanel'
import { CacheHierarchyViz } from './CacheHierarchyViz'
import { PrefetchStatsPanel } from './PrefetchStatsPanel'
import { AdvancedStatsPanel } from './AdvancedStatsPanel'
import { ExecutionEnginePanel } from './ExecutionEnginePanel'
import { HardwareProfilePanel } from './HardwareProfilePanel'
import { LevelDetail, TLBDetail } from './CacheDetailComponents'
import { ResultProvenancePanel } from './ResultProvenancePanel'
import { TraceCompletenessNotice } from './TraceCompletenessNotice'
import { FalseSharingDisplay } from './FalseSharingDisplay'
import { HotLinesPanel } from './HotLinesPanel'
import { SuggestionsPanel } from './SuggestionsPanel'
import { SourceAnnotationsPanel } from './SourceAnnotationsPanel'
import { CacheGrid } from './CacheGrid'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'

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
  lineMetric: LineMetric
  onLineMetricChange: (metric: LineMetric) => void
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
  lineMetric,
  onLineMetricChange,
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
        <span className="results-title">Results</span>
        <div className="results-actions">
          {result && (
            <>
              <button className="btn btn-small" onClick={onExportJSON} title="Download JSON">
                JSON
              </button>
              <button className="btn btn-small" onClick={onExportCSV} title="Download CSV">
                CSV
              </button>
            </>
          )}
          <button className="btn btn-small" onClick={onShare} title="Copy link">
            {copied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </div>
      <div className="results-scroll">
        {error && <ErrorDisplay error={error} />}

        {result && (
          <>
            {/* Partial trace: abnormal exit or event limit */}
            <TraceCompletenessNotice completeness={result.traceCompleteness} />

            {/* Diff Summary Panel */}
            {diffMode && baselineResult && (
              <DiffSummary result={result} baselineResult={baselineResult} baselineConfig={baselineConfig} />
            )}

            {/* Metric Cards */}
            <MetricCards result={result} baselineResult={baselineResult} diffMode={diffMode} />

            {/* Hardware Bottleneck Summary */}
            {result.summary && <BottleneckSummaryPanel summary={result.summary} />}

            {/* Source lines with the most misses: the primary answer */}
            <HotLinesPanel
              hotLines={result.hotLines}
              baselineHotLines={diffMode && baselineResult ? baselineResult.hotLines : undefined}
              diffMode={diffMode}
              code={code}
              selectedFile={selectedHotLineFile}
              onFileChange={onHotLineFileChange}
              metric={lineMetric}
              onMetricChange={onLineMetricChange}
              editorRef={editorRef}
            />

            {result.suggestions && <SuggestionsPanel suggestions={result.suggestions} />}

            {result.coherence && result.coherence.falseSharingEvents > 0 && (
              <div className="panel warning">
                <div className="panel-header">
                  <span className="panel-title">False sharing detected</span>
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

            {/* Cache Hierarchy Visualization */}
            <CacheHierarchyViz result={result} baselineResult={baselineResult} diffMode={diffMode} />

            <button
              type="button"
              className="btn results-more-toggle"
              onClick={onToggleDetails}
              aria-expanded={showDetails}
              aria-controls="result-detail-sections"
            >
              {showDetails ? 'Hide detail' : 'More detail'}
              <span className="results-more-hint">CPU model, execution engine, per-level stats</span>
            </button>

            {showDetails && (
              <div id="result-detail-sections" className="result-detail-sections">
                {execution && <ExecutionEnginePanel execution={execution} />}
                {result.sourceAnnotations && <SourceAnnotationsPanel annotations={result.sourceAnnotations} />}
                <MemoryEvidencePanel result={result} />
                {result.prefetch && <PrefetchStatsPanel stats={result.prefetch} />}
                {result.advancedStats && <AdvancedStatsPanel stats={result.advancedStats} />}
                <TopologyPanel topology={result.subsystems?.topology} />
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
                {result.profile && <HardwareProfilePanel profile={result.profile} cacheConfig={result.cacheConfig} />}
                {result.cacheState && (
                  <div className="panel">
                    <div className="panel-header">
                      <span className="panel-title">L1 cache grid</span>
                      <span className="panel-badge">Final State</span>
                    </div>
                    <CacheGrid cacheState={result.cacheState.l1d} />
                  </div>
                )}
              </div>
            )}

            {/* How this result was produced */}
            <ResultProvenancePanel result={result} />
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
