import { useEffect } from 'react'

export interface KeyboardShortcutHandlers {
  onCommandPalette: () => void
  onRun: () => void
  onEscape: () => void
  canRun: boolean
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K to open command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        handlers.onCommandPalette()
      }
      // Ctrl/Cmd + Enter to run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (handlers.canRun) handlers.onRun()
      }
      // Escape to close modals
      if (e.key === 'Escape') {
        handlers.onEscape()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlers])
}
