interface DefineEntry {
  name: string
  value: string
}

interface CustomCacheConfig {
  l1Size: number
  l1Assoc: number
  lineSize: number
  l2Size: number
  l2Assoc: number
  l3Size: number
  l3Assoc: number
}

interface AdvancedOptionsModalProps {
  isOpen: boolean
  defines: DefineEntry[]
  customConfig: CustomCacheConfig
  currentConfig: string
  onDefinesChange: (defines: DefineEntry[]) => void
  onCustomConfigChange: (config: CustomCacheConfig) => void
  onClose: () => void
}

export function AdvancedOptionsModal({
  isOpen,
  defines,
  customConfig,
  currentConfig,
  onDefinesChange,
  onCustomConfigChange,
  onClose
}: AdvancedOptionsModalProps) {
  if (!isOpen) return null

  return (
    <div className="options-modal-overlay" onClick={onClose}>
      <div className="options-modal" onClick={e => e.stopPropagation()}>
        <div className="options-modal-header">
          <span>Advanced Options</span>
          <button className="quick-config-close" onClick={onClose}>×</button>
        </div>
        <div className="options-modal-body">
          <div className="option-section">
            <div className="option-label">Preprocessor Defines</div>
            <div className="defines-list">
              {defines.map((def, i) => (
                <div key={i} className="define-row">
                  <span className="define-d">-D</span>
                  <input
                    type="text"
                    placeholder="NAME"
                    value={def.name}
                    onChange={(e) => {
                      const newDefs = [...defines]
                      newDefs[i].name = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')
                      onDefinesChange(newDefs)
                    }}
                    className="define-name"
                  />
                  <span className="define-eq">=</span>
                  <input
                    type="text"
                    placeholder="value"
                    value={def.value}
                    onChange={(e) => {
                      const newDefs = [...defines]
                      newDefs[i].value = e.target.value
                      onDefinesChange(newDefs)
                    }}
                    className="define-value"
                  />
                  <button
                    className="btn-remove"
                    onClick={() => onDefinesChange(defines.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="btn-add"
                onClick={() => onDefinesChange([...defines, { name: '', value: '' }])}
              >
                + Add Define
              </button>
            </div>
          </div>

          {currentConfig === 'custom' && (
            <div className="option-section">
              <div className="option-label">Custom Cache Config</div>
              <div className="config-grid">
                <label>Line Size</label>
                <input
                  type="number"
                  value={customConfig.lineSize}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, lineSize: parseInt(e.target.value) || 64 })}
                />
                <label>L1 Size</label>
                <input
                  type="number"
                  value={customConfig.l1Size}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l1Size: parseInt(e.target.value) || 32768 })}
                />
                <label>L1 Assoc</label>
                <input
                  type="number"
                  value={customConfig.l1Assoc}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l1Assoc: parseInt(e.target.value) || 8 })}
                />
                <label>L2 Size</label>
                <input
                  type="number"
                  value={customConfig.l2Size}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l2Size: parseInt(e.target.value) || 262144 })}
                />
                <label>L2 Assoc</label>
                <input
                  type="number"
                  value={customConfig.l2Assoc}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l2Assoc: parseInt(e.target.value) || 8 })}
                />
                <label>L3 Size</label>
                <input
                  type="number"
                  value={customConfig.l3Size}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l3Size: parseInt(e.target.value) || 8388608 })}
                />
                <label>L3 Assoc</label>
                <input
                  type="number"
                  value={customConfig.l3Assoc}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l3Assoc: parseInt(e.target.value) || 16 })}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
