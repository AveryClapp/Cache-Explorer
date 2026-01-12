import { useState, useRef, useEffect } from 'react'
import type { SelectOption } from '../types'

interface StyledSelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
}

export function StyledSelect({
  value,
  options,
  onChange,
  placeholder = 'Select...',
}: StyledSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find(o => o.value === value)
  const groups = [...new Set(options.map(o => o.group).filter(Boolean))]
  const hasGroups = groups.length > 0

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      const idx = options.findIndex(o => o.value === value)
      if (idx >= 0) setHighlightedIndex(idx)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, value, options])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'Escape':
        setIsOpen(false)
        break
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev => Math.min(prev + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          onChange(options[highlightedIndex].value)
          setIsOpen(false)
        }
        break
    }
  }

  useEffect(() => {
    if (isOpen && listRef.current && highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll('.styled-select-option')
      items[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex, isOpen])

  const renderOptions = () => {
    if (hasGroups) {
      return groups.map(group => (
        <div key={group} className="styled-select-group">
          <div className="styled-select-group-label">{group}</div>
          {options
            .filter(o => o.group === group)
            .map(option => {
              const idx = options.indexOf(option)
              return (
                <div
                  key={option.value}
                  className={`styled-select-option ${option.value === value ? 'selected' : ''} ${idx === highlightedIndex ? 'highlighted' : ''}`}
                  onClick={() => { onChange(option.value); setIsOpen(false) }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                >
                  {option.value === value && <span className="check-mark">✓</span>}
                  <span className="option-content">
                    <span className="option-label">{option.label}</span>
                    {option.desc && <span className="option-desc">{option.desc}</span>}
                  </span>
                </div>
              )
            })}
        </div>
      ))
    }

    return options.map((option, idx) => (
      <div
        key={option.value}
        className={`styled-select-option ${option.value === value ? 'selected' : ''} ${idx === highlightedIndex ? 'highlighted' : ''}`}
        onClick={() => { onChange(option.value); setIsOpen(false) }}
        onMouseEnter={() => setHighlightedIndex(idx)}
      >
        {option.value === value && <span className="check-mark">✓</span>}
        <span className="option-content">
          <span className="option-label">{option.label}</span>
          {option.desc && <span className="option-desc">{option.desc}</span>}
        </span>
      </div>
    ))
  }

  return (
    <div
      ref={containerRef}
      className={`styled-select ${isOpen ? 'open' : ''}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="styled-select-trigger" onClick={() => setIsOpen(!isOpen)}>
        <span className="styled-select-value">{selectedOption?.label || placeholder}</span>
        <span className="styled-select-arrow">{isOpen ? '▲' : '▼'}</span>
      </div>
      {isOpen && (
        <div ref={listRef} className="styled-select-dropdown">
          {renderOptions()}
        </div>
      )}
    </div>
  )
}
