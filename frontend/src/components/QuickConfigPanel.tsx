import type { Compiler, PrefetchPolicy } from '../types'

interface QuickConfigPanelProps {
  isOpen: boolean
  config: string
  optLevel: string
  prefetchPolicy: PrefetchPolicy
  compilers: Compiler[]
  selectedCompiler: string
  onConfigChange: (config: string) => void
  onOptLevelChange: (level: string) => void
  onPrefetchChange: (policy: string) => void
  onCompilerChange: (id: string) => void
  onClose: () => void
}

export function QuickConfigPanel({
  isOpen,
  config,
  optLevel,
  prefetchPolicy,
  compilers,
  selectedCompiler,
  onConfigChange,
  onOptLevelChange,
  onPrefetchChange,
  onCompilerChange,
  onClose
}: QuickConfigPanelProps) {
  if (!isOpen) return null

  return (
    <div className="quick-config-overlay" onClick={onClose}>
      <div className="quick-config" onClick={e => e.stopPropagation()}>
        <div className="quick-config-header">
          <span>Quick Settings</span>
          <button className="quick-config-close" onClick={onClose}>×</button>
        </div>
        <div className="quick-config-body">
          <div className="quick-config-row">
            <label>Hardware</label>
            <select value={config} onChange={e => onConfigChange(e.target.value)}>
              <optgroup label="Learning">
                <option value="educational">Educational (tiny)</option>
              </optgroup>
              <optgroup label="Intel">
                <option value="intel">Intel 12th Gen</option>
                <option value="intel14">Intel 14th Gen</option>
                <option value="xeon">Intel Xeon</option>
              </optgroup>
              <optgroup label="AMD">
                <option value="zen3">AMD Zen 3</option>
                <option value="amd">AMD Zen 4</option>
                <option value="epyc">AMD EPYC</option>
              </optgroup>
              <optgroup label="Apple">
                <option value="apple">Apple M1</option>
                <option value="m2">Apple M2</option>
                <option value="m3">Apple M3</option>
              </optgroup>
              <optgroup label="ARM">
                <option value="graviton">AWS Graviton 3</option>
                <option value="rpi4">Raspberry Pi 4</option>
              </optgroup>
            </select>
          </div>
          <div className="quick-config-row">
            <label>Optimization</label>
            <select value={optLevel} onChange={e => onOptLevelChange(e.target.value)}>
              <option value="-O0">-O0 (debug)</option>
              <option value="-O1">-O1</option>
              <option value="-O2">-O2 (recommended)</option>
              <option value="-O3">-O3 (aggressive)</option>
            </select>
          </div>
          <div className="quick-config-row">
            <label>Prefetch</label>
            <select value={prefetchPolicy} onChange={e => onPrefetchChange(e.target.value)}>
              <option value="none">None</option>
              <option value="next">Next Line</option>
              <option value="stream">Stream</option>
              <option value="stride">Stride</option>
              <option value="adaptive">Adaptive</option>
            </select>
          </div>
          {compilers.length > 1 && (
            <div className="quick-config-row">
              <label>Compiler</label>
              <select value={selectedCompiler} onChange={e => onCompilerChange(e.target.value)}>
                {compilers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
