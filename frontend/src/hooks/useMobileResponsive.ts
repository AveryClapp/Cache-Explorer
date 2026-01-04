import { useState, useEffect } from 'react'

export type MobilePane = 'editor' | 'results'

export function useMobileResponsive() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
  )
  const [mobilePane, setMobilePane] = useState<MobilePane>('editor')

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return { isMobile, mobilePane, setMobilePane }
}
