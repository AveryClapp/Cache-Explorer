import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { writeFile, unlink, mkdir, rm, readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import yaml from 'js-yaml';
import { checkSandboxAvailable, runInSandbox, parseSandboxError } from './sandbox.js';
import { initDb, createShortUrl, getShortUrl, isHealthy as isDbHealthy, getDbStats } from './db.js';
import { getCachedResult, cacheResult, startCachePruning } from './cache.js';
import { incCounter, setGauge, recordDuration, getPrometheusMetrics, getHealthStatus } from './metrics.js';
import { discoverCompilers, getCompiler, getDefaultCompiler } from './compilers.js';

// Modular imports (gradually migrating to these)
import { CONFIG } from './config.js';
import { healthRoutes, shareRoutes, compilerRoutes } from './routes/index.js';
import { parseCompileErrors, createErrorResponse } from './services/errorParser.js';
import { ConnectionResourceTracker, connectionResources, getOrCreateTracker, removeTracker } from './middleware/resourceTracker.js';

// CONFIG is now imported from ./config.js

// ConnectionResourceTracker is now imported from ./middleware/resourceTracker.js

// ============================================================================
// Helper Functions
// ============================================================================

// Sanitize filename to prevent path traversal attacks
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'unnamed.c';
  }
  // Extract just the basename, removing any path components
  const basename = filename.split(/[/\\]/).pop() || 'unnamed.c';
  // Remove any null bytes
  const noNulls = basename.replace(/\0/g, '');
  // Only allow alphanumeric, dots, underscores, hyphens
  const sanitized = noNulls.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Prevent hidden files and ensure non-empty
  const final = sanitized.replace(/^\.+/, '') || 'unnamed.c';
  // Limit length
  return final.slice(0, 255);
}

// Helper to create temp directory with files
async function createTempProject(files, language = 'c') {
  const extensions = { c: '.c', cpp: '.cpp', rust: '.rs' };
  const ext = extensions[language] || '.c';
  const tempDir = `/tmp/cache-explorer-${randomUUID()}`;

  await mkdir(tempDir, { recursive: true });

  // If files is an array, write all files
  if (Array.isArray(files)) {
    // Create a map from original name to sanitized name for lookup
    const nameMap = new Map();
    for (const file of files) {
      const safeName = sanitizeFilename(file.name);
      nameMap.set(file.name, safeName);
      const filePath = join(tempDir, safeName);
      await writeFile(filePath, file.code);
    }
    // Return the first file as the main file (or one containing main())
    const mainFile = files.find(f => f.code.includes('int main') || f.code.includes('fn main')) || files[0];
    return { tempDir, mainFile: join(tempDir, nameMap.get(mainFile.name)) };
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

// Cleanup orphaned temp directories periodically
async function cleanupOrphanedTempDirs() {
  try {
    const tmpDir = '/tmp';
    const entries = await readdir(tmpDir);
    const now = Date.now();

    for (const entry of entries) {
      if (entry.startsWith('cache-explorer-')) {
        const fullPath = join(tmpDir, entry);
        try {
          const { mtime } = await import('fs').then(fs =>
            fs.promises.stat(fullPath)
          );
          if (now - mtime.getTime() > CONFIG.cleanup.tempDirMaxAgeMs) {
            await rm(fullPath, { recursive: true, force: true });
          }
        } catch {
          // Ignore stat/cleanup errors
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Start periodic cleanup
setInterval(cleanupOrphanedTempDirs, CONFIG.cleanup.orphanCheckIntervalMs);

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = dirname(__dirname);
const CACHE_EXPLORE = join(BACKEND_DIR, 'scripts', 'cache-explore');

// Check sandbox availability on startup
let sandboxAvailable = false;
// TEMPORARILY DISABLED: Docker sandbox is failing, use direct execution
// checkSandboxAvailable().then(available => {
//   sandboxAvailable = available;
//   if (available) {
//     console.log('Docker sandbox: ENABLED (secure mode)');
//   } else {
//     console.log('Docker sandbox: DISABLED (development mode - run docker/build-image.sh to enable)');
//   }
// });
console.log('Docker sandbox: DISABLED (troubleshooting mode - using direct execution)');

// Error handling imported from ./services/errorParser.js

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ============================================================================
// HTTP Endpoints
// ============================================================================

app.post('/compile', async (req, res) => {
  const startTime = Date.now();
  incCounter('requests', { type: 'compile' });

  const {
    code,
    files,
    config = 'educational',
    optLevel = '-O0',
    language = 'c',
    sample,
    limit,
    fast,
    timeout: requestedTimeout
  } = req.body;

  // Support both single code string and files array
  const inputFiles = files || (code ? code : null);
  if (!inputFiles) {
    return res.status(400).json({ error: 'No code provided', type: 'validation_error' });
  }

  // Apply sensible defaults for web UI to prevent timeouts
  // 100K events = ~1 second runtime, good balance for web UI responsiveness
  const eventLimit = limit !== undefined ? limit : 100000;
  const sampleRate = sample !== undefined ? sample : 1;       // No sampling by default
  const fastMode = fast === true;                             // Fast mode disables 3C classification

  // Normalize files for cache key
  const normalizedFiles = Array.isArray(inputFiles)
    ? inputFiles
    : [{ name: 'main', code: inputFiles, language }];

  // Check cache first
  const cacheInputs = {
    files: normalizedFiles,
    config,
    optLevel,
    prefetch: req.body.prefetch || 'none',
    defines: req.body.defines || [],
    sampleRate,
    eventLimit,
    fastMode,
  };

  try {
    const cached = getCachedResult(cacheInputs);
    if (cached) {
      incCounter('cache_hits');
      recordDuration('compilation_duration', (Date.now() - startTime) / 1000);
      return res.json(cached);
    }
  } catch (err) {
    // Cache miss or error, continue with compilation
  }
  incCounter('cache_misses');

  // Configurable timeout with bounds
  const timeout = Math.min(
    Math.max(requestedTimeout || CONFIG.timeouts.default, CONFIG.timeouts.min),
    CONFIG.timeouts.max
  );

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
        defines: req.body.defines || [],
        timeout
      });

      const output = result.stdout.trim();
      try {
        const json = JSON.parse(output);

        // Remove cacheState to reduce output size (it's huge and unused by UI)
        if (json.cacheState) {
          delete json.cacheState;
        }

        // Cache successful result
        try {
          cacheResult(cacheInputs, json);
        } catch (cacheErr) {
          console.warn('Failed to cache result:', cacheErr.message);
        }
        recordDuration('compilation_duration', (Date.now() - startTime) / 1000);
        res.json(json);
      } catch {
        // Filter out bash warnings from stderr
        const cleanedStderr = result.stderr
          .split('\n')
          .filter(line => !line.includes('initialize_job_control') && !line.includes('getpgrp failed'))
          .join('\n');
        res.json({ raw: output, stderr: cleanedStderr });
      }
    } catch (err) {
      incCounter('errors', { type: 'compile' });
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

      // Enable multi-file compilation for multi-file projects
      if (Array.isArray(inputFiles) && inputFiles.length > 1) {
        args.push('--multi-file');
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

      // Always pass prefetch policy explicitly (whitelist valid policies)
      const VALID_PREFETCH_POLICIES = ['none', 'next-line', 'stream', 'stride', 'adaptive', 'intel'];
      const prefetchToUse = req.body.prefetch && VALID_PREFETCH_POLICIES.includes(req.body.prefetch) ? req.body.prefetch : 'none';
      args.push('--prefetch', prefetchToUse);

      // Add compiler selection if specified
      if (req.body.compiler) {
        const compiler = getCompiler(req.body.compiler);
        if (compiler && compiler.path) {
          args.push('--compiler', compiler.path);
        }
      }

      // Add sampling and limit for performance
      if (sampleRate > 1) {
        args.push('--sample', String(sampleRate));
      }
      if (eventLimit > 0) {
        args.push('--limit', String(eventLimit));
      }
      // Add fast mode flag (disables 3C miss classification for ~3x speedup)
      if (fastMode) {
        args.push('--fast');
      }

      const proc = spawn(CACHE_EXPLORE, args);

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 1000);
      }, timeout);

      proc.stdout.on('data', (data) => {
        stdout += data;
        // Prevent excessive memory usage
        if (stdout.length > CONFIG.memory.maxOutputBuffer) {
          killed = true;
          proc.kill('SIGKILL');
        }
      });
      proc.stderr.on('data', (data) => {
        stderr += data;
        // Apply same buffer limit as stdout to prevent OOM
        if (stderr.length > CONFIG.memory.maxOutputBuffer) {
          killed = true;
          proc.kill('SIGKILL');
        }
      });

      proc.on('close', (exitCode) => {
        clearTimeout(timeoutId);
        if (killed && exitCode !== 0) {
          reject({ stdout, stderr, exitCode, mainFile, timeout: true, timeoutMs: timeout });
        } else if (exitCode !== 0) {
          reject({ stdout, stderr, exitCode, mainFile });
        } else {
          resolve({ stdout, stderr });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });

    const output = result.stdout.trim();

    try {
      const json = JSON.parse(output);

      // Remove cacheState to reduce output size (it's huge and unused by UI)
      if (json.cacheState) {
        delete json.cacheState;
      }

      // Cache successful result
      try {
        cacheResult(cacheInputs, json);
      } catch (cacheErr) {
        console.warn('Failed to cache result:', cacheErr.message);
      }
      recordDuration('compilation_duration', (Date.now() - startTime) / 1000);
      res.json(json);
    } catch {
      // Filter out bash warnings from stderr
      const cleanedStderr = result.stderr
        .split('\n')
        .filter(line => !line.includes('initialize_job_control') && !line.includes('getpgrp failed'))
        .join('\n');
      res.json({ raw: output, stderr: cleanedStderr });
    }
  } catch (err) {
    incCounter('errors', { type: 'compile' });
    console.error('HTTP compile error:', err);
    const parsed = createErrorResponse(err, mainFile);
    res.status(400).json(parsed);
  } finally {
    if (tempDir) {
      await cleanupTempProject(tempDir);
    }
  }
});

app.get('/health', (req, res) => {
  const health = getHealthStatus();
  res.json({
    ...health,
    sandbox: sandboxAvailable ? 'enabled' : 'disabled',
    mode: sandboxAvailable ? 'production' : 'development',
    config: {
      timeouts: CONFIG.timeouts,
      rateLimit: CONFIG.rateLimit
    }
  });
});

// Prometheus metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(getPrometheusMetrics());
});

// Compiler discovery endpoint
app.get('/api/compilers', (req, res) => {
  try {
    const compilers = discoverCompilers();
    res.json({
      compilers,
      default: getDefaultCompiler()?.id || 'clang-21'
    });
  } catch (err) {
    console.error('Failed to discover compilers:', err);
    res.status(500).json({ error: 'Failed to discover compilers' });
  }
});

// ============================================================================
// Link Shortener (SQLite-backed)
// ============================================================================

// Create short link
app.post('/shorten', (req, res) => {
  incCounter('requests', { type: 'share' });
  const { state } = req.body;
  if (!state) {
    return res.status(400).json({ error: 'No state provided' });
  }

  try {
    const code = createShortUrl(state);
    res.json({ id: code, url: `/s/${code}` });
  } catch (err) {
    console.error('Failed to create short URL:', err);
    incCounter('errors', { type: 'share' });
    res.status(500).json({ error: 'Failed to create short URL' });
  }
});

// Retrieve short link
app.get('/s/:id', (req, res) => {
  const { id } = req.params;

  try {
    const data = getShortUrl(id);
    if (!data) {
      return res.status(404).json({ error: 'Link not found' });
    }
    res.json({ state: data });
  } catch (err) {
    console.error('Failed to retrieve short URL:', err);
    res.status(500).json({ error: 'Failed to retrieve link' });
  }
});

// API endpoint for sharing (alternative route)
app.post('/api/share', (req, res) => {
  incCounter('requests', { type: 'share' });
  const { data } = req.body;
  if (!data) {
    return res.status(400).json({ error: 'No data provided' });
  }

  try {
    const code = createShortUrl(data);
    res.json({ code, url: `/s/${code}` });
  } catch (err) {
    console.error('Failed to create short URL:', err);
    incCounter('errors', { type: 'share' });
    res.status(500).json({ error: 'Failed to create short URL' });
  }
});

app.get('/api/s/:code', (req, res) => {
  const { code } = req.params;

  try {
    const data = getShortUrl(code);
    if (!data) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ data });
  } catch (err) {
    console.error('Failed to retrieve short URL:', err);
    res.status(500).json({ error: 'Failed to retrieve' });
  }
});

// ============================================================================
// OpenAPI Documentation Endpoints
// ============================================================================

// Cache the OpenAPI spec to avoid reading from disk on every request
let openApiSpecCache = null;
let openApiJsonCache = null;

async function loadOpenApiSpec() {
  if (!openApiSpecCache) {
    const specPath = join(__dirname, 'openapi.yaml');
    openApiSpecCache = await readFile(specPath, 'utf-8');
    openApiJsonCache = yaml.load(openApiSpecCache);
  }
  return { yaml: openApiSpecCache, json: openApiJsonCache };
}

// Serve OpenAPI spec as YAML
app.get('/api/docs', async (req, res) => {
  try {
    const { yaml: specYaml } = await loadOpenApiSpec();
    res.set('Content-Type', 'text/yaml');
    res.send(specYaml);
  } catch (err) {
    console.error('Failed to load OpenAPI spec:', err);
    res.status(500).json({ error: 'Failed to load API documentation' });
  }
});

// Serve OpenAPI spec as JSON
app.get('/api/docs.json', async (req, res) => {
  try {
    const { json: specJson } = await loadOpenApiSpec();
    res.json(specJson);
  } catch (err) {
    console.error('Failed to load OpenAPI spec:', err);
    res.status(500).json({ error: 'Failed to load API documentation' });
  }
});

// ============================================================================
// WebSocket Handler
// ============================================================================

wss.on('connection', (ws) => {
  const connectionId = randomUUID();
  const tracker = new ConnectionResourceTracker(connectionId);
  connectionResources.set(connectionId, tracker);

  console.log(`WebSocket client connected: ${connectionId}`);

  // Set up heartbeat to detect dead connections
  let isAlive = true;
  ws.on('pong', () => { isAlive = true; });

  tracker.heartbeatInterval = setInterval(() => {
    if (!isAlive) {
      console.log(`Client ${connectionId} appears dead, terminating`);
      ws.terminate();
      return;
    }
    isAlive = false;
    try {
      ws.ping();
    } catch {
      // Connection already dead
    }
  }, CONFIG.timeouts.heartbeat);

  // Send connection info
  ws.send(JSON.stringify({
    type: 'connected',
    connectionId,
    config: {
      maxTimeout: CONFIG.timeouts.max,
      defaultTimeout: CONFIG.timeouts.default,
      rateLimit: CONFIG.rateLimit.maxRequestsPerMinute
    }
  }));

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      return;
    }

    // Handle cancel request
    if (data.type === 'cancel') {
      await tracker.cleanup();
      ws.send(JSON.stringify({ type: 'cancelled' }));
      return;
    }

    // Rate limiting check
    if (!tracker.checkRateLimit()) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Rate limit exceeded',
        suggestion: `Maximum ${CONFIG.rateLimit.maxRequestsPerMinute} requests per minute`,
        retryAfter: Math.ceil(CONFIG.rateLimit.windowMs / 1000)
      }));
      return;
    }

    // Concurrent process limit check
    if (!tracker.canStartProcess()) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Too many concurrent processes',
        suggestion: 'Wait for current processes to complete'
      }));
      return;
    }

    const {
      code,
      files,
      config = 'educational',
      optLevel = '-O0',
      customConfig,
      defines,
      language = 'c',
      prefetch,
      sample,
      limit,
      fast,
      timeout: requestedTimeout
    } = data;

    // Support both single code string and files array
    const inputFiles = files || (code ? code : null);
    if (!inputFiles) {
      ws.send(JSON.stringify({ type: 'error', error: 'No code provided' }));
      return;
    }

    // Apply sensible defaults for web UI to prevent timeouts
    const eventLimit = limit !== undefined ? limit : 100000;  // Match HTTP default for responsive web UI
    const sampleRate = sample !== undefined ? sample : 1;       // No sampling by default
    const fastMode = fast === true;                             // Fast mode disables 3C classification

    // Configurable timeout with bounds
    const timeout = Math.min(
      Math.max(requestedTimeout || CONFIG.timeouts.default, CONFIG.timeouts.min),
      CONFIG.timeouts.max
    );

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
          fastMode,
          customConfig,
          defines: defines || [],
          timeout,
          onProgress: (progress) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'status', ...progress }));
            }
          }
        });

        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'status', stage: 'done' }));

          const output = result.stdout.trim();
          try {
            const json = JSON.parse(output);
            ws.send(JSON.stringify({ type: 'result', data: json }));
          } catch {
            ws.send(JSON.stringify({ type: 'result', data: { raw: output } }));
          }
        }
      } catch (err) {
        if (ws.readyState === ws.OPEN) {
          const parsed = parseSandboxError(err);
          ws.send(JSON.stringify({ type: 'error', ...parsed }));
        }
      }
      return;
    }

    // Fallback: Direct execution (development mode) with real-time streaming
    let tempDir, mainFile;
    let proc = null;
    let cleanupFn = null;

    try {
      // Status: writing file
      ws.send(JSON.stringify({ type: 'status', stage: 'preparing' }));
      const project = await createTempProject(inputFiles, language);
      tempDir = project.tempDir;
      mainFile = project.mainFile;
      tracker.tempDirs.add(tempDir);

      // Status: compiling
      ws.send(JSON.stringify({ type: 'status', stage: 'compiling' }));

      const result = await new Promise((resolve, reject) => {
        // Use --stream for real-time updates and --json for structured output
        const args = [mainFile, '--config', config, optLevel, '--stream', '--json'];

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

        // Always pass prefetch policy explicitly (whitelist valid policies)
        const VALID_PREFETCH_POLICIES = ['none', 'next-line', 'stream', 'stride', 'adaptive', 'intel'];
        const prefetchToUse = prefetch && VALID_PREFETCH_POLICIES.includes(prefetch) ? prefetch : 'none';
        args.push('--prefetch', prefetchToUse);

        // Add compiler selection if specified
        if (data.compiler) {
          const selectedCompiler = getCompiler(data.compiler);
          if (selectedCompiler && selectedCompiler.path) {
            args.push('--compiler', selectedCompiler.path);
          }
        }

        // Add sampling and limit for performance
        if (sampleRate > 1) {
          args.push('--sample', String(sampleRate));
        }
        if (eventLimit > 0) {
          args.push('--limit', String(eventLimit));
        }
        // Add fast mode flag (disables 3C miss classification for ~3x speedup)
        if (fastMode) {
          args.push('--fast');
        }

        console.log(`[WebSocket] spawning: ${CACHE_EXPLORE} ${args.join(' ')}`);
        proc = spawn(CACHE_EXPLORE, args);
        cleanupFn = tracker.addProcess(proc, tempDir);
        console.log(`[WebSocket] process spawned with PID ${proc.pid}`);

        let finalResult = null;
        let partialProgress = null;
        let stderr = '';
        let lineBuffer = '';
        let killed = false;
        let eventBatch = [];
        let lastBatchSent = Date.now();
        let lastProgressSent = Date.now();

        // Set up timeout with graceful termination
        const timeoutId = setTimeout(() => {
          killed = true;
          // Send partial results before killing
          if (partialProgress && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'warning',
              message: 'Execution timeout - sending partial results',
              partialProgress
            }));
          }
          // Graceful termination
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL');
            }
          }, 2000);
        }, timeout);

        // Function to flush event batch
        const flushEventBatch = () => {
          if (eventBatch.length > 0 && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'events',
              events: eventBatch,
              count: eventBatch.length
            }));
            eventBatch = [];
            lastBatchSent = Date.now();
          }
        };

        // Batch flush interval
        const batchInterval = setInterval(() => {
          flushEventBatch();
        }, CONFIG.streaming.batchIntervalMs);

        proc.stdout.on('data', (chunk) => {
          console.log(`[WebSocket] stdout received ${chunk.length} bytes`);
          lineBuffer += chunk.toString();
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop(); // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              console.log(`[WebSocket] parsed event type: ${event.type}`);
              if (event.type === 'start') {
                console.log(`[WebSocket] sending start event to ws.readyState=${ws.readyState}`);
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'status',
                    stage: 'running',
                    config: event.config,
                    timeout: timeout / 1000
                  }));
                  console.log(`[WebSocket] sent start status`);
                }
              } else if (event.type === 'progress') {
                partialProgress = event;
                // Send progress updates at intervals, not every event
                const now = Date.now();
                if (now - lastProgressSent >= CONFIG.streaming.progressIntervalMs) {
                  console.log(`[WebSocket] sending progress ${event.events} events`);
                  if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'progress', ...event }));
                    console.log(`[WebSocket] sent progress`);
                  }
                  lastProgressSent = now;
                }
              } else if (event.type === 'event') {
                // Batch individual events
                eventBatch.push(event);
                if (eventBatch.length >= CONFIG.streaming.batchSize) {
                  flushEventBatch();
                }
              } else if (event.type === 'complete') {
                // Store final result
                console.log(`[WebSocket] got complete event`);
                finalResult = event;
              } else if (event.error) {
                // Handle error response from cache-explore script
                console.log(`[WebSocket] got error event: ${event.error}`);
                if (ws.readyState === ws.OPEN) {
                  // Strip temp directory paths from error output for cleaner display
                  let rawError = event.details || event.error;
                  rawError = rawError.replace(/\/tmp\/cache-explorer-[a-f0-9-]+\//g, '');
                  ws.send(JSON.stringify({
                    type: 'compile_error',
                    raw: rawError
                  }));
                }
                // Mark as handled error so we don't send generic error later
                finalResult = { error: event.error, details: event.details };
              }
            } catch (e) {
              // Non-JSON output, log it for debugging
              console.log(`[WebSocket] JSON parse error: ${e.message}, line: ${line.slice(0, 100)}`);
            }
          }
        });

        proc.stderr.on('data', (chunk) => {
          stderr += chunk;
          // Apply same buffer limit as stdout to prevent OOM
          if (stderr.length > CONFIG.memory.maxOutputBuffer) {
            killed = true;
            proc.kill('SIGKILL');
            return;
          }
          // Stream compilation progress
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (ws.readyState === ws.OPEN) {
              if (line.includes('Compiling')) {
                ws.send(JSON.stringify({ type: 'status', stage: 'compiling', message: line }));
              } else if (line.includes('Running')) {
                ws.send(JSON.stringify({ type: 'status', stage: 'running' }));
              } else if (line.includes('Simulating')) {
                ws.send(JSON.stringify({ type: 'status', stage: 'simulating', message: line }));
              }
            }
          }
        });

        proc.on('close', (exitCode) => {
          clearTimeout(timeoutId);
          clearInterval(batchInterval);
          flushEventBatch(); // Send any remaining events

          if (cleanupFn) cleanupFn();

          // Process any remaining buffered output
          if (lineBuffer.trim()) {
            try {
              const event = JSON.parse(lineBuffer);
              if (event.type === 'complete') {
                finalResult = event;
              } else if (event.error && !finalResult) {
                // Handle error from buffered output if not already processed
                console.log(`[WebSocket] got error in close handler: ${event.error}`);
                if (ws.readyState === ws.OPEN) {
                  let rawError = event.details || event.error;
                  rawError = rawError.replace(/\/tmp\/cache-explorer-[a-f0-9-]+\//g, '');
                  ws.send(JSON.stringify({
                    type: 'compile_error',
                    raw: rawError
                  }));
                }
                finalResult = { error: event.error, details: event.details };
              }
            } catch {}
          }

          if (killed) {
            reject({
              stdout: lineBuffer,
              stderr,
              exitCode,
              mainFile,
              timeout: true,
              timeoutMs: timeout,
              partialProgress
            });
          } else if (exitCode !== 0 && finalResult && finalResult.error) {
            // Error already sent to client via WebSocket, resolve to avoid duplicate
            resolve({ data: finalResult, stderr });
          } else if (exitCode !== 0) {
            reject({ stdout: lineBuffer, stderr, exitCode, mainFile, partialProgress });
          } else {
            resolve({ data: finalResult, stderr });
          }
        });

        proc.on('error', (err) => {
          clearTimeout(timeoutId);
          clearInterval(batchInterval);
          if (cleanupFn) cleanupFn();
          reject(err);
        });
      });

      // Status: done
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'status', stage: 'done' }));

        if (result.data) {
          ws.send(JSON.stringify({ type: 'result', data: result.data }));
        } else {
          ws.send(JSON.stringify({ type: 'error', error: 'No results received' }));
        }
      }
    } catch (err) {
      console.error('Cache-explore error:', err);

      if (ws.readyState === ws.OPEN) {
        const parsed = createErrorResponse(err, mainFile, {
          includePartialResults: true,
          partialResults: err.partialProgress
        });
        ws.send(JSON.stringify({ type: 'error', ...parsed }));
      }
    } finally {
      if (tempDir) {
        tracker.tempDirs.delete(tempDir);
        await cleanupTempProject(tempDir);
      }
    }
  });

  ws.on('close', async () => {
    console.log(`WebSocket client disconnected: ${connectionId}`);

    // Cleanup all resources for this connection
    await tracker.cleanup();
    connectionResources.delete(connectionId);
  });

  ws.on('error', async (err) => {
    console.error(`WebSocket error for ${connectionId}:`, err.message);
    await tracker.cleanup();
    connectionResources.delete(connectionId);
  });
});

// ============================================================================
// Server Startup
// ============================================================================

const PORT = process.env.PORT || 3001;

// Initialize database and caching
try {
  initDb();
  startCachePruning();
  console.log('Database and cache initialized');
} catch (err) {
  console.warn('Database initialization failed, running without persistence:', err.message);
}

server.listen(PORT, () => {
  console.log(`Cache Explorer server running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
  console.log(`Configuration: timeout=${CONFIG.timeouts.default}ms (max ${CONFIG.timeouts.max}ms), rate=${CONFIG.rateLimit.maxRequestsPerMinute}/min`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');

  // Cleanup all connections
  for (const [id, tracker] of connectionResources) {
    await tracker.cleanup();
  }
  connectionResources.clear();

  // Close server
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.log('Forcing shutdown');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down...');

  for (const [id, tracker] of connectionResources) {
    await tracker.cleanup();
  }

  process.exit(0);
});
