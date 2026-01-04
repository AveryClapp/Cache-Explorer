import LZString from 'lz-string'
import type { ShareableState } from '../types'

export function encodeState(state: ShareableState): string {
  try {
    return LZString.compressToEncodedURIComponent(JSON.stringify(state))
  } catch {
    return ''
  }
}

export function decodeState(encoded: string): ShareableState | null {
  try {
    const decoded = LZString.decompressFromEncodedURIComponent(encoded)
    if (!decoded) return null
    return JSON.parse(decoded)
  } catch {
    return null
  }
}
