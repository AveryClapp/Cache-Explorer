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
    }
  }

  return (
    <div className="file-manager" onClick={closeContextMenu}>
      <div className="file-manager-header">
        <span className="header-title">Project Files</span>
        <button
          className="add-file-btn"
          onClick={() => setIsCreating(true)}
          title="Add new file"
        >
          +
        </button>
      </div>

      <div className="file-list">
        {files.map((file) => (
          <div
            key={file.id}
            className={`file-item ${file.id === activeFileId ? 'active' : ''} ${file.isMain ? 'main-file' : ''}`}
            onClick={() => onFileSelect(file.id)}
            onContextMenu={(e) => handleContextMenu(e, file.id)}
          >
            {editingFileId === file.id ? (
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={handleKeyDown}
                autoFocus
                className="rename-input"
              />
            ) : (
              <>
                <span className="file-icon">
                  {file.language === 'c' ? 'C' : file.language === 'cpp' ? 'C++' : 'Rs'}
                </span>
                <span className="file-name">{file.name}</span>
                {file.isMain && <span className="main-badge" title="Main file">★</span>}
              </>
            )}
          </div>
        ))}

        {isCreating && (
          <div className="file-item creating">
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
              className="new-file-input"
            />
          </div>
        )}
      </div>

      {files.length === 0 && !isCreating && (
        <div className="empty-state">
          Click + to add a file
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="context-menu"
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
            Set as Main
          </button>
          <hr />
          <button
            className="delete-btn"
            onClick={() => {
              if (files.length > 1) {
                onFileDelete(contextMenu.fileId)
              }
              closeContextMenu()
            }}
            disabled={files.length <= 1}
          >
            Delete
          </button>
        </div>
      )}

      <div className="file-manager-footer">
        <span className="file-count">{files.length} file{files.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}

export default FileManager
