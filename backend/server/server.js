import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { writeFile, unlink, mkdir, rm, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { checkSandboxAvailable, runInSandbox, parseSandboxError } from './sandbox.js';

// Helper to create temp directory with files
async function createTempProject(files, language = 'c') {
  const extensions = { c: '.c', cpp: '.cpp', rust: '.rs' };
  const ext = extensions[language] || '.c';
  const tempDir = `/tmp/cache-explorer-${randomUUID()}`;

  await mkdir(tempDir, { recursive: true });

  // If files is an array, write all files
  if (Array.isArray(files)) {
    for (const file of files) {
      const filePath = join(tempDir, file.name);
      await writeFile(filePath, file.code);
    }
    // Return the first file as the main file (or one containing main())
    const mainFile = files.find(f => f.code.includes('int main') || f.code.includes('fn main')) || files[0];
    return { tempDir, mainFile: join(tempDir, mainFile.name) };
  }

  // Backward compatibility: single code string
  const mainFile = join(tempDir, `main${ext}`);
  await writeFile(mainFile, files);
  return { tempDir, mainFile };
}

// Helper to cleanup temp directory
async function cleanupTempProject(tempDir) {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = dirname(__dirname);
const CACHE_EXPLORE = join(BACKEND_DIR, 'scripts', 'cache-explore');

// Check sandbox availability on startup
let sandboxAvailable = false;
checkSandboxAvailable().then(available => {
  sandboxAvailable = available;
  if (available) {
    console.log('Docker sandbox: ENABLED (secure mode)');
  } else {
    console.log('Docker sandbox: DISABLED (development mode - run docker/build-image.sh to enable)');
  }
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Common error patterns and their helpful suggestions
const errorSuggestions = {
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

// Parse clang error output into structured format
function parseCompileErrors(stderr, tempFile) {
  const errors = [];
  const lines = stderr.split('\n');
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
        // Attach notes to the previous error
        if (!currentError.notes) currentError.notes = [];
        currentError.notes.push(message);
      } else if (severity === 'error' || severity === 'warning') {
        // Find suggestion for this error
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
      // Check for source line (contains | followed by code) or caret line (contains ^)
      const trimmed = line.trim();

      // Modern clang format: "    3 |   int y = undefined_var;"
      const sourceMatch = line.match(/^\s*\d+\s*\|\s*(.+)$/);
      if (sourceMatch && !currentError.sourceLine) {
        currentError.sourceLine = sourceMatch[1];
      }

      // Caret line: "      |           ^~~~~~~~~~~~~" or just "      ^"
      if (trimmed.includes('^') && !currentError.caret) {
        // Extract just the caret portion
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
  if (stderr.includes('undefined reference') || stderr.includes('ld:') || stderr.includes('Undefined symbols')) {
    // Extract the undefined symbol name
    const undefMatch = stderr.match(/undefined reference to [`']([^'`]+)[`']/) ||
                       stderr.match(/Undefined symbols.*"([^"]+)"/);
    const symbol = undefMatch ? undefMatch[1] : null;

    return {
      type: 'linker_error',
      message: symbol
        ? `Undefined symbol: ${symbol}`
        : 'Linker error - undefined reference',
      suggestion: symbol?.startsWith('_')
        ? 'Check that the function is defined, not just declared'
        : 'Check for missing function definitions or library links',
      raw: stderr.replace(fileRegex, 'input').substring(0, 500)
    };
  }

  // Check for runtime errors
  if (stderr.includes('Segmentation fault') || stderr.includes('SIGSEGV')) {
    return {
      type: 'runtime_error',
      message: 'Program crashed (segmentation fault)',
      suggestion: 'Check for null pointer access, array out of bounds, or stack overflow',
      raw: stderr
    };
  }

  if (stderr.includes('Abort') || stderr.includes('SIGABRT')) {
    return {
      type: 'runtime_error',
      message: 'Program aborted',
      suggestion: 'Check for failed assertions or memory corruption',
      raw: stderr
    };
  }

  if (stderr.includes('timeout') || stderr.includes('timed out')) {
    return {
      type: 'timeout',
      message: 'Execution timed out (10s limit)',
      suggestion: 'Check for infinite loops or reduce input size'
    };
  }

  // Generic error
  return {
    type: 'unknown_error',
    message: stderr.replace(fileRegex, 'input').substring(0, 1000)
  };
}

app.post('/compile', async (req, res) => {
  const { code, files, config = 'educational', optLevel = '-O0', language = 'c', sample, limit } = req.body;

  // Support both single code string and files array
  const inputFiles = files || (code ? code : null);
  if (!inputFiles) {
    return res.status(400).json({ error: 'No code provided', type: 'validation_error' });
  }

  // Apply sensible defaults for web UI to prevent timeouts
  const eventLimit = limit !== undefined ? limit : 5000000;  // 5M events max (~30s runtime)
  const sampleRate = sample !== undefined ? sample : 1;       // No sampling by default

  // Use Docker sandbox if available (production), otherwise direct execution (development)
  if (sandboxAvailable) {
    try {
      const result = await runInSandbox({
        code: Array.isArray(inputFiles) ? inputFiles[0].code : inputFiles,
        files: Array.isArray(inputFiles) ? inputFiles : undefined,
        language,
        config,
        optLevel,
        prefetch: req.body.prefetch || 'none',
        sampleRate,
        eventLimit,
        customConfig: req.body.customConfig,
        defines: req.body.defines || []
      });

      const output = result.stdout.trim();
      try {
        const json = JSON.parse(output);
        res.json(json);
      } catch {
        res.json({ raw: output, stderr: result.stderr });
      }
    } catch (err) {
      const parsed = parseSandboxError(err);
      res.status(400).json(parsed);
    }
    return;
  }

  // Fallback: Direct execution (development mode only)
  // WARNING: This executes untrusted code without sandboxing
  let tempDir, mainFile;

  try {
    const project = await createTempProject(inputFiles, language);
    tempDir = project.tempDir;
    mainFile = project.mainFile;

    const result = await new Promise((resolve, reject) => {
      const args = [mainFile, '--config', config, optLevel, '--json'];

      // Add include path for multi-file projects
      if (Array.isArray(inputFiles) && inputFiles.length > 1) {
        args.push('-I', tempDir);
      }

      // Add custom cache config args if provided
      if (req.body.customConfig) {
        const cc = req.body.customConfig;
        if (cc.l1Size) args.push('--l1-size', String(cc.l1Size));
        if (cc.l1Assoc) args.push('--l1-assoc', String(cc.l1Assoc));
        if (cc.lineSize) args.push('--l1-line', String(cc.lineSize));
        if (cc.l2Size) args.push('--l2-size', String(cc.l2Size));
        if (cc.l2Assoc) args.push('--l2-assoc', String(cc.l2Assoc));
        if (cc.l3Size) args.push('--l3-size', String(cc.l3Size));
        if (cc.l3Assoc) args.push('--l3-assoc', String(cc.l3Assoc));
      }

      // Add preprocessor defines
      if (req.body.defines && Array.isArray(req.body.defines)) {
        for (const def of req.body.defines) {
          if (def.name && def.name.trim()) {
            const defineStr = def.value ? `${def.name}=${def.value}` : def.name;
            args.push('-D', defineStr);
          }
        }
      }

      // Add prefetch policy if specified
      if (req.body.prefetch && req.body.prefetch !== 'none') {
        args.push('--prefetch', req.body.prefetch);
      }

      // Add sampling and limit for performance
      if (sampleRate > 1) {
        args.push('--sample', String(sampleRate));
      }
      if (eventLimit > 0) {
        args.push('--limit', String(eventLimit));
      }

      const proc = spawn(CACHE_EXPLORE, args);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (exitCode) => {
        if (exitCode !== 0) {
          reject({ stdout, stderr, exitCode, mainFile });
        } else {
          resolve({ stdout, stderr });
        }
      });

      proc.on('error', reject);
    });

    const output = result.stdout.trim();

    try {
      const json = JSON.parse(output);
      res.json(json);
    } catch {
      res.json({ raw: output, stderr: result.stderr });
    }
  } catch (err) {
    console.error('HTTP compile error:', err);

    // First, check if stdout contains JSON error from cache-explore script
    if (err.stdout) {
      try {
        const jsonError = JSON.parse(err.stdout.trim());
        if (jsonError.error) {
          // Parse the error details if present
          const errorFile = err.mainFile || mainFile;
          const parsed = jsonError.details
            ? parseCompileErrors(jsonError.details, errorFile)
            : { type: 'compile_error', message: jsonError.error };

          parsed.raw = jsonError.details || err.stdout;
          if (err.exitCode !== undefined) {
            parsed.exitCode = err.exitCode;
          }
          res.status(400).json(parsed);
          return;
        }
      } catch {
        // Not JSON, continue to other error handling
      }
    }

    // Fallback: parse stderr for compile errors
    if (err.stderr) {
      const errorFile = err.mainFile || mainFile;
      const parsed = parseCompileErrors(err.stderr, errorFile);
      parsed.raw = err.stderr;
      if (err.exitCode !== undefined) {
        parsed.exitCode = err.exitCode;
      }
      res.status(400).json(parsed);
    } else if (err.message) {
      res.status(500).json({
        error: err.message,
        type: 'server_error',
        raw: err.stack || err.message
      });
    } else {
      res.status(500).json({
        error: 'Unknown error occurred',
        type: 'server_error',
        raw: JSON.stringify(err, null, 2)
      });
    }
  } finally {
    if (tempDir) {
      await cleanupTempProject(tempDir);
    }
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    sandbox: sandboxAvailable ? 'enabled' : 'disabled',
    mode: sandboxAvailable ? 'production' : 'development'
  });
});

// Link shortener - in-memory store (replace with DB for production)
const shortLinks = new Map();

function generateShortId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// Create short link
app.post('/shorten', (req, res) => {
  const { state } = req.body;
  if (!state) {
    return res.status(400).json({ error: 'No state provided' });
  }

  const id = generateShortId();
  shortLinks.set(id, {
    state,
    created: Date.now()
  });

  // Cleanup old links (keep last 1000)
  if (shortLinks.size > 1000) {
    const oldest = [...shortLinks.entries()]
      .sort((a, b) => a[1].created - b[1].created)
      .slice(0, shortLinks.size - 1000);
    oldest.forEach(([key]) => shortLinks.delete(key));
  }

  res.json({ id });
});

// Retrieve short link
app.get('/s/:id', (req, res) => {
  const { id } = req.params;
  const link = shortLinks.get(id);

  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }

  res.json({ state: link.state });
});

// WebSocket handler for streaming results
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      return;
    }

    const { code, files, config = 'educational', optLevel = '-O0', customConfig, defines, language = 'c', prefetch, sample, limit } = data;

    // Support both single code string and files array
    const inputFiles = files || (code ? code : null);
    if (!inputFiles) {
      ws.send(JSON.stringify({ type: 'error', error: 'No code provided' }));
      return;
    }

    // Apply sensible defaults for web UI to prevent timeouts
    // Default: 1M event limit, no sampling (user can override)
    const eventLimit = limit !== undefined ? limit : 5000000;  // 5M events max (~30s runtime)
    const sampleRate = sample !== undefined ? sample : 1;       // No sampling by default

    // Use Docker sandbox if available
    if (sandboxAvailable) {
      try {
        const result = await runInSandbox({
          code,
          language,
          config,
          optLevel,
          prefetch: prefetch || 'none',
          sampleRate,
          eventLimit,
          customConfig,
          defines: defines || [],
          onProgress: (progress) => {
            ws.send(JSON.stringify({ type: 'status', ...progress }));
          }
        });

        ws.send(JSON.stringify({ type: 'status', stage: 'done' }));

        const output = result.stdout.trim();
        try {
          const json = JSON.parse(output);
          ws.send(JSON.stringify({ type: 'result', data: json }));
        } catch {
          ws.send(JSON.stringify({ type: 'result', data: { raw: output } }));
        }
      } catch (err) {
        const parsed = parseSandboxError(err);
        ws.send(JSON.stringify({ type: 'error', ...parsed }));
      }
      return;
    }

    // Fallback: Direct execution (development mode) with real-time streaming
    let tempDir, mainFile;

    try {
      // Status: writing file
      ws.send(JSON.stringify({ type: 'status', stage: 'preparing' }));
      const project = await createTempProject(inputFiles, language);
      tempDir = project.tempDir;
      mainFile = project.mainFile;

      // Status: compiling
      ws.send(JSON.stringify({ type: 'status', stage: 'compiling' }));

      const result = await new Promise((resolve, reject) => {
        // Use --stream for real-time updates
        const args = [mainFile, '--config', config, optLevel, '--stream'];

        // Add include path for multi-file projects
        if (Array.isArray(inputFiles) && inputFiles.length > 1) {
          args.push('-I', tempDir);
        }

        // Add custom cache config args if provided
        if (customConfig) {
          if (customConfig.l1Size) args.push('--l1-size', String(customConfig.l1Size));
          if (customConfig.l1Assoc) args.push('--l1-assoc', String(customConfig.l1Assoc));
          if (customConfig.lineSize) args.push('--l1-line', String(customConfig.lineSize));
          if (customConfig.l2Size) args.push('--l2-size', String(customConfig.l2Size));
          if (customConfig.l2Assoc) args.push('--l2-assoc', String(customConfig.l2Assoc));
          if (customConfig.l3Size) args.push('--l3-size', String(customConfig.l3Size));
          if (customConfig.l3Assoc) args.push('--l3-assoc', String(customConfig.l3Assoc));
        }

        // Add preprocessor defines
        if (defines && Array.isArray(defines)) {
          for (const def of defines) {
            if (def.name && def.name.trim()) {
              const defineStr = def.value ? `${def.name}=${def.value}` : def.name;
              args.push('-D', defineStr);
            }
          }
        }

        // Add prefetch policy if specified
        if (prefetch && prefetch !== 'none') {
          args.push('--prefetch', prefetch);
        }

        // Add sampling and limit for performance
        if (sampleRate > 1) {
          args.push('--sample', String(sampleRate));
        }
        if (eventLimit > 0) {
          args.push('--limit', String(eventLimit));
        }

        const proc = spawn(CACHE_EXPLORE, args);

        let finalResult = null;
        let stderr = '';
        let lineBuffer = '';

        proc.stdout.on('data', (chunk) => {
          lineBuffer += chunk.toString();
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop(); // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.type === 'start') {
                ws.send(JSON.stringify({ type: 'status', stage: 'running', config: event.config }));
              } else if (event.type === 'progress') {
                // Stream intermediate progress to client
                ws.send(JSON.stringify({ type: 'progress', ...event }));
              } else if (event.type === 'complete') {
                // Store final result
                finalResult = event;
              }
            } catch {
              // Non-JSON output, ignore
            }
          }
        });

        proc.stderr.on('data', (chunk) => {
          stderr += chunk;
          // Stream compilation progress
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.includes('Compiling')) {
              ws.send(JSON.stringify({ type: 'status', stage: 'compiling', message: line }));
            } else if (line.includes('Running')) {
              ws.send(JSON.stringify({ type: 'status', stage: 'running' }));
            }
          }
        });

        proc.on('close', (exitCode) => {
          // Process any remaining buffered output
          if (lineBuffer.trim()) {
            try {
              const event = JSON.parse(lineBuffer);
              if (event.type === 'complete') {
                finalResult = event;
              }
            } catch {}
          }

          if (exitCode !== 0) {
            // Include lineBuffer as stdout for error parsing
            reject({ stdout: lineBuffer, stderr, exitCode, mainFile });
          } else {
            resolve({ data: finalResult, stderr });
          }
        });

        proc.on('error', reject);
      });

      // Status: done
      ws.send(JSON.stringify({ type: 'status', stage: 'done' }));

      if (result.data) {
        ws.send(JSON.stringify({ type: 'result', data: result.data }));
      } else {
        ws.send(JSON.stringify({ type: 'error', error: 'No results received' }));
      }
    } catch (err) {
      console.error('Cache-explore error:', err);

      // First, check if stdout contains JSON error from cache-explore script
      if (err.stdout) {
        try {
          const jsonError = JSON.parse(err.stdout.trim());
          if (jsonError.error) {
            // Parse the error details if present
            const errorFile = err.mainFile || mainFile;
            const parsed = jsonError.details
              ? parseCompileErrors(jsonError.details, errorFile)
              : { type: 'compile_error', message: jsonError.error };

            parsed.raw = jsonError.details || err.stdout;
            if (err.exitCode !== undefined) {
              parsed.exitCode = err.exitCode;
            }
            ws.send(JSON.stringify({ type: 'error', ...parsed }));
            return;
          }
        } catch {
          // Not JSON, continue to other error handling
        }
      }

      // Fallback: parse stderr for compile errors
      if (err.stderr) {
        const errorFile = err.mainFile || mainFile;
        const parsed = parseCompileErrors(err.stderr, errorFile);
        parsed.raw = err.stderr;
        if (err.exitCode !== undefined) {
          parsed.exitCode = err.exitCode;
        }
        ws.send(JSON.stringify({ type: 'error', ...parsed }));
      } else if (err.message) {
        ws.send(JSON.stringify({
          type: 'error',
          message: err.message,
          raw: err.stack || err.message
        }));
      } else {
        // Fallback for unknown error format
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Unknown error occurred',
          raw: JSON.stringify(err, null, 2)
        }));
      }
    } finally {
      if (tempDir) {
        await cleanupTempProject(tempDir);
      }
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Cache Explorer server running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});
