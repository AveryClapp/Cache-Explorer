import { useEffect, useRef } from 'react'

/** Closes a <details> menu on outside pointerdown or Escape (returning focus to its summary). */
export function useDismissableDetails() {
  const ref = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const close = (event: Event) => {
      const menu = ref.current
      if (!menu?.open) return
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        menu.open = false
        menu.querySelector('summary')?.focus()
        return
      }
      if (!menu.contains(event.target as Node)) menu.open = false
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])

  return ref
}
