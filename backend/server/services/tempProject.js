import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

export const TEMP_PROJECT_PREFIX = 'cache-explorer-';

export function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'unnamed.c';
  }

  const basename = filename.split(/[/\\]/).pop() || 'unnamed.c';
  const noNulls = basename.replace(/\0/g, '');
  const sanitized = noNulls.replace(/[^a-zA-Z0-9._-]/g, '_');
  return (sanitized.replace(/^\.+/, '') || 'unnamed.c').slice(0, 255);
}

function extensionForLanguage(language) {
  const extensions = { c: '.c', cpp: '.cpp', rust: '.rs', zig: '.zig' };
  return extensions[language] || '.c';
}

export async function createTempProject(files, language = 'c', options = {}) {
  const tempRoot = options.tempRoot || tmpdir();
  const tempDir = join(tempRoot, `${TEMP_PROJECT_PREFIX}${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });

  if (Array.isArray(files)) {
    const nameMap = new Map();
    for (const file of files) {
      const safeName = sanitizeFilename(file.name);
      nameMap.set(file.name, safeName);
      await writeFile(join(tempDir, safeName), file.code);
    }

    const mainFile = files.find(f => f.code.includes('int main') || f.code.includes('fn main')) || files[0];
    return { tempDir, mainFile: join(tempDir, nameMap.get(mainFile.name)) };
  }

  const mainFile = join(tempDir, `main${extensionForLanguage(language)}`);
  await writeFile(mainFile, files);
  return { tempDir, mainFile };
}

export async function cleanupTempProject(tempDir) {
  if (!tempDir) return;
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup: callers should not fail because temp removal raced.
  }
}

export async function cleanupOrphanedTempDirs(options = {}) {
  const tempRoot = options.tempRoot || tmpdir();
  const maxAgeMs = options.maxAgeMs ?? 300000;
  const prefix = options.prefix || TEMP_PROJECT_PREFIX;
  const now = Date.now();
  let removed = 0;

  try {
    const entries = await readdir(tempRoot);
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;

      const fullPath = join(tempRoot, entry);
      try {
        const { mtime } = await stat(fullPath);
        if (now - mtime.getTime() > maxAgeMs) {
          await cleanupTempProject(fullPath);
          removed += 1;
        }
      } catch {
        // Ignore files that disappear or cannot be inspected.
      }
    }
  } catch {
    // Ignore root scan failures; this runs on a background interval.
  }

  return removed;
}
