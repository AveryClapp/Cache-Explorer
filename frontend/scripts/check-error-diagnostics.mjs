#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const source = await readFile(new URL('../src/utils/errorDiagnostics.ts', import.meta.url), 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: true,
  },
}).outputText

const tempFile = join(tmpdir(), `cache-explorer-error-diagnostics-${process.pid}.mjs`)
await writeFile(tempFile, transpiled)

try {
  const { formatErrorDiagnostics } = await import(pathToFileURL(tempFile).href)
  const diagnostics = formatErrorDiagnostics({
    type: 'compile_error',
    summary: '1 error',
    message: 'use of undeclared identifier BROKEN_CALL',
    suggestion: 'Declare the symbol or replace it with a value.',
    errors: [
      {
        line: 3,
        column: 10,
        severity: 'error',
        message: 'use of undeclared identifier BROKEN_CALL',
        sourceLine: '  return BROKEN_CALL;',
        caret: '         ^',
        suggestion: 'Replace BROKEN_CALL with a declared variable.',
        notes: ['expanded from macro KERNEL_ENTRY'],
      },
    ],
  })

  assert.match(diagnostics, /^type: compile_error/m)
  assert.match(diagnostics, /^summary: 1 error/m)
  assert.match(diagnostics, /^line 3:10 error: use of undeclared identifier BROKEN_CALL/m)
  assert.match(diagnostics, /^hint: Replace BROKEN_CALL with a declared variable\./m)
  assert.match(diagnostics, /^note: expanded from macro KERNEL_ENTRY/m)

  const rateLimitDiagnostics = formatErrorDiagnostics({
    type: 'rate_limit',
    message: 'Too many requests',
    retryAfter: 15,
  })
  assert.match(rateLimitDiagnostics, /^retryAfter: 15s/m)

  console.log('Error diagnostics check passed')
} finally {
  await rm(tempFile, { force: true })
}
