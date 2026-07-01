# Pages

## `/` Main Workspace

Entry: `frontend/src/App.tsx`

Dependencies:

- `frontend/src/App.tsx`
  - `frontend/src/styles/index.css`
  - `frontend/src/components/index.ts`
    - `frontend/src/components/Header.tsx`
    - `frontend/src/components/CommandPalette.tsx`
    - `frontend/src/components/SettingsToolbar.tsx`
      - `frontend/src/components/StyledSelect.tsx`
      - `frontend/src/constants/options.ts`
    - `frontend/src/components/ExamplesSidebar.tsx`
    - `frontend/src/components/BatchResultsModal.tsx`
    - `frontend/src/components/ExperimentResultsModal.tsx`
    - `frontend/src/components/HardwareExplorerModal.tsx`
      - `frontend/src/components/HardwareProfilePanel.tsx`
      - `frontend/src/utils/export.ts`
    - `frontend/src/components/WorkloadCatalogModal.tsx`
    - `frontend/src/components/ResultsPanel.tsx`
      - `frontend/src/components/ErrorDisplay.tsx`
      - `frontend/src/components/MetricCards.tsx`
      - `frontend/src/components/DiffSummary.tsx`
      - `frontend/src/components/BottleneckSummaryPanel.tsx`
      - `frontend/src/components/CacheHierarchyViz.tsx`
      - `frontend/src/components/PrefetchStatsPanel.tsx`
      - `frontend/src/components/AdvancedStatsPanel.tsx`
      - `frontend/src/components/ExecutionEnginePanel.tsx`
      - `frontend/src/components/HardwareProfilePanel.tsx`
      - `frontend/src/components/CacheDetailComponents.tsx`
      - `frontend/src/components/ResultProvenancePanel.tsx`
      - `frontend/src/components/FalseSharingDisplay.tsx`
      - `frontend/src/components/HotLinesPanel.tsx`
      - `frontend/src/components/SuggestionsPanel.tsx`
      - `frontend/src/components/SourceAnnotationsPanel.tsx`
      - `frontend/src/components/CacheGrid.tsx`
      - `frontend/src/components/LoadingState.tsx`
      - `frontend/src/components/EmptyState.tsx`
    - `frontend/src/components/EditorPanel.tsx`
      - `frontend/src/components/FileManager.tsx`
  - `frontend/src/types/index.ts`
  - `frontend/src/constants/index.ts`
  - `frontend/src/hooks/index.ts`
  - `frontend/src/utils/formatting.ts`
  - `frontend/src/utils/state.ts`
  - `frontend/src/utils/export.ts`

## Target Design Surfaces

For Compiler Explorer-level polish, prioritize these surfaces:

- Main workspace empty and result states.
- Workload catalog modal, including verification and history/trend surfacing.
- Hardware explorer modal, especially profile confidence and run-set comparison.
- Result provenance panel, because reproducibility is core product trust.

## Superdesign Context Guidance

`App.tsx` and `App.redesign.css` are over 1000 lines. Use line ranges for the actual desktop render branch and pass imported visual components in full. Do not pass build output or `node_modules`.
