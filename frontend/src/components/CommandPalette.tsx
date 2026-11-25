import { fuzzyMatch } from '../utils/formatting'

export interface CommandItem {
  id: string
  icon: string
  label: string
  shortcut?: string
  action: () => void
  category?: string
}

interface CommandPaletteProps {
  isOpen: boolean
  query: string
  selectedIndex: number
  onQueryChange: (query: string) => void
  onSelect: (cmd: CommandItem) => void
  onClose: () => void
  onNavigate: (delta: number) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  commands: CommandItem[]
}

// Prefix-to-category mapping for command palette
const PREFIX_CATEGORIES: Record<string, string> = {
  '>': 'examples',
  ':': 'settings',
  '@': 'actions',
  '*': 'config',
}

const CATEGORY_LABELS: Record<string, string> = {
  'examples': 'Examples',
  'settings': 'Settings',
  'actions': 'Actions',
  'config': 'Config',
}

const CATEGORY_ORDER = ['actions', 'examples', 'settings', 'config']

export function CommandPalette({
  isOpen,
  query,
  selectedIndex,
  onQueryChange,
  onSelect,
  onClose,
  onNavigate,
  inputRef,
  commands
}: CommandPaletteProps) {
  if (!isOpen) return null

  // Parse prefix from query
  const firstChar = query.charAt(0)
  const activePrefix = PREFIX_CATEGORIES[firstChar] ? firstChar : null
  const activeCategory = activePrefix ? PREFIX_CATEGORIES[activePrefix] : null
  const searchQuery = activePrefix ? query.slice(1).trim() : query

  // Filter commands
  let filtered: CommandItem[]
  if (activeCategory) {
    filtered = commands.filter(cmd => cmd.category === activeCategory)
    if (searchQuery) {
      filtered = filtered.filter(cmd => fuzzyMatch(searchQuery, cmd.label))
    }
  } else if (searchQuery) {
    filtered = commands.filter(cmd => fuzzyMatch(searchQuery, cmd.label) || fuzzyMatch(searchQuery, cmd.category || ''))
  } else {
    filtered = commands
  }

  // Group by category when showing all (no prefix, no search)
  const showGrouped = !activePrefix && !searchQuery
  const groupedCommands: { category: string; items: CommandItem[] }[] = []
  if (showGrouped) {
    for (const cat of CATEGORY_ORDER) {
      const items = filtered.filter(cmd => cmd.category === cat)
      if (items.length > 0) {
        groupedCommands.push({ category: cat, items })
      }
    }
  }

  // Flatten for keyboard navigation
  const flatFiltered = showGrouped
    ? groupedCommands.flatMap(g => g.items)
    : filtered

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      onNavigate(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onNavigate(-1)
    } else if (e.key === 'Enter' && flatFiltered[selectedIndex]) {
      e.preventDefault()
      onSelect(flatFiltered[selectedIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Backspace' && query === activePrefix) {
      e.preventDefault()
      onQueryChange('')
    }
  }

  const clearPrefix = () => {
    onQueryChange('')
  }

  const optionId = (index: number) => `command-option-${index}`

  const renderItem = (cmd: (typeof flatFiltered)[number], index: number) => (
    <div
      key={cmd.id}
      id={optionId(index)}
      role="option"
      aria-selected={index === selectedIndex}
      className={`command-item ${index === selectedIndex ? 'selected' : ''}`}
      onClick={() => onSelect(cmd)}
      onMouseEnter={() => onNavigate(index - selectedIndex)}
    >
      <span className="command-item-label">{cmd.label}</span>
      {cmd.shortcut && <span className="command-item-shortcut">{cmd.shortcut}</span>}
    </div>
  )

  // Render grouped or flat list
  const renderCommands = () => {
    if (showGrouped) {
      let globalIndex = 0
      return groupedCommands.map(group => (
        <div key={group.category} className="command-group" role="group" aria-labelledby={`command-group-${group.category}`}>
          <div className="command-group-header" id={`command-group-${group.category}`}>{CATEGORY_LABELS[group.category]}</div>
          {group.items.map(cmd => {
            const idx = globalIndex++
            return renderItem(cmd, idx)
          })}
        </div>
      ))
    }
    return flatFiltered.map((cmd, i) => renderItem(cmd, i))
  }

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={e => e.stopPropagation()}>
        <div className="command-input-wrapper">
          {activePrefix ? (
            <button type="button" className="command-filter-badge" onClick={clearPrefix} aria-label={`Clear ${CATEGORY_LABELS[activeCategory!].toLowerCase()} filter`}>
              {CATEGORY_LABELS[activeCategory!]} {activePrefix}
              <span className="badge-clear" aria-hidden="true">×</span>
            </button>
          ) : (
            <span className="command-icon" aria-hidden="true">/</span>
          )}
          <input
            ref={inputRef}
            type="text"
            className="command-input"
            role="combobox"
            aria-label="Search commands"
            aria-expanded="true"
            aria-controls="command-list"
            aria-autocomplete="list"
            aria-activedescendant={flatFiltered.length > 0 ? optionId(selectedIndex) : undefined}
            placeholder={activePrefix ? `Search ${CATEGORY_LABELS[activeCategory!].toLowerCase()}...` : 'Search commands and examples'}
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>
        <div className="command-list" id="command-list" role="listbox" aria-label="Commands">
          {renderCommands()}
          {flatFiltered.length === 0 && (
            <div className="command-empty">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  )
}
