import type { CacheResult, EnvironmentHealth, Stage } from "../types";

interface HeaderProps {
  theme: "dark" | "light";
  diffMode: boolean;
  baselineResult: CacheResult | null;
  result: CacheResult | null;
  isLoading: boolean;
  stage: Stage;
  environmentHealth: EnvironmentHealth | null;
  environmentHealthError: string | null;
  selectedCompiler: string;
  compilerCount: number;
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

function healthTone(health: EnvironmentHealth | null, error: string | null) {
  if (error) return "offline";
  if (!health) return "checking";
  if (health.status === "healthy") return "healthy";
  if (health.status === "degraded") return "degraded";
  return "offline";
}

function healthLabel(health: EnvironmentHealth | null, error: string | null) {
  if (error) return "Offline";
  if (!health) return "Checking";
  if (health.status === "healthy") return "Healthy";
  if (health.status === "degraded") return "Degraded";
  return "Unhealthy";
}

function sandboxLabel(health: EnvironmentHealth | null) {
  if (health?.sandbox === "enabled") return "Sandbox";
  if (health?.sandbox === "disabled") return "Direct";
  return "Mode ?";
}

function checksLabel(health: EnvironmentHealth | null) {
  if (!health?.checks) return "";
  return Object.entries(health.checks)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function EnvironmentStatus({
  health,
  error,
  selectedCompiler,
  compilerCount,
}: {
  health: EnvironmentHealth | null;
  error: string | null;
  selectedCompiler: string;
  compilerCount: number;
}) {
  const tone = healthTone(health, error);
  const label = healthLabel(health, error);
  const mode = sandboxLabel(health);
  const compiler = selectedCompiler || (compilerCount > 0 ? `${compilerCount} compilers` : "Compiler ?");
  const title = [
    `Backend: ${label}`,
    `Execution: ${mode}`,
    selectedCompiler ? `Compiler: ${selectedCompiler}` : `Compilers: ${compilerCount || "unknown"}`,
    health?.version ? `Version: ${health.version}` : "",
    error ? `Error: ${error}` : "",
    checksLabel(health),
  ].filter(Boolean).join("\n");

  return (
    <div className={`environment-status ${tone}`} title={title} role="status" aria-label={`Environment ${label}`}>
      <span className="environment-status-dot" />
      <span className="environment-status-main">{label}</span>
      <span className="environment-status-chip">{mode}</span>
      <span className="environment-status-compiler">{compiler}</span>
    </div>
  );
}

export function Header({
  theme,
  diffMode,
  baselineResult,
  result,
  isLoading,
  stage,
  environmentHealth,
  environmentHealthError,
  selectedCompiler,
  compilerCount,
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
        <EnvironmentStatus
          health={environmentHealth}
          error={environmentHealthError}
          selectedCompiler={selectedCompiler}
          compilerCount={compilerCount}
        />
        {diffMode && baselineResult && (
          <div className="diff-mode-badge" title="Comparing against baseline">
            <span className="diff-mode-icon">⇄</span>
            <span className="diff-mode-text">Diff Mode</span>
            <button
              className="diff-mode-exit"
              onClick={() => onSetDiffMode(false)}
              title="Exit diff mode"
              aria-label="Exit diff mode"
            >
              ×
            </button>
          </div>
        )}
      </div>

      <div className="header-right">
        <button
          className="btn-icon"
          onClick={onToggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>

        {!isLoading && (
          <button
            onClick={onCompareHardware}
            className="btn-hardware-compare"
            title="Compare hardware presets"
          >
            Hardware
          </button>
        )}

        {!isLoading && (
          <button
            onClick={onOpenWorkloads}
            className="btn-workloads"
            title="Open verified workloads"
          >
            Workloads
          </button>
        )}

        {!isLoading && (
          <button
            onClick={onExploreHardware}
            className="btn-explore"
            title="Open hardware explorer"
          >
            Explore
          </button>
        )}

        {!isLoading && (
          <button
            onClick={onRunExperiment}
            className="btn-experiment"
            title="Run hardware experiment"
          >
            Experiment
          </button>
        )}

        {/* Compare button - visible when result exists */}
        {result && !isLoading && (
          <button
            onClick={() => {
              if (!baselineResult) {
                onSetBaseline(result);
              } else if (diffMode) {
                onSetDiffMode(false);
              } else {
                onSetDiffMode(true);
              }
            }}
            className={`btn-compare ${baselineResult ? (diffMode ? "active" : "has-baseline") : ""}`}
            title={
              !baselineResult
                ? "Set current result as baseline for comparison"
                : diffMode
                  ? "Exit comparison mode"
                  : "Compare with baseline"
            }
          >
            {!baselineResult
              ? "Set Baseline"
              : diffMode
                ? "Exit Compare"
                : "Compare"}
          </button>
        )}
        {baselineResult && !diffMode && (
          <button
            onClick={onClearBaseline}
            className="btn-icon btn-clear-baseline"
            title="Clear baseline"
            aria-label="Clear comparison baseline"
          >
            ×
          </button>
        )}

        {isLoading ? (
          <button
            onClick={onCancel}
            className="btn-cancel"
            title="Cancel analysis"
            aria-label="Cancel analysis"
          >
            <span className="btn-spinner" />
            {stageText[stage]}
            <span className="cancel-x">×</span>
          </button>
        ) : (
          <button onClick={onRun} className="btn-primary" aria-label="Execute analysis">
            Execute
          </button>
        )}
      </div>
    </header>
  );
}
