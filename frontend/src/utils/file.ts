import type { Language, FileTab } from '../types'

let fileIdCounter = 0

export function generateFileId(): string {
  return `file_${++fileIdCounter}_${Date.now()}`
}

export function getFileExtension(lang: Language): string {
  switch (lang) {
    case 'cpp': return '.cpp'
    default: return '.c'
  }
}

export function createFileTab(name: string, code: string, language: Language): FileTab {
  return { id: generateFileId(), name, code, language }
}
