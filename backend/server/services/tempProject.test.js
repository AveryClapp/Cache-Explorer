import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join, sep } from 'path';

import {
  cleanupOrphanedTempDirs,
  cleanupTempProject,
  createTempProject,
  sanitizeFilename,
} from './tempProject.js';

test('sanitizeFilename strips paths, hidden prefixes, nulls, and shell punctuation', () => {
  assert.equal(sanitizeFilename('../src/main.c'), 'main.c');
  assert.equal(sanitizeFilename('..'), 'unnamed.c');
  assert.equal(sanitizeFilename(`bad name;rm${String.fromCharCode(0)}.c`), 'bad_name_rm.c');
});

test('createTempProject writes sanitized multi-file projects under the temp root', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'cache-explorer-test-'));
  try {
    const project = await createTempProject([
      { name: '../main.c', code: 'int main(){return 0;}' },
      { name: 'include/helper.h', code: '#define VALUE 42\n' },
    ], 'c', { tempRoot });

    assert.ok(project.tempDir.startsWith(`${tempRoot}${sep}`));
    assert.equal(basename(project.mainFile), 'main.c');
    assert.equal(await readFile(join(project.tempDir, 'helper.h'), 'utf8'), '#define VALUE 42\n');

    await cleanupTempProject(project.tempDir);
    await assert.rejects(access(project.tempDir));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('cleanupOrphanedTempDirs removes only old cache explorer directories', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'cache-explorer-test-'));
  try {
    const oldProject = await createTempProject('int main(){return 0;}', 'c', { tempRoot });
    const freshProject = await createTempProject('int main(){return 0;}', 'c', { tempRoot });
    const unrelatedDir = join(tempRoot, 'not-cache-explorer');
    await mkdir(unrelatedDir);
    const oldTimestamp = new Date(0);
    await utimes(oldProject.tempDir, oldTimestamp, oldTimestamp);
    await utimes(freshProject.tempDir, oldTimestamp, oldTimestamp);

    const removed = await cleanupOrphanedTempDirs({ tempRoot, maxAgeMs: 1 });
    assert.equal(removed, 2);
    await assert.rejects(access(oldProject.tempDir));
    await assert.rejects(access(freshProject.tempDir));
    await access(unrelatedDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
