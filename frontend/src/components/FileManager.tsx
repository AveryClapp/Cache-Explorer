import { useState, useCallback } from 'react'
import './FileManager.css'

export interface ProjectFile {
  id: string
  name: string
  code: string
  language: 'c' | 'cpp' | 'rust'
  isMain?: boolean
}

interface FileManagerProps {
  files: ProjectFile[]
  activeFileId: string
  onFileSelect: (fileId: string) => void
  onFileCreate: (name: string, language: 'c' | 'cpp' | 'rust') => void
  onFileDelete: (fileId: string) => void
  onFileRename: (fileId: string, newName: string) => void
  onSetMainFile: (fileId: string) => void
}

const FILE_EXTENSIONS: Record<string, 'c' | 'cpp' | 'rust'> = {
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.rs': 'rust',
}

const DEFAULT_EXTENSIONS: Record<'c' | 'cpp' | 'rust', string> = {
  c: '.c',
  cpp: '.cpp',
  rust: '.rs',
}

const LANGUAGE_COLORS: Record<'c' | 'cpp' | 'rust', string> = {
  c: '#555eb7',
  cpp: '#f34b7d',
  rust: '#dea584',
}

export function FileManager({
  files,
  activeFileId,
  onFileSelect,
  onFileCreate,
  onFileDelete,
  onFileRename,
  onSetMainFile,
}: FileManagerProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [editingFileId, setEditingFileId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [contextMenu, setContextMenu] = useState<{ fileId: string; x: number; y: number } | null>(null)

  const handleCreateFile = useCallback(() => {
    if (!newFileName.trim()) return

    let name = newFileName.trim()
    let language: 'c' | 'cpp' | 'rust' = 'c'

    // Detect language from extension
    const ext = Object.keys(FILE_EXTENSIONS).find(e => name.endsWith(e))
    if (ext) {
      language = FILE_EXTENSIONS[ext]
    } else {
      // Add default extension based on existing files
      const firstFile = files[0]
      language = firstFile?.language || 'c'
      name += DEFAULT_EXTENSIONS[language]
    }

    onFileCreate(name, language)
    setNewFileName('')
    setIsCreating(false)
  }, [newFileName, files, onFileCreate])

  const handleRename = useCallback(() => {
    if (editingFileId && editingName.trim()) {
      onFileRename(editingFileId, editingName.trim())
    }
    setEditingFileId(null)
    setEditingName('')
  }, [editingFileId, editingName, onFileRename])

  const handleContextMenu = (e: React.MouseEvent, fileId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ fileId, x: e.clientX, y: e.clientY })
  }

  const closeContextMenu = () => setContextMenu(null)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (isCreating) {
        handleCreateFile()
      } else if (editingFileId) {
        handleRename()
      }
    } else if (e.key === 'Escape') {
      setIsCreating(false)
      setEditingFileId(null)
      setNewFileName('')
      setEditingName('')
    }
  }

  const handleTabClose = (e: React.MouseEvent, fileId: string) => {
    e.stopPropagation()
    if (files.length > 1) {
      onFileDelete(fileId)
    }
  }

  const handleTabDoubleClick = (e: React.MouseEvent, file: ProjectFile) => {
    e.stopPropagation()
    setEditingFileId(file.id)
    setEditingName(file.name)
  }

  return (
    <div className="editor-tabs" onClick={closeContextMenu}>
      <div className="tabs-container">
        {files.map((file) => (
          <div
            key={file.id}
            className={`editor-tab ${file.id === activeFileId ? 'active' : ''} ${file.isMain ? 'main-file' : ''}`}
            onClick={() => onFileSelect(file.id)}
            onContextMenu={(e) => handleContextMenu(e, file.id)}
            onDoubleClick={(e) => handleTabDoubleClick(e, file)}
          >
            {editingFileId === file.id ? (
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                className="tab-rename-input"
              />
            ) : (
              <>
                <span
                  className="tab-icon"
                  style={{ backgroundColor: LANGUAGE_COLORS[file.language] }}
                >
                  {file.language === 'c' ? 'C' : file.language === 'cpp' ? '++' : 'Rs'}
                </span>
                <span className="tab-name">{file.name}</span>
                {file.isMain && <span className="tab-main-indicator" title="Entry point">*</span>}
              </>
            )}
            {files.length > 1 && (
              <button
                className="tab-close"
                onClick={(e) => handleTabClose(e, file.id)}
                title="Close file"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {isCreating ? (
          <div className="editor-tab new-tab">
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onBlur={() => {
                if (!newFileName.trim()) setIsCreating(false)
                else handleCreateFile()
              }}
              onKeyDown={handleKeyDown}
              placeholder="filename.c"
              autoFocus
              className="tab-new-input"
            />
          </div>
        ) : (
          <button
            className="tab-add-btn"
            onClick={() => setIsCreating(true)}
            title="Add new file (Ctrl+N)"
          >
            +
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button onClick={() => {
            const file = files.find(f => f.id === contextMenu.fileId)
            if (file) {
              setEditingFileId(file.id)
              setEditingName(file.name)
            }
            closeContextMenu()
          }}>
            Rename
          </button>
          <button onClick={() => {
            onSetMainFile(contextMenu.fileId)
            closeContextMenu()
          }}>
            Set as Entry Point
          </button>
          <hr />
          <button
            className="delete-action"
            onClick={() => {
              if (files.length > 1) {
                onFileDelete(contextMenu.fileId)
              }
              closeContextMenu()
            }}
            disabled={files.length <= 1}
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}

export default FileManager
