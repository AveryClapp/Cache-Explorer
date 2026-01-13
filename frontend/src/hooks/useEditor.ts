import { useState, useCallback, useMemo } from 'react'
import type { FileTab, Language } from '../types'
import type { ProjectFile } from '../components'

// File ID generation
let fileIdCounter = 0
function generateFileId(): string {
  return `file_${++fileIdCounter}_${Date.now()}`
}

/** Get file extension for a language */
export function getFileExtension(lang: Language): string {
  switch (lang) {
    case 'cpp': return '.cpp'
    case 'rust': return '.rs'
    default: return '.c'
  }
}

/** Create a new file tab with generated ID */
export function createFileTab(name: string, code: string, language: Language): FileTab {
  return { id: generateFileId(), name, code, language }
}

export interface UseEditorReturn {
  // State
  files: FileTab[]
  activeFileId: string
  mainFileId: string
  activeFile: FileTab
  code: string
  language: Language

  // For FileManager component
  projectFiles: ProjectFile[]

  // Actions
  setFiles: (files: FileTab[]) => void
  setActiveFileId: (id: string) => void
  setMainFileId: (id: string) => void
  updateActiveCode: (code: string) => void
  updateActiveLanguage: (lang: Language) => void
  closeFile: (id: string) => void
  renameFile: (id: string, name: string) => void
  createFile: (name: string, language: Language) => void

  // Example loading
  loadExample: (code: string, language: Language, name?: string) => void
  loadMultiFileExample: (files: Array<{ name: string; code: string; language: Language; isMain?: boolean }>) => void
}

const DEFAULT_CODE = `// Sequential array access - good cache behavior
#include <stdio.h>
#define N 1000

int main() {
    int arr[N];
    int sum = 0;

    for (int i = 0; i < N; i++) arr[i] = i;
    for (int i = 0; i < N; i++) sum += arr[i];

    printf("Sum: %d\\n", sum);
    return 0;
}
`

export function useEditor(initialCode?: string): UseEditorReturn {
  // Multi-file state
  const [files, setFiles] = useState<FileTab[]>(() => [
    createFileTab('main.c', initialCode || DEFAULT_CODE, 'c')
  ])
  const [activeFileId, setActiveFileId] = useState<string>(() => files[0]?.id || '')
  const [mainFileId, setMainFileId] = useState<string>(() => files[0]?.id || '')

  // Derived state
  const activeFile = files.find(f => f.id === activeFileId) || files[0]
  const code = activeFile?.code || ''
  const language = activeFile?.language || 'c'

  // Update code in active file
  const updateActiveCode = useCallback((newCode: string) => {
    setFiles(prev => prev.map(f =>
      f.id === activeFileId ? { ...f, code: newCode } : f
    ))
  }, [activeFileId])

  // Update language of active file (and extension)
  const updateActiveLanguage = useCallback((newLang: Language) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== activeFileId) return f
      const ext = getFileExtension(newLang)
      const baseName = f.name.replace(/\.(c|cpp|rs)$/, '')
      return { ...f, language: newLang, name: baseName + ext }
    }))
  }, [activeFileId])

  // Close a file tab
  const closeFile = useCallback((id: string) => {
    if (files.length <= 1) return // Don't close last file
    const idx = files.findIndex(f => f.id === id)
    setFiles(prev => prev.filter(f => f.id !== id))
    // If closing active file, switch to adjacent
    if (id === activeFileId) {
      const newIdx = Math.min(idx, files.length - 2)
      const newActive = files.filter(f => f.id !== id)[newIdx]
      if (newActive) setActiveFileId(newActive.id)
    }
  }, [files, activeFileId])

  // Rename a file
  const renameFile = useCallback((id: string, name: string) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, name } : f
    ))
  }, [])

  // Create a new file
  const createFile = useCallback((name: string, language: Language) => {
    const newFile = createFileTab(name, '', language)
    setFiles(prev => [...prev, newFile])
    setActiveFileId(newFile.id)
  }, [])

  // Convert files to ProjectFile format for FileManager
  const projectFiles: ProjectFile[] = useMemo(() =>
    files.map(f => ({
      id: f.id,
      name: f.name,
      code: f.code,
      language: f.language,
      isMain: f.id === mainFileId
    }))
  , [files, mainFileId])

  // Load a single-file example
  const loadExample = useCallback((exampleCode: string, lang: Language, name?: string) => {
    const fileName = name || `main${getFileExtension(lang)}`
    const newFile = createFileTab(fileName, exampleCode, lang)
    setFiles([newFile])
    setActiveFileId(newFile.id)
    setMainFileId(newFile.id)
  }, [])

  // Load a multi-file example
  const loadMultiFileExample = useCallback((exampleFiles: Array<{ name: string; code: string; language: Language; isMain?: boolean }>) => {
    const newFiles = exampleFiles.map(f => createFileTab(f.name, f.code, f.language))
    setFiles(newFiles)

    // Find main file or use first
    const mainIndex = exampleFiles.findIndex(f => f.isMain)
    const mainFile = newFiles[mainIndex >= 0 ? mainIndex : 0]
    setActiveFileId(mainFile.id)
    setMainFileId(mainFile.id)
  }, [])

  return {
    files,
    activeFileId,
    mainFileId,
    activeFile,
    code,
    language,
    projectFiles,
    setFiles,
    setActiveFileId,
    setMainFileId,
    updateActiveCode,
    updateActiveLanguage,
    closeFile,
    renameFile,
    createFile,
    loadExample,
    loadMultiFileExample,
  }
}
