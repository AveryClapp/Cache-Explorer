// The backend copies sources into a per-run temp project
// (`<tmp>/cache-explorer-<uuid>/<name>`). A single editor buffer is written as
// `main.<ext>` (direct) or `input.<ext>` (sandbox), regardless of the tab name.
// These helpers map those run paths back to editor tabs and give stable keys
// that survive across runs.

const RUN_DIR_PATTERN = /[/\\]cache-explorer-[^/\\]+[/\\]/
const SINGLE_FILE_PATTERN = /^(main|input)\.[A-Za-z0-9]+$/

export function sourceBasename(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

// Mirrors sanitizeFilename in backend/server/services/tempProject.js.
export function sanitizedSourceName(name: string): string {
  const base = sourceBasename(name).replace(/\0/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
  return (base.replace(/^\.+/, '') || 'unnamed.c').slice(0, 255)
}

export function isRunSourcePath(path: string): boolean {
  return RUN_DIR_PATTERN.test(path) || !/[/\\]/.test(path)
}

// True when a result path refers to the given editor tab.
export function matchesEditorFile(path: string, editorName: string, fileCount: number): boolean {
  if (!path || !isRunSourcePath(path)) return false
  const base = sourceBasename(path)
  if (base === sanitizedSourceName(editorName)) return true
  return fileCount === 1 && SINGLE_FILE_PATTERN.test(base)
}

// A key for a source line that is stable across runs (no temp directory).
export function sourceLineKey(path: string, line: number): string {
  return `${sourceBasename(path)}:${line}`
}

// What to show the user for a result path.
export function displaySourcePath(path: string): string {
  return isRunSourcePath(path) ? sourceBasename(path) : path
}
