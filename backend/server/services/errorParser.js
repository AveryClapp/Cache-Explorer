/**
 * Error Parser Service
 * Parses compiler errors, linker errors, and runtime errors into structured format
 */

// Common error patterns and their helpful suggestions
export const errorSuggestions = {
  'undeclared identifier': 'Check spelling or add the necessary #include',
  "expected ';'": 'Missing semicolon at end of statement',
  "expected '}'": 'Missing closing brace - check matching brackets',
  "expected ')'": 'Missing closing parenthesis',
  'expected expression': 'Syntax error - check for missing operands or typos',
  'use of undeclared': 'Variable or function not declared - check spelling or add declaration',
  'call to undeclared': 'Function not declared - add #include or forward declaration',
  'incompatible pointer': 'Type mismatch - check pointer types match',
  'implicit declaration': 'Function used before declaration - add #include or forward declaration',
  'implicit function': 'Function used before declaration - add #include or forward declaration',
  'too few arguments': 'Function call missing required arguments',
  'too many arguments': 'Function call has extra arguments',
  'conflicting types': 'Function declared differently in multiple places',
  'redefinition of': 'Same name defined twice - rename or use extern',
  'array subscript': 'Array index issue - check bounds and type',
  'cannot increment': 'Invalid operation on this type',
  'lvalue required': 'Cannot assign to this expression (not a variable)',
  'control reaches end': 'Function missing return statement',
  'uninitialized': 'Variable used before being assigned a value',
  'no member named': 'Struct/class has no field with that name - check spelling',
  'incomplete type': 'Type not fully defined - add #include or forward declaration',
  'invalid operands': 'Cannot use these types with this operator',
  'no matching function': 'No function matches these argument types',
  'cannot convert': 'Type conversion not allowed - use explicit cast if intended',
  'no viable conversion': 'No way to convert between these types',
  'non-void function': 'Function must return a value',
  'excess elements': 'Too many initializers for array or struct',
  'subscripted value': 'Using [] on something that is not an array or pointer',
  'member reference': 'Using . or -> incorrectly - check if pointer or value',
  'called object': 'Trying to call something that is not a function',
};

// Runtime error patterns
export const runtimeErrorPatterns = [
  { pattern: /Segmentation fault|SIGSEGV/, type: 'segfault',
    message: 'Program crashed (segmentation fault)',
    suggestion: 'Check for null pointer access, array out of bounds, or stack overflow' },
  { pattern: /Abort|SIGABRT/, type: 'abort',
    message: 'Program aborted',
    suggestion: 'Check for failed assertions or memory corruption' },
  { pattern: /Bus error|SIGBUS/, type: 'bus_error',
    message: 'Bus error (bad memory access)',
    suggestion: 'Check for misaligned memory access or mmap issues' },
  { pattern: /Floating point exception|SIGFPE/, type: 'fpe',
    message: 'Floating point exception',
    suggestion: 'Check for division by zero or invalid floating point operation' },
  { pattern: /Illegal instruction|SIGILL/, type: 'illegal_instruction',
    message: 'Illegal instruction',
    suggestion: 'Program tried to execute invalid CPU instruction' },
  { pattern: /stack smashing|stack-protector/, type: 'stack_overflow',
    message: 'Stack buffer overflow detected',
    suggestion: 'Array is being written past its bounds - check array sizes' },
  { pattern: /killed|SIGKILL/, type: 'killed',
    message: 'Program was killed (memory limit exceeded?)',
    suggestion: 'Reduce memory usage or array sizes' },
  { pattern: /out of memory|cannot allocate/, type: 'oom',
    message: 'Out of memory',
    suggestion: 'Reduce memory allocations or use smaller data structures' },
];

/**
 * Filter out harmless bash warnings from stderr
 */
export function filterBashWarnings(stderr) {
  return stderr
    .split('\n')
    .filter(line => !line.includes('initialize_job_control') && !line.includes('getpgrp failed'))
    .join('\n');
}

/**
 * Parse clang error output into structured format
 */
export function parseCompileErrors(stderr, tempFile) {
  const errors = [];
  const filteredStderr = filterBashWarnings(stderr);
  const lines = filteredStderr.split('\n');
  let currentError = null;

  // Create regex to match the temp file path
  const fileRegex = new RegExp(tempFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match clang error/warning format: file:line:col: error: message
    const errorMatch = line.match(/^[^:]+:(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/);

    if (errorMatch) {
      const severity = errorMatch[3];
      const message = errorMatch[4];

      if (severity === 'note' && currentError) {
        if (!currentError.notes) currentError.notes = [];
        currentError.notes.push(message);
      } else if (severity === 'error' || severity === 'warning') {
        let suggestion = null;
        for (const [pattern, hint] of Object.entries(errorSuggestions)) {
          if (message.toLowerCase().includes(pattern.toLowerCase())) {
            suggestion = hint;
            break;
          }
        }

        currentError = {
          line: parseInt(errorMatch[1]),
          column: parseInt(errorMatch[2]),
          severity,
          message,
          suggestion
        };
        errors.push(currentError);
      }
    } else if (currentError) {
      const trimmed = line.trim();

      // Modern clang format: "    3 |   int y = undefined_var;"
      const sourceMatch = line.match(/^\s*\d+\s*\|\s*(.+)$/);
      if (sourceMatch && !currentError.sourceLine) {
        currentError.sourceLine = sourceMatch[1];
      }

      // Caret line
      if (trimmed.includes('^') && !currentError.caret) {
        const caretMatch = line.match(/\|\s*(.*)$/) || [null, trimmed];
        currentError.caret = caretMatch[1] || trimmed;
      }
    }
  }

  if (errors.length > 0) {
    const errorCount = errors.filter(e => e.severity === 'error').length;
    const warningCount = errors.filter(e => e.severity === 'warning').length;

    return {
      type: 'compile_error',
      errors,
      summary: errorCount > 0
        ? `${errorCount} error${errorCount > 1 ? 's' : ''}${warningCount > 0 ? `, ${warningCount} warning${warningCount > 1 ? 's' : ''}` : ''}`
        : `${warningCount} warning${warningCount > 1 ? 's' : ''}`
    };
  }

  // Check for linker errors
  if (filteredStderr.includes('undefined reference') || filteredStderr.includes('ld:') || filteredStderr.includes('Undefined symbols')) {
    const undefMatch = filteredStderr.match(/undefined reference to [`']([^'`]+)[`']/) ||
                       filteredStderr.match(/Undefined symbols.*"([^"]+)"/);
    const symbol = undefMatch ? undefMatch[1] : null;

    return {
      type: 'linker_error',
      message: symbol
        ? `Undefined symbol: ${symbol}`
        : 'Linker error - undefined reference',
      suggestion: symbol?.startsWith('_')
        ? 'Check that the function is defined, not just declared'
        : 'Check for missing function definitions or library links',
      raw: filteredStderr.replace(fileRegex, 'input').substring(0, 500)
    };
  }

  // Check for runtime errors
  for (const { pattern, type, message, suggestion } of runtimeErrorPatterns) {
    if (pattern.test(filteredStderr)) {
      return {
        type: 'runtime_error',
        errorType: type,
        message,
        suggestion,
        raw: filteredStderr
      };
    }
  }

  // Check for timeout
  if (filteredStderr.includes('timeout') || filteredStderr.includes('timed out')) {
    return {
      type: 'timeout',
      message: 'Execution timed out',
      suggestion: 'Check for infinite loops or reduce input size'
    };
  }

  // Generic error
  return {
    type: 'unknown_error',
    message: filteredStderr.replace(fileRegex, 'input').substring(0, 1000)
  };
}

/**
 * Create a detailed error response
 */
export function createErrorResponse(error, mainFile, options = {}) {
  const { includePartialResults = false, partialResults = null } = options;

  // Check if stdout contains JSON error from cache-explore script
  if (error.stdout) {
    try {
      const jsonError = JSON.parse(error.stdout.trim());
      if (jsonError.error) {
        const errorFile = error.mainFile || mainFile;
        const parsed = jsonError.details
          ? parseCompileErrors(jsonError.details, errorFile)
          : { type: 'compile_error', message: jsonError.error };

        parsed.raw = jsonError.details || error.stdout;
        if (error.exitCode !== undefined) {
          parsed.exitCode = error.exitCode;
        }
        if (includePartialResults && partialResults) {
          parsed.partialResults = partialResults;
        }
        return parsed;
      }
    } catch {
      // Not JSON, continue
    }
  }

  // Check for timeout with partial results
  if (error.timeout) {
    const result = {
      type: 'timeout',
      message: `Execution timed out after ${Math.round(error.timeoutMs / 1000)}s`,
      suggestion: 'Check for infinite loops, reduce input size, or increase timeout'
    };
    if (includePartialResults && partialResults) {
      result.partialResults = partialResults;
      result.message += ' - partial results available';
    }
    return result;
  }

  // Parse stderr for compile errors
  if (error.stderr) {
    const errorFile = error.mainFile || mainFile;
    const cleanedStderr = filterBashWarnings(error.stderr);
    const parsed = parseCompileErrors(cleanedStderr, errorFile);
    parsed.raw = cleanedStderr;
    if (error.exitCode !== undefined) {
      parsed.exitCode = error.exitCode;
    }
    if (includePartialResults && partialResults) {
      parsed.partialResults = partialResults;
    }
    return parsed;
  }

  if (error.message) {
    return {
      type: 'server_error',
      message: error.message,
      raw: error.stack || error.message
    };
  }

  return {
    type: 'server_error',
    message: 'Unknown error occurred',
    raw: JSON.stringify(error, null, 2)
  };
}

export default {
  parseCompileErrors,
  createErrorResponse,
  filterBashWarnings,
  errorSuggestions,
  runtimeErrorPatterns,
};
