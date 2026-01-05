import { useState, useCallback } from 'react'
import type { FileTab, Language } from '../types'
import { createFileTab, getFileExtension } from '../utils/file'
import { EXAMPLE_CODE } from '../constants/examples'

export function useAnalysisState() {
  const [files, setFiles] = useState<FileTab[]>(() => [
    createFileTab('main.c', EXAMPLE_CODE, 'c')
  ])
  const [activeFileId, setActiveFileId] = useState<string>(() => {
    const initialFile = createFileTab('main.c', EXAMPLE_CODE, 'c')
    return initialFile.id
  })
  const [mainFileId, setMainFileId] = useState<string>(() => {
    const initialFile = createFileTab('main.c', EXAMPLE_CODE, 'c')
    return initialFile.id
  })

  const activeFile = files.find(f => f.id === activeFileId) || files[0]
  const code = activeFile?.code || ''
  const language = activeFile?.language || 'c'

  const updateActiveCode = useCallback((newCode: string) => {
    setFiles(prev => prev.map(f =>
      f.id === activeFileId ? { ...f, code: newCode } : f
    ))
  }, [activeFileId])

  const updateActiveLanguage = useCallback((newLang: Language) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== activeFileId) return f
      const ext = getFileExtension(newLang)
      const baseName = f.name.replace(/\.(c|cpp|rs)$/, '')
      return { ...f, language: newLang, name: baseName + ext }
    }))
  }, [activeFileId])

  const closeFile = useCallback((id: string) => {
    if (files.length <= 1) return
    const idx = files.findIndex(f => f.id === id)
    setFiles(prev => prev.filter(f => f.id !== id))
    if (id === activeFileId) {
      const newIdx = Math.min(idx, files.length - 2)
      const newActive = files.filter(f => f.id !== id)[newIdx]
      if (newActive) setActiveFileId(newActive.id)
    }
  }, [files, activeFileId])

  const renameFile = useCallback((id: string, name: string) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, name } : f
    ))
  }, [])

  const createFile = useCallback((name: string, language: Language) => {
    const newFile = createFileTab(name, '', language)
    setFiles(prev => [...prev, newFile])
    setActiveFileId(newFile.id)
  }, [])

  return {
    files,
    activeFileId,
    mainFileId,
    activeFile,
    code,
    language,
    setActiveFileId,
    setMainFileId,
    updateActiveCode,
    updateActiveLanguage,
    closeFile,
    renameFile,
    createFile
  }
}
