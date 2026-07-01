# Layouts

## App Shell

The root UI is a single React/Vite route rendered by `frontend/src/App.tsx`. The desktop render branch composes:

- `Header`
- `SettingsToolbar`
- `ExamplesSidebar`
- `EditorPanel`
- `ResultsPanel`
- optional modals: batch, experiment, hardware explorer, workload catalog, command palette

`frontend/src/App.tsx` is large (1426 lines). For Superdesign context, pass the actual render branch and the imported visual components rather than the full state-management body.

Important render files:

- `frontend/src/App.tsx`
- `frontend/src/components/Header.tsx`
- `frontend/src/components/SettingsToolbar.tsx`
- `frontend/src/components/EditorPanel.tsx`
- `frontend/src/components/ResultsPanel.tsx`
- `frontend/src/components/ExamplesSidebar.tsx`
- `frontend/src/components/WorkloadCatalogModal.tsx`
- `frontend/src/components/HardwareExplorerModal.tsx`

## `frontend/src/components/Header.tsx`

Top title bar with logo, theme toggle, hardware/workload/explorer/experiment actions, baseline comparison actions, and execute/cancel controls.

```tsx
import type { CacheResult, Stage } from "../types";

interface HeaderProps {
  theme: "dark" | "light";
  diffMode: boolean;
  baselineResult: CacheResult | null;
  result: CacheResult | null;
  isLoading: boolean;
  stage: Stage;
  onToggleTheme: () => void;
  onSetDiffMode: (mode: boolean) => void;
  onSetBaseline: (result: CacheResult) => void;
  onClearBaseline: () => void;
  onCompareHardware: () => void;
  onExploreHardware: () => void;
  onOpenWorkloads: () => void;
  onRunExperiment: () => void;
  onRun: () => void;
  onCancel: () => void;
}

const stageText: Record<Stage, string> = {
  idle: "",
  connecting: "Connecting...",
  preparing: "Preparing...",
  compiling: "Compiling...",
  running: "Running...",
  processing: "Processing...",
  done: "",
};

export function Header({
  theme,
  diffMode,
  baselineResult,
  result,
  isLoading,
  stage,
  onToggleTheme,
  onSetDiffMode,
  onSetBaseline,
  onClearBaseline,
  onCompareHardware,
  onExploreHardware,
  onOpenWorkloads,
  onRunExperiment,
  onRun,
  onCancel,
}: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <div className="logo-mark">
            <div className="logo-layer l3"></div>
            <div className="logo-layer l2"></div>
            <div className="logo-layer l1"></div>
          </div>
          <span className="logo-title">Cache Explorer</span>
        </div>
      </div>

      <div className="header-center">
        {diffMode && baselineResult && (
          <div className="diff-mode-badge" title="Comparing against baseline">
            <span className="diff-mode-icon">⇄</span>
            <span className="diff-mode-text">Diff Mode</span>
            <button className="diff-mode-exit" onClick={() => onSetDiffMode(false)} title="Exit diff mode">×</button>
          </div>
        )}
      </div>

      <div className="header-right">
        <button className="btn-icon" onClick={onToggleTheme} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
          {theme === "dark" ? "☀" : "☾"}
        </button>

        {!isLoading && <button onClick={onCompareHardware} className="btn-hardware-compare" title="Compare hardware presets">Hardware</button>}
        {!isLoading && <button onClick={onOpenWorkloads} className="btn-workloads" title="Open verified workloads">Workloads</button>}
        {!isLoading && <button onClick={onExploreHardware} className="btn-explore" title="Open hardware explorer">Explore</button>}
        {!isLoading && <button onClick={onRunExperiment} className="btn-experiment" title="Run hardware experiment">Experiment</button>}

        {result && !isLoading && (
          <button
            onClick={() => {
              if (!baselineResult) onSetBaseline(result)
              else if (diffMode) onSetDiffMode(false)
              else onSetDiffMode(true)
            }}
            className={`btn-compare ${baselineResult ? (diffMode ? "active" : "has-baseline") : ""}`}
          >
            {!baselineResult ? "Set Baseline" : diffMode ? "Exit Compare" : "Compare"}
          </button>
        )}
        {baselineResult && !diffMode && (
          <button onClick={onClearBaseline} className="btn-icon btn-clear-baseline" title="Clear baseline">×</button>
        )}

        {isLoading ? (
          <button onClick={onCancel} className="btn-cancel" title="Cancel analysis">
            <span className="btn-spinner" />
            {stageText[stage]}
            <span className="cancel-x">×</span>
          </button>
        ) : (
          <button onClick={onRun} className="btn-primary">Execute</button>
        )}
      </div>
    </header>
  );
}
```

## Modal Shell

Product modals reuse `.batch-modal-overlay`, `.batch-modal`, `.batch-modal-header`, `.batch-modal-content`, `.batch-modal-title`, and `.batch-modal-close` classes. The workload and hardware explorer modals are dense operational dialogs, not marketing pages.
