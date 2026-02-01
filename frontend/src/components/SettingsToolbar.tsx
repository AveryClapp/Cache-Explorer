import { useState, useEffect, useRef } from 'react'
import { StyledSelect } from './StyledSelect'
import type { DefineEntry, CustomCacheConfig } from '../types'
import {
  HARDWARE_OPTIONS,
  OPT_LEVEL_OPTIONS,
  PREFETCH_OPTIONS,
  LIMIT_OPTIONS,
  SAMPLE_OPTIONS,
  FAST_MODE_OPTIONS,
} from '../constants/options'

interface SettingsToolbarProps {
  config: string
  optLevel: string
  prefetchPolicy: string
  defines: DefineEntry[]
  customConfig: CustomCacheConfig
  eventLimit: number
  sampleRate: number
  fastMode: boolean
  onConfigChange: (c: string) => void
  onOptLevelChange: (o: string) => void
  onPrefetchChange: (p: string) => void
  onDefinesChange: (d: DefineEntry[]) => void
  onCustomConfigChange: (c: CustomCacheConfig) => void
  onEventLimitChange: (n: number) => void
  onSampleRateChange: (n: number) => void
  onFastModeChange: (f: boolean) => void
}

export function SettingsToolbar({
  config,
  optLevel,
  prefetchPolicy,
  defines,
  customConfig,
  eventLimit,
  sampleRate,
  fastMode,
  onConfigChange,
  onOptLevelChange,
  onPrefetchChange,
  onDefinesChange,
  onCustomConfigChange,
  onEventLimitChange,
  onSampleRateChange,
  onFastModeChange,
}: SettingsToolbarProps) {
  const [showMore, setShowMore] = useState(config === 'custom')
  const [customLimitMode, setCustomLimitMode] = useState(false)
  const [customLimitText, setCustomLimitText] = useState('')
  const customLimitRef = useRef<HTMLInputElement>(null)

  // Check if current eventLimit matches a preset
  const presetValues = ['10000', '50000', '100000', '500000', '1000000', '5000000', '0']
  const isCustomLimit = !presetValues.includes(String(eventLimit))

  // Format number for display in input
  const formatLimit = (n: number): string => {
    if (n === 0) return '0'
    if (n >= 1_000_000 && n % 1_000_000 === 0) return (n / 1_000_000) + 'M'
    if (n >= 1_000 && n % 1_000 === 0) return (n / 1_000) + 'K'
    return String(n)
  }

  // Parse shorthand like "10M", "500K", "2.5M", or plain numbers
  const parseLimit = (input: string): number | null => {
    const s = input.trim().toUpperCase()
    if (!s) return null
    const match = s.match(/^(\d+\.?\d*)\s*(M|K|B)?$/)
    if (!match) return null
    const num = parseFloat(match[1])
    if (isNaN(num) || num < 0) return null
    const suffix = match[2]
    if (suffix === 'M') return Math.round(num * 1_000_000)
    if (suffix === 'K') return Math.round(num * 1_000)
    if (suffix === 'B') return Math.round(num * 1_000_000_000)
    return Math.round(num)
  }

  // Focus the custom input when entering custom mode
  useEffect(() => {
    if (customLimitMode && customLimitRef.current) {
      customLimitRef.current.focus()
    }
  }, [customLimitMode])

  // Determine the select value to show
  const limitSelectValue = isCustomLimit ? 'custom' : String(eventLimit)

  useEffect(() => {
    if (config === 'custom') setShowMore(true)
  }, [config])

  return (
    <div className="settings-toolbar">
      <div className="settings-toolbar-main">
        <div className="toolbar-group">
          <label>Hardware</label>
          <StyledSelect
            value={config}
            options={HARDWARE_OPTIONS}
            onChange={onConfigChange}
          />
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <label>Opt</label>
          <StyledSelect
            value={optLevel}
            options={OPT_LEVEL_OPTIONS}
            onChange={onOptLevelChange}
          />
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <label>Prefetch</label>
          <StyledSelect
            value={prefetchPolicy}
            options={PREFETCH_OPTIONS}
            onChange={onPrefetchChange}
          />
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <label title="Fast mode disables 3C miss classification for ~3x speedup">Mode</label>
          <StyledSelect
            value={String(fastMode)}
            options={FAST_MODE_OPTIONS}
            onChange={(v) => onFastModeChange(v === 'true')}
          />
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <label>Sample</label>
          <StyledSelect
            value={String(sampleRate)}
            options={SAMPLE_OPTIONS}
            onChange={(v) => onSampleRateChange(parseInt(v))}
          />
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <label>Limit</label>
          {customLimitMode ? (
            <div className="limit-custom-input">
              <input
                ref={customLimitRef}
                type="text"
                placeholder="e.g. 10M, 500K"
                value={customLimitText}
                onChange={(e) => setCustomLimitText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const parsed = parseLimit(customLimitText)
                    if (parsed !== null && parsed > 0) {
                      onEventLimitChange(parsed)
                      setCustomLimitMode(false)
                      setCustomLimitText('')
                    }
                  } else if (e.key === 'Escape') {
                    setCustomLimitMode(false)
                    setCustomLimitText('')
                  }
                }}
                onBlur={() => {
                  const parsed = parseLimit(customLimitText)
                  if (parsed !== null && parsed > 0) {
                    onEventLimitChange(parsed)
                  }
                  setCustomLimitMode(false)
                  setCustomLimitText('')
                }}
                className="define-input custom-limit"
              />
            </div>
          ) : (
            <StyledSelect
              value={limitSelectValue}
              options={isCustomLimit
                ? LIMIT_OPTIONS.map(o => o.value === 'custom' ? { ...o, label: formatLimit(eventLimit) } : o)
                : LIMIT_OPTIONS
              }
              onChange={(v) => {
                if (v === 'custom') {
                  setCustomLimitMode(true)
                  setCustomLimitText('')
                } else {
                  onEventLimitChange(parseInt(v))
                }
              }}
            />
          )}
        </div>

        <button
          className={`toolbar-more ${showMore ? 'active' : ''}`}
          onClick={() => setShowMore(!showMore)}
          title="More options"
        >
          {showMore ? '▲ Less' : '▼ More'}
        </button>
      </div>

      {showMore && (
        <div className="settings-toolbar-advanced">
          <div className="toolbar-advanced-section">
            <span className="toolbar-advanced-label">Defines:</span>
            <div className="toolbar-defines">
              {defines.length === 0 ? (
                <div className="defines-presets">
                  <button className="define-preset" onClick={() => onDefinesChange([{ name: 'N', value: '1000' }])}>N=1000</button>
                  <button className="define-preset" onClick={() => onDefinesChange([{ name: 'SIZE', value: '256' }])}>SIZE=256</button>
                  <button className="define-preset" onClick={() => onDefinesChange([{ name: 'BLOCK', value: '64' }])}>BLOCK=64</button>
                  <button className="define-preset define-custom" onClick={() => onDefinesChange([{ name: '', value: '' }])}>+ Custom</button>
                </div>
              ) : (
                <>
                  {defines.map((def, i) => (
                    <div key={i} className="toolbar-define">
                      <span className="define-prefix">-D</span>
                      <input
                        type="text"
                        placeholder="NAME"
                        value={def.name}
                        onChange={(e) => {
                          const newDefs = [...defines]
                          newDefs[i].name = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')
                          onDefinesChange(newDefs)
                        }}
                        className="define-input name"
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
                        className="define-input value"
                      />
                      <button
                        className="define-remove"
                        onClick={() => onDefinesChange(defines.filter((_, j) => j !== i))}
                        title="Remove define"
                      >×</button>
                    </div>
                  ))}
                  <button
                    className="define-add"
                    onClick={() => onDefinesChange([...defines, { name: '', value: '' }])}
                  >+</button>
                </>
              )}
            </div>
          </div>

          {config === 'custom' && (
            <div className="toolbar-advanced-section custom-cache-section">
              <span className="toolbar-advanced-label">Cache Config:</span>
              <div className="toolbar-cache-config">
                <div className="cache-config-group">
                  <span className="cache-config-title">Line Size</span>
                  <select value={customConfig.lineSize} onChange={e => onCustomConfigChange({ ...customConfig, lineSize: parseInt(e.target.value) })}>
                    <option value={32}>32 B</option>
                    <option value={64}>64 B</option>
                    <option value={128}>128 B</option>
                  </select>
                </div>
                <div className="cache-config-group">
                  <span className="cache-config-title">L1 Data</span>
                  <select value={customConfig.l1Size} onChange={e => onCustomConfigChange({ ...customConfig, l1Size: parseInt(e.target.value) })}>
                    <option value={8192}>8 KB</option>
                    <option value={16384}>16 KB</option>
                    <option value={32768}>32 KB</option>
                    <option value={49152}>48 KB</option>
                    <option value={65536}>64 KB</option>
                  </select>
                  <select value={customConfig.l1Assoc} onChange={e => onCustomConfigChange({ ...customConfig, l1Assoc: parseInt(e.target.value) })}>
                    <option value={4}>4-way</option>
                    <option value={8}>8-way</option>
                    <option value={12}>12-way</option>
                    <option value={16}>16-way</option>
                  </select>
                </div>
                <div className="cache-config-group">
                  <span className="cache-config-title">L2</span>
                  <select value={customConfig.l2Size} onChange={e => onCustomConfigChange({ ...customConfig, l2Size: parseInt(e.target.value) })}>
                    <option value={131072}>128 KB</option>
                    <option value={262144}>256 KB</option>
                    <option value={524288}>512 KB</option>
                    <option value={1048576}>1 MB</option>
                    <option value={2097152}>2 MB</option>
                  </select>
                  <select value={customConfig.l2Assoc} onChange={e => onCustomConfigChange({ ...customConfig, l2Assoc: parseInt(e.target.value) })}>
                    <option value={4}>4-way</option>
                    <option value={8}>8-way</option>
                    <option value={16}>16-way</option>
                  </select>
                </div>
                <div className="cache-config-group">
                  <span className="cache-config-title">L3</span>
                  <select value={customConfig.l3Size} onChange={e => onCustomConfigChange({ ...customConfig, l3Size: parseInt(e.target.value) })}>
                    <option value={0}>None</option>
                    <option value={2097152}>2 MB</option>
                    <option value={4194304}>4 MB</option>
                    <option value={8388608}>8 MB</option>
                    <option value={16777216}>16 MB</option>
                    <option value={33554432}>32 MB</option>
                  </select>
                  <select value={customConfig.l3Assoc} onChange={e => onCustomConfigChange({ ...customConfig, l3Assoc: parseInt(e.target.value) })} disabled={customConfig.l3Size === 0}>
                    <option value={8}>8-way</option>
                    <option value={12}>12-way</option>
                    <option value={16}>16-way</option>
                    <option value={20}>20-way</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
