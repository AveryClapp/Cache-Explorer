import LZString from 'lz-string'
import type { ShareableState } from '../types'

export function encodeState(state: ShareableState): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(state))
}

export function decodeState(encoded: string): ShareableState | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded)
    if (!json) return null
    return JSON.parse(json)
  } catch {
    return null
  }
}
