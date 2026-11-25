import { useEffect, useRef } from "react";
import type { CacheResult, EnvironmentHealth, Stage } from "../types";
import { STAGE_TEXT } from "../constants";
import { isCompareArea, productHref, type ProductArea } from "../utils/productArea";

interface HeaderProps {
  activeProductArea: ProductArea;
  compareArea: ProductArea;
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
  onOpenAnalyze: () => void;
  onNavigate: (area: ProductArea) => void;
  onExploreHardware: () => void;
  onOpenWorkloads: () => void;
  onPreloadProductArea: (area: ProductArea) => void;
  onRun: () => void;
  onCancel: () => void;
}

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
  if (health?.sandbox === "disabled") return "Unsandboxed (local)";
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
      {tone !== "healthy" && <span className="environment-status-main">{label}</span>}
      <span className="environment-status-compiler">{compiler}</span>
    </div>
  );
}

function MoreMenu({
  links,
  activeProductArea,
  onPreload,
}: {
  links: { area: ProductArea; label: string; open: () => void }[];
  activeProductArea: ProductArea;
  onPreload: (area: ProductArea) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const active = links.find((link) => link.area === activeProductArea);

  useEffect(() => {
    const close = (event: Event) => {
      const menu = ref.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        menu.open = false;
        menu.querySelector("summary")?.focus();
        return;
      }
      if (!menu.contains(event.target as Node)) menu.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="header-more">
      <summary className={`header-nav-item${active ? " active" : ""}`}>
        {active ? active.label : "More"}
        <span className="header-more-caret" aria-hidden="true">▾</span>
      </summary>
      <div className="header-more-menu">
        {links.map(({ area, label, open }) => (
          <a
            key={area}
            href={productHref(area)}
            className={`header-more-item${activeProductArea === area ? " active" : ""}`}
            aria-current={activeProductArea === area ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              if (ref.current) ref.current.open = false;
              open();
            }}
            onPointerEnter={() => onPreload(area)}
            onFocus={() => onPreload(area)}
          >
            {label}
          </a>
        ))}
      </div>
    </details>
  );
}

export function Header({
  activeProductArea,
  compareArea,
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
  onOpenAnalyze,
  onNavigate,
  onExploreHardware,
  onOpenWorkloads,
  onPreloadProductArea,
  onRun,
  onCancel,
}: HeaderProps) {
  // Compare groups the cross-CPU, code-variant and what-if views; its link
  // returns to whichever of them was used last.
  const productLinks = [
    { area: "analyze" as ProductArea, label: "Analyze", open: onOpenAnalyze, active: activeProductArea === "analyze" },
    { area: compareArea, label: "Compare", open: () => onNavigate(compareArea), active: isCompareArea(activeProductArea) },
    { area: "profiles" as ProductArea, label: "CPU profiles", open: onExploreHardware, active: activeProductArea === "profiles" },
  ];
  const moreLinks = [
    { area: "workloads" as ProductArea, label: "Workloads", open: onOpenWorkloads },
    { area: "binary" as ProductArea, label: "Binary profiles", open: () => onNavigate("binary") },
  ];

  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <div className="logo-mark">
            <div className="logo-layer l3"></div>
            <div className="logo-layer l2"></div>
            <div className="logo-layer l1"></div>
          </div>
          <span className="logo-copy">
            <span className="logo-title-row">
              <span className="logo-title">Hardware Explorer</span>
              <span className="preview-badge">Preview</span>
            </span>
          </span>
        </div>
      </div>

      <nav className="header-nav" aria-label="Product">
        {productLinks.map(({ area, label, open, active }) => (
          <a
            key={label}
            href={productHref(area)}
            className={`header-nav-item${active ? " active" : ""}`}
            onClick={(event) => {
              event.preventDefault();
              open();
            }}
            onPointerEnter={() => onPreloadProductArea(area)}
            onFocus={() => onPreloadProductArea(area)}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </a>
        ))}
        <MoreMenu links={moreLinks} activeProductArea={activeProductArea} onPreload={onPreloadProductArea} />
      </nav>

      <div className="header-center">
        {activeProductArea !== 'binary' &&
        <EnvironmentStatus
          health={environmentHealth}
          error={environmentHealthError}
          selectedCompiler={selectedCompiler}
          compilerCount={compilerCount}
        />}
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

        {/* Baseline comparison: one control, only where results live */}
        {activeProductArea === 'analyze' && result && !isLoading && !baselineResult && (
          <button
            onClick={() => onSetBaseline(result)}
            className="btn-compare"
            title="Keep this result; the next run is compared against it"
          >
            Set Baseline
          </button>
        )}
        {activeProductArea === 'analyze' && baselineResult && (
          <div className={`compare-control${diffMode ? " active" : ""}`}>
            <button
              onClick={() => onSetDiffMode(!diffMode)}
              className={`btn-compare${diffMode ? " active" : " has-baseline"}`}
              disabled={isLoading || !result}
              title={diffMode ? "Hide the comparison" : "Compare the current result with the baseline"}
            >
              {diffMode ? "Comparing to baseline" : "Compare to baseline"}
            </button>
            <button
              onClick={onClearBaseline}
              className="btn-icon btn-clear-baseline"
              title="Clear baseline"
              aria-label="Clear comparison baseline"
            >
              ×
            </button>
          </div>
        )}

        {activeProductArea === 'analyze' && (isLoading ? (
          <button
            onClick={onCancel}
            className="btn-cancel"
            title="Cancel analysis"
            aria-label="Cancel analysis"
          >
            <span className="btn-spinner" />
            {STAGE_TEXT[stage]}
            <span className="cancel-x">×</span>
          </button>
        ) : (
          <button onClick={onRun} className="btn-primary">
            Run analysis
          </button>
        ))}
      </div>
    </header>
  );
}
