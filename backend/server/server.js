import express from 'express';
import cors from 'cors';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import * as yaml from 'js-yaml';
import { checkSandboxAvailable, runInSandbox, parseSandboxError } from './sandbox.js';
import { initDb, createShortUrl, getShortUrl, isHealthy as isDbHealthy, getDbStats, pruneShortUrls } from './db.js';
import { getCachedResult, cacheResult, startCachePruning } from './cache.js';
import { incCounter, setGauge, recordDuration, getPrometheusMetrics, getHealthStatus } from './metrics.js';
import { discoverCompilers, getCompiler, getDefaultCompiler } from './compilers.js';
import { listHardwareProfiles, getHardwareProfile } from './hardwareProfiles.js';

// Modular imports (gradually migrating to these)
import { CONFIG } from './config.js';
import { parseCompileErrors, createErrorResponse } from './services/errorParser.js';
import { runManagedProcess, runProcess } from './services/processRunner.js';
import { createTempProject, cleanupTempProject, cleanupOrphanedTempDirs } from './services/tempProject.js';
import { workloadProcessErrorResponse } from './services/workloadErrors.js';
import { loadWorkloadHistory } from './services/workloadHistory.js';
import { deploymentSecurityFromEnv } from './services/deploymentMode.js';
import {
  normalizeRequestTimeout,
  parseConfigList,
  validateSharePayload,
  validateWorkPlan,
} from './services/requestValidation.js';
import { isAllowedClientOrigin, validateDirectBind } from './services/clientSecurity.js';
import {
  ConnectionResourceTracker,
  connectionResources,
  createHttpExecutionLimitMiddleware,
  createHttpRateLimitMiddleware,
  getOrCreateTracker,
  removeTracker,
  reserveGlobalExecution,
} from './middleware/resourceTracker.js';

// CONFIG is now imported from ./config.js

// ConnectionResourceTracker is now imported from ./middleware/resourceTracker.js

// ============================================================================
// Helper Functions
// ============================================================================

function uniqueCaveats(caveats) {
  return [...new Set(caveats.filter(Boolean))];
}

function resultProvenance({
  config,
  sampleRate,
  eventLimit,
  fastMode,
  segmentCaching,
  prefetch,
  sandbox,
  cached = false,
}, existing = {}) {
  const profile = getHardwareProfile(config);
  const caveats = [
    'Cycles and bottlenecks are simulator estimates, not wall-clock measurements.',
  ];

  if (sampleRate > 1) {
    caveats.push(`Trace events were sampled at 1:${sampleRate}.`);
  }
  if (fastMode) {
    caveats.push('Fast mode disables detailed 3C miss classification.');
  }
  if (segmentCaching) {
    caveats.push('Segment caching may reuse repeated loop traces.');
  }

  return {
    ...existing,
    resultKind: 'simulated',
    executor: sandbox ? 'sandbox' : 'direct-dev',
    cached,
    hardwareProfile: {
      id: profile?.id || config,
      displayName: profile?.displayName || config,
      modelConfidence: profile?.modelConfidence || 'unknown',
      validationConfidence: profile?.validation?.confidence || profile?.modelConfidence || 'unknown',
    },
    fidelity: {
      ...existing.fidelity,
      trace: sampleRate > 1 ? 'sampled' : 'full',
      sampleRate,
      eventLimit,
      fastMode,
      cacheSegments: segmentCaching,
      prefetch: prefetch || 'none',
    },
    caveats: uniqueCaveats([...(existing.caveats || []), ...caveats]),
  };
}

function stripCacheState(result) {
  if (result && typeof result === 'object' && result.cacheState) {
    delete result.cacheState;
  }
  return result;
}

function mergeHardwareProfileDetails(catalogDetails, emittedDetails) {
  if (!catalogDetails && !emittedDetails) return undefined;
  return {
    ...catalogDetails,
    ...emittedDetails,
    cache: {
      ...catalogDetails?.cache,
      ...emittedDetails?.cache,
      levels: {
        ...catalogDetails?.cache?.levels,
        ...emittedDetails?.cache?.levels,
      },
    },
    tlb: {
      ...catalogDetails?.tlb,
      ...emittedDetails?.tlb,
    },
    prefetch: {
      ...catalogDetails?.prefetch,
      ...emittedDetails?.prefetch,
    },
    executionCore: {
      ...catalogDetails?.executionCore,
      ...emittedDetails?.executionCore,
    },
    memory: {
      ...catalogDetails?.memory,
      ...emittedDetails?.memory,
    },
    topology: {
      ...catalogDetails?.topology,
      ...emittedDetails?.topology,
    },
  };
}

function attachHardwareProfile(result, config) {
  if (!result || typeof result !== 'object') return result;
  const catalogProfile = getHardwareProfile(config);
  if (!catalogProfile) return result;

  const emittedProfile = result.profile || {};
  result.profile = {
    ...emittedProfile,
    ...catalogProfile,
    details: mergeHardwareProfileDetails(catalogProfile.details, emittedProfile.details),
  };
  return result;
}

function attachResultProvenance(result, options) {
  if (!result || typeof result !== 'object') return result;
  attachHardwareProfile(result, options.config);
  result.provenance = resultProvenance(options, result.provenance || {});
  return result;
}

function aggregateProvenance(existing = {}, next) {
  return {
    ...existing,
    ...next,
    source: existing.source || next.source,
    toolchain: existing.toolchain || next.toolchain,
    fidelity: {
      ...existing.fidelity,
      ...next.fidelity,
    },
    caveats: uniqueCaveats([...(existing.caveats || []), ...(next.caveats || [])]),
  };
}

const RATE_LIMITED_HTTP_ROUTES = [
  { method: 'POST', pattern: /^\/compile$/ },
  { method: 'POST', pattern: /^\/compare$/ },
  { method: 'POST', pattern: /^\/experiment$/ },
  { method: 'POST', pattern: /^\/shorten$/ },
  { method: 'POST', pattern: /^\/api\/share$/ },
  { method: 'GET', pattern: /^\/api\/workloads\/verify$/ },
];

function isRateLimitedHttpRequest(req) {
  return RATE_LIMITED_HTTP_ROUTES.some(route =>
    route.method === req.method && route.pattern.test(req.path)
  );
}

function isExecutionHttpRequest(req) {
  return (
    (req.method === 'POST' && ['/compile', '/compare', '/experiment'].includes(req.path))
    || (req.method === 'GET' && req.path === '/api/workloads/verify')
  );
}

function httpError(status, message, type = 'validation_error') {
  const error = new Error(message);
  error.statusCode = status;
  error.type = type;
  return error;
}

function isStructuredVariant(variant) {
  return variant && typeof variant === 'object' && !Array.isArray(variant);
}

function normalizeStructuredVariant(variant) {
  const id = String(variant.id || variant.name || '').trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
    throw httpError(400, `Invalid variant id: ${id || '(empty)'}`);
  }

  const defines = Array.isArray(variant.defines)
    ? variant.defines.map(item => String(item).trim()).filter(Boolean)
    : [];
  for (const define of defines) {
    if (!/^[A-Za-z0-9_=,.-]+$/.test(define)) {
      throw httpError(400, `Invalid define for variant ${id}: ${define}`);
    }
  }

  const language = variant.language || undefined;
  if (language && language !== 'c' && language !== 'cpp') {
    throw httpError(422, 'Hardware experiment endpoint currently supports C and C++ inputs', 'unsupported');
  }

  const files = Array.isArray(variant.files) ? variant.files : undefined;
  if (files && files.length === 0) {
    throw httpError(400, `Variant ${id} files cannot be empty`);
  }
  if (files && files.length > 1) {
    throw httpError(422, 'Hardware experiment endpoint currently supports single-file C/C++ inputs', 'unsupported');
  }

  return {
    id,
    spec: defines.length > 0 ? `${id}:${defines.join(',')}` : id,
    defines,
    code: typeof variant.code === 'string' ? variant.code : undefined,
    files,
    language,
    optLevel: typeof variant.optLevel === 'string' ? variant.optLevel : undefined,
    prefetch: typeof variant.prefetch === 'string' ? variant.prefetch : undefined,
    limit: typeof variant.limit === 'number' ? variant.limit : undefined,
  };
}

function estimatedCyclesFromExperimentRow(row, result, config) {
  const value = row?.estimatedCycles;
  if (typeof value === 'number' && value > 0) return value;
  const fallback = result?.configs?.[config]?.timing?.totalCycles;
  return typeof fallback === 'number' ? fallback : 0;
}

function topSourceFromExperimentRow(row) {
  const topSource = row?.topSource;
  if (!topSource || typeof topSource !== 'object') return undefined;
  if (!topSource.file || !topSource.line) return undefined;
  return {
    file: topSource.file,
    line: topSource.line,
    subsystem: topSource.subsystem,
  };
}

function createCacheExploreStderrTransformer(ws, progressState) {
  let pending = '';

  return (chunk) => {
    const lines = `${pending}${chunk}`.split('\n');
    pending = lines.pop() ?? '';
    let stderr = '';

    for (const line of lines) {
      if (line.startsWith('{"type":"progress"')) {
        if (ws.readyState !== ws.OPEN) continue;
        try {
          const progress = JSON.parse(line);
          progressState.partialProgress = {
            eventsProcessed: progress.eventsProcessed,
            eventsTotal: progress.eventsTotal,
          };
          ws.send(JSON.stringify({
            type: 'progress',
            eventsProcessed: progress.eventsProcessed,
            eventsTotal: progress.eventsTotal,
          }));
        } catch {
          // Ignore malformed progress records.
        }
      } else if (line.startsWith('[') && (line.includes('Compiling') || line.includes('Running') || line.includes('Simulating'))) {
        if (ws.readyState !== ws.OPEN) continue;
        if (line.includes('Compiling')) {
          ws.send(JSON.stringify({ type: 'status', stage: 'compiling', message: line }));
        } else if (line.includes('Running')) {
          ws.send(JSON.stringify({ type: 'status', stage: 'running' }));
        } else if (line.includes('Simulating')) {
          ws.send(JSON.stringify({ type: 'status', stage: 'processing' }));
        }
      } else if (line.trim()) {
        stderr += `${line}\n`;
      }
    }

    return stderr;
  };
}

// Start periodic cleanup
setInterval(() => {
  cleanupOrphanedTempDirs({ maxAgeMs: CONFIG.cleanup.tempDirMaxAgeMs });
}, CONFIG.cleanup.orphanCheckIntervalMs);

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = dirname(__dirname);
const CACHE_EXPLORE = join(BACKEND_DIR, 'scripts', 'cache-explore');

let deploymentSecurity = null;
let sandboxConfigured = false;
let sandboxAvailable = false;

async function initializeExecutionMode() {
  deploymentSecurity = deploymentSecurityFromEnv();
  const bindError = validateDirectBind({
    deploymentMode: deploymentSecurity.deploymentMode,
    host: CONFIG.server.host,
    allowNonLoopbackDirect: CONFIG.server.allowNonLoopbackDirect,
  });
  if (bindError) throw new Error(bindError);
  sandboxConfigured = deploymentSecurity.sandboxRequested;

  if (!sandboxConfigured) {
    console.log('Docker sandbox: DISABLED (local mode only)');
    return;
  }

  sandboxAvailable = await checkSandboxAvailable();
  if (sandboxAvailable) {
    console.log('Docker sandbox: ENABLED (secure mode)');
    return;
  }

  if (deploymentSecurity.deploymentMode === 'hosted') {
    throw new Error('Hosted mode requires the cache-explorer-sandbox:latest image and a working Docker daemon.');
  }
  console.log('Docker sandbox: UNAVAILABLE (continuing in local direct mode)');
}

function sandboxStatusSnapshot() {
  return {
    configured: sandboxConfigured,
    available: sandboxAvailable,
    mode: sandboxAvailable ? 'sandbox' : 'direct',
    publicMode: deploymentSecurity.deploymentMode,
    runner: sandboxAvailable ? 'docker' : 'direct',
    message: sandboxAvailable
      ? 'Docker sandbox is enabled and available.'
      : sandboxConfigured
        ? 'Docker sandbox was requested but is unavailable.'
        : 'Docker sandbox is disabled; direct execution is supported only for trusted local use.',
  };
}

// Error handling imported from ./services/errorParser.js

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
if (CONFIG.server.trustProxy) {
  app.set('trust proxy', 1);
}
const clientOriginAllowed = origin => isAllowedClientOrigin(
  origin,
  CONFIG.server.allowedOrigins,
  deploymentSecurity?.deploymentMode !== 'hosted',
);
app.use((req, res, next) => {
  if (!clientOriginAllowed(req.headers.origin)) {
    res.status(403).json({ type: 'forbidden_origin', message: 'Browser origin is not allowed' });
    return;
  }
  next();
});
app.use(cors({
  origin(origin, callback) {
    callback(null, clientOriginAllowed(origin));
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use(createHttpRateLimitMiddleware({ shouldLimit: isRateLimitedHttpRequest }));
app.use(createHttpExecutionLimitMiddleware({ shouldLimit: isExecutionHttpRequest }));

const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: CONFIG.memory.maxWebSocketPayload,
  verifyClient: ({ origin }) => clientOriginAllowed(origin),
});

// ============================================================================
// HTTP Endpoints
// ============================================================================

app.get('/profiles', (req, res) => {
  incCounter('requests', { type: 'profiles' });
  res.json({ profiles: listHardwareProfiles() });
});

app.get('/profiles/:id', (req, res) => {
  incCounter('requests', { type: 'profiles' });
  const profile = getHardwareProfile(req.params.id);
  if (!profile) {
    return res.status(404).json({
      type: 'not_found',
      message: `Unknown hardware profile: ${req.params.id}`,
    });
  }
  res.json(profile);
});

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
    cacheSegments,
    timeout: requestedTimeout
  } = req.body;

  // Support both single code string and files array
  const inputFiles = files || (code ? code : null);
  if (!inputFiles) {
    return res.status(400).json({ error: 'No code provided', type: 'validation_error' });
  }

  // Apply sensible defaults for web UI to prevent timeouts
  // 100K events = ~1 second runtime, good balance for web UI responsiveness
  const eventLimit = limit !== undefined ? limit : 1000000;
  const sampleRate = sample !== undefined ? sample : 1;       // No sampling by default
  const fastMode = fast === true;                             // Fast mode disables 3C classification
  const segmentCaching = cacheSegments === true;              // Segment caching for repeated loops

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
    segmentCaching,
    customConfig: req.body.customConfig || null,
    compiler: req.body.compiler || null,
    executor: sandboxAvailable ? 'sandbox' : 'direct',
  };

  try {
    const cached = getCachedResult(cacheInputs);
    if (cached) {
      incCounter('cache_hits');
      recordDuration('compilation_duration', (Date.now() - startTime) / 1000);
      return res.json(attachResultProvenance(cached, {
        config,
        sampleRate,
        eventLimit,
        fastMode,
        segmentCaching,
        prefetch: req.body.prefetch || 'none',
        sandbox: sandboxAvailable,
        cached: true,
      }));
    }
  } catch (err) {
    // Cache miss or error, continue with compilation
  }
  incCounter('cache_misses');

  // Configurable timeout with bounds
  const timeout = normalizeRequestTimeout(requestedTimeout);

  // Use Docker sandbox if available (production), otherwise direct execution (development)
  if (sandboxAvailable) {
    req.markExecutionStarted();
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
        fastMode,
        customConfig: req.body.customConfig,
        defines: req.body.defines || [],
        timeout,
        signal: req.executionSignal,
      });

      const output = result.stdout.trim();
      try {
        const json = JSON.parse(output);

        stripCacheState(json);
        attachResultProvenance(json, {
          config,
          sampleRate,
          eventLimit,
          fastMode,
          segmentCaching,
          prefetch: req.body.prefetch || 'none',
          sandbox: true,
        });

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
    } finally {
      req.finishExecution();
    }
    return;
  }

  // Fallback: Direct execution (development mode only)
  // WARNING: This executes untrusted code without sandboxing
  let tempDir, mainFile;

  req.markExecutionStarted();
  try {
    const project = await createTempProject(inputFiles, language);
    tempDir = project.tempDir;
    mainFile = project.mainFile;

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
    // Add segment caching flag (caches repeated loop segments for speedup)
    if (segmentCaching) {
      args.push('--cache-segments');
    }

    const result = await runProcess(CACHE_EXPLORE, args, {
      timeout,
      maxOutputBuffer: CONFIG.memory.maxOutputBuffer,
      mainFile,
      signal: req.executionSignal,
    });

    const output = result.stdout.trim();

    try {
      const json = JSON.parse(output);

      stripCacheState(json);
      attachResultProvenance(json, {
        config,
        sampleRate,
        eventLimit,
        fastMode,
        segmentCaching,
        prefetch: req.body.prefetch || 'none',
        sandbox: false,
      });

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
    try {
      if (tempDir) {
        await cleanupTempProject(tempDir);
      }
    } finally {
      req.finishExecution();
    }
  }
});

app.post('/compare', async (req, res) => {
  const startTime = Date.now();
  incCounter('requests', { type: 'compare' });

  if (sandboxAvailable) {
    return res.status(501).json({
      type: 'unsupported',
      message: 'Hardware comparison endpoint is not available in sandbox mode'
    });
  }

  const {
    code,
    files,
    configs = ['educational', 'intel', 'amd', 'apple'],
    optLevel = '-O0',
    language = 'c',
    defines,
    prefetch,
    sample,
    limit,
    fast,
    cacheSegments,
    timeout: requestedTimeout
  } = req.body;

  const inputFiles = files || (code ? code : null);
  if (!inputFiles) {
    return res.status(400).json({ error: 'No code provided', type: 'validation_error' });
  }

  if (Array.isArray(inputFiles) && inputFiles.length > 1) {
    return res.status(422).json({
      type: 'unsupported',
      message: 'Hardware comparison endpoint currently supports single-file C/C++ inputs'
    });
  }

  if (language !== 'c' && language !== 'cpp') {
    return res.status(422).json({
      type: 'unsupported',
      message: 'Hardware comparison endpoint currently supports C and C++ inputs'
    });
  }

  const configIds = parseConfigList(configs, listHardwareProfiles().map(profile => profile.id));
  if (!configIds) {
    return res.status(400).json({ error: 'Invalid config list', type: 'validation_error' });
  }
  const configList = configIds.join(',');
  const comparePlanError = validateWorkPlan({ configs: configIds.length });
  if (comparePlanError) {
    return res.status(400).json({ error: comparePlanError, type: 'validation_error' });
  }

  const eventLimit = limit !== undefined ? limit : 1000000;
  const sampleRate = sample !== undefined ? sample : 1;
  const fastMode = fast === true;
  const segmentCaching = cacheSegments === true;
  const timeout = normalizeRequestTimeout(requestedTimeout);

  let tempDir, mainFile;

  req.markExecutionStarted();
  try {
    const project = await createTempProject(inputFiles, language);
    tempDir = project.tempDir;
    mainFile = project.mainFile;

    const args = ['compare', mainFile, '--configs', configList, optLevel, '--json'];

    if (defines && Array.isArray(defines)) {
      for (const def of defines) {
        if (def.name && def.name.trim()) {
          const defineStr = def.value ? `${def.name}=${def.value}` : def.name;
          args.push('-D', defineStr);
        }
      }
    }

    const VALID_PREFETCH_POLICIES = ['none', 'next', 'next-line', 'stream', 'stride', 'adaptive', 'intel'];
    const prefetchToUse = prefetch && VALID_PREFETCH_POLICIES.includes(prefetch) ? prefetch : 'none';
    args.push('--prefetch', prefetchToUse);

    if (sampleRate > 1) {
      args.push('--sample', String(sampleRate));
    }
    if (eventLimit > 0) {
      args.push('--limit', String(eventLimit));
    }
    if (fastMode) {
      args.push('--fast');
    }
    if (segmentCaching) {
      args.push('--cache-segments');
    }
    if (req.body.compiler) {
      const compiler = getCompiler(req.body.compiler);
      if (compiler && compiler.path) {
        args.push('--compiler', compiler.path);
      }
    }

    const result = await runProcess(CACHE_EXPLORE, args, {
      timeout,
      maxOutputBuffer: CONFIG.memory.maxOutputBuffer,
      mainFile,
      signal: req.executionSignal,
    });

    const json = JSON.parse(result.stdout.trim());
    if (json.configs && typeof json.configs === 'object') {
      for (const [configName, configResult] of Object.entries(json.configs)) {
        stripCacheState(configResult);
        attachResultProvenance(configResult, {
          config: configName,
          sampleRate,
          eventLimit,
          fastMode,
          segmentCaching,
          prefetch: prefetch || 'none',
          sandbox: false,
        });
      }
    }
    json.provenance = aggregateProvenance(json.provenance, {
      resultKind: 'hardware-comparison',
      executor: 'direct-dev',
      configs: Object.keys(json.configs || {}),
      fidelity: {
        trace: sampleRate > 1 ? 'sampled' : 'full',
        sampleRate,
        eventLimit,
        fastMode,
        cacheSegments: segmentCaching,
        prefetch: prefetch || 'none',
      },
      caveats: ['Each profile replays the same traced program through simulator models.'],
    });

    recordDuration('compilation_duration', (Date.now() - startTime) / 1000);
    res.json(json);
  } catch (err) {
    incCounter('errors', { type: 'compare' });
    console.error('HTTP compare error:', err);
    const parsed = createErrorResponse(err, mainFile);
    res.status(400).json(parsed);
  } finally {
    try {
      if (tempDir) {
        await cleanupTempProject(tempDir);
      }
    } finally {
      req.finishExecution();
    }
  }
});

app.post('/experiment', async (req, res) => {
  const startTime = Date.now();
  incCounter('requests', { type: 'experiment' });

  if (sandboxAvailable) {
    return res.status(501).json({
      type: 'unsupported',
      message: 'Hardware experiment endpoint is not available in sandbox mode'
    });
  }

  const {
    code,
    files,
    variants = ['baseline'],
    configs = ['educational', 'intel14', 'amd', 'apple'],
    optLevel = '-O0',
    language = 'c',
    defines,
    prefetch,
    sample,
    limit,
    fast,
    cacheSegments,
    timeout: requestedTimeout
  } = req.body;

  const rawVariantList = Array.isArray(variants) ? variants : [variants];
  const structuredVariantMode = rawVariantList.some(isStructuredVariant);
  const inputFiles = files || (code ? code : null);
  if (!inputFiles && !structuredVariantMode) {
    return res.status(400).json({ error: 'No code provided', type: 'validation_error' });
  }

  if (inputFiles && Array.isArray(inputFiles) && inputFiles.length > 1) {
    return res.status(422).json({
      type: 'unsupported',
      message: 'Hardware experiment endpoint currently supports single-file C/C++ inputs'
    });
  }

  if (language !== 'c' && language !== 'cpp') {
    return res.status(422).json({
      type: 'unsupported',
      message: 'Hardware experiment endpoint currently supports C and C++ inputs'
    });
  }

  const variantList = rawVariantList;
  if (variantList.length === 0) {
    return res.status(400).json({ error: 'At least one variant is required', type: 'validation_error' });
  }

  if (!structuredVariantMode) {
    for (const variant of variantList) {
      if (typeof variant !== 'string' || !/^[A-Za-z0-9_.-]+(?::[A-Za-z0-9_=,.-]+)?$/.test(variant)) {
        return res.status(400).json({ error: `Invalid variant spec: ${variant}`, type: 'validation_error' });
      }
    }
  } else if (!variantList.every(isStructuredVariant)) {
    return res.status(400).json({
      error: 'Structured experiment variants cannot be mixed with string variants',
      type: 'validation_error'
    });
  } else {
    try {
      variantList.forEach(normalizeStructuredVariant);
    } catch (err) {
      const status = err.statusCode || 400;
      return res.status(status).json({
        error: err.message,
        type: err.type || 'validation_error',
      });
    }
    if (!inputFiles && variantList.some(variant => !variant.code && !variant.files)) {
      return res.status(400).json({
        error: 'Structured experiment variants need source code, files, or a top-level source fallback',
        type: 'validation_error',
      });
    }
  }

  const configIds = parseConfigList(configs, listHardwareProfiles().map(profile => profile.id));
  if (!configIds) {
    return res.status(400).json({ error: 'Invalid config list', type: 'validation_error' });
  }
  const configList = configIds.join(',');
  const experimentPlanError = validateWorkPlan({
    configs: configIds.length,
    variants: variantList.length,
  });
  if (experimentPlanError) {
    return res.status(400).json({ error: experimentPlanError, type: 'validation_error' });
  }

  const eventLimit = limit !== undefined ? limit : 1000000;
  const sampleRate = sample !== undefined ? sample : 1;
  const fastMode = fast === true;
  const segmentCaching = cacheSegments === true;
  const timeout = normalizeRequestTimeout(requestedTimeout);

  let tempDir, mainFile;
  const tempDirs = [];

  req.markExecutionStarted();
  try {
    if (structuredVariantMode) {
      const structuredVariants = variantList.map(normalizeStructuredVariant);
      const experimentVariants = {};
      const flatSummary = [];
      const baselineCycles = new Map();
      const baselineVariant = structuredVariants[0]?.id;

      for (const [index, variant] of structuredVariants.entries()) {
        const variantInputFiles = variant.files || (variant.code ? variant.code : inputFiles);
        if (!variantInputFiles) {
          throw httpError(400, `No source provided for variant ${variant.id}`);
        }

        const project = await createTempProject(variantInputFiles, variant.language || language);
        tempDirs.push(project.tempDir);
        const variantMainFile = project.mainFile;
        const variantOptLevel = variant.optLevel || optLevel;
        const args = ['compare', variantMainFile, '--configs', configList, variantOptLevel, '--json'];

        if (defines && Array.isArray(defines)) {
          for (const def of defines) {
            if (def.name && def.name.trim()) {
              const defineStr = def.value ? `${def.name}=${def.value}` : def.name;
              args.push('-D', defineStr);
            }
          }
        }
        for (const define of variant.defines) {
          args.push('-D', define);
        }

        const VALID_PREFETCH_POLICIES = ['none', 'next', 'next-line', 'stream', 'stride', 'adaptive', 'intel'];
        const variantPrefetch = variant.prefetch || prefetch;
        const prefetchToUse = variantPrefetch && VALID_PREFETCH_POLICIES.includes(variantPrefetch) ? variantPrefetch : 'none';
        args.push('--prefetch', prefetchToUse);

        if (sampleRate > 1) {
          args.push('--sample', String(sampleRate));
        }
        const variantEventLimit = variant.limit ?? eventLimit;
        if (variantEventLimit > 0) {
          args.push('--limit', String(variantEventLimit));
        }
        if (fastMode) {
          args.push('--fast');
        }
        if (segmentCaching) {
          args.push('--cache-segments');
        }
        if (req.body.compiler) {
          const compiler = getCompiler(req.body.compiler);
          if (compiler && compiler.path) {
            args.push('--compiler', compiler.path);
          }
        }

        const result = await runProcess(CACHE_EXPLORE, args, {
          timeout,
          maxOutputBuffer: CONFIG.memory.maxOutputBuffer,
          mainFile: variantMainFile,
          signal: req.executionSignal,
        });

        const json = JSON.parse(result.stdout.trim());
        const configsByName = json.configs;
        if (configsByName && typeof configsByName === 'object') {
          for (const configResult of Object.values(configsByName)) {
            stripCacheState(configResult);
          }
          for (const [configName, configResult] of Object.entries(configsByName)) {
            attachResultProvenance(configResult, {
              config: configName,
              sampleRate,
              eventLimit: variantEventLimit,
              fastMode,
              segmentCaching,
              prefetch: prefetchToUse,
              sandbox: false,
            });
          }
        }

        experimentVariants[variant.id] = json;
        for (const row of json.summary || []) {
          const configName = row.config;
          const cycles = estimatedCyclesFromExperimentRow(row, json, configName);
          if (index === 0) {
            baselineCycles.set(configName, cycles);
          }
          const base = baselineCycles.get(configName);
          const cycleDelta = typeof cycles === 'number' && typeof base === 'number' ? cycles - base : null;
          const cycleDeltaPercent = cycleDelta !== null && base ? cycleDelta / base : null;

          flatSummary.push({
            variant: variant.id,
            variantSpec: variant.spec,
            config: configName,
            profile: row.profile,
            primaryBottleneck: row.primaryBottleneck,
            estimatedCycles: cycles,
            cycleDelta,
            cycleDeltaPercent,
            confidence: row.confidence,
            bottleneckShare: row.bottleneckShare,
            topSource: topSourceFromExperimentRow(row),
            hitRates: row.hitRates,
            events: row.events,
          });
        }
      }

      const json = {
        source: 'variant-sources',
        baselineVariant,
        summary: flatSummary,
        variants: experimentVariants,
      };
      json.provenance = aggregateProvenance({}, {
        resultKind: 'hardware-experiment',
        executor: 'direct-dev',
        configs: configIds,
        variants: structuredVariants.map(variant => variant.spec),
        fidelity: {
          trace: sampleRate > 1 ? 'sampled' : 'full',
          sampleRate,
          eventLimit,
          fastMode,
          cacheSegments: segmentCaching,
          prefetch: prefetch || 'none',
        },
        caveats: ['Variant deltas compare simulator estimates relative to the first variant for each hardware profile.'],
      });

      recordDuration('compilation_duration', (Date.now() - startTime) / 1000);
      res.json(json);
      return;
    }

    const project = await createTempProject(inputFiles, language);
    tempDir = project.tempDir;
    mainFile = project.mainFile;

    const args = ['experiment', mainFile, '--configs', configList, optLevel, '--json'];

    for (const variant of variantList) {
      args.push('--variant', variant);
    }

    if (defines && Array.isArray(defines)) {
      for (const def of defines) {
        if (def.name && def.name.trim()) {
          const defineStr = def.value ? `${def.name}=${def.value}` : def.name;
          args.push('-D', defineStr);
        }
      }
    }

    const VALID_PREFETCH_POLICIES = ['none', 'next', 'next-line', 'stream', 'stride', 'adaptive', 'intel'];
    const prefetchToUse = prefetch && VALID_PREFETCH_POLICIES.includes(prefetch) ? prefetch : 'none';
    args.push('--prefetch', prefetchToUse);

    if (sampleRate > 1) {
      args.push('--sample', String(sampleRate));
    }
    if (eventLimit > 0) {
      args.push('--limit', String(eventLimit));
    }
    if (fastMode) {
      args.push('--fast');
    }
    if (segmentCaching) {
      args.push('--cache-segments');
    }
    if (req.body.compiler) {
      const compiler = getCompiler(req.body.compiler);
      if (compiler && compiler.path) {
        args.push('--compiler', compiler.path);
      }
    }

    const result = await runProcess(CACHE_EXPLORE, args, {
      timeout,
      maxOutputBuffer: CONFIG.memory.maxOutputBuffer,
      mainFile,
      signal: req.executionSignal,
    });

    const json = JSON.parse(result.stdout.trim());
    if (json.variants && typeof json.variants === 'object') {
      for (const variantResult of Object.values(json.variants)) {
        const configsByName = variantResult?.configs;
        if (!configsByName || typeof configsByName !== 'object') continue;

        for (const configResult of Object.values(configsByName)) {
          stripCacheState(configResult);
        }
        for (const [configName, configResult] of Object.entries(configsByName)) {
          attachResultProvenance(configResult, {
            config: configName,
            sampleRate,
            eventLimit,
            fastMode,
            segmentCaching,
            prefetch: prefetch || 'none',
            sandbox: false,
          });
        }
      }
    }
    json.provenance = aggregateProvenance(json.provenance, {
      resultKind: 'hardware-experiment',
      executor: 'direct-dev',
      configs: configIds,
      variants: variantList,
      fidelity: {
        trace: sampleRate > 1 ? 'sampled' : 'full',
        sampleRate,
        eventLimit,
        fastMode,
        cacheSegments: segmentCaching,
        prefetch: prefetch || 'none',
      },
      caveats: ['Variant deltas compare simulator estimates relative to the first variant for each hardware profile.'],
    });

    recordDuration('compilation_duration', (Date.now() - startTime) / 1000);
    res.json(json);
  } catch (err) {
    incCounter('errors', { type: 'experiment' });
    console.error('HTTP experiment error:', err);
    const parsed = createErrorResponse(err, mainFile);
    res.status(err.statusCode || 400).json({
      ...parsed,
      type: err.type || parsed.type,
    });
  } finally {
    try {
      if (tempDir) {
        await cleanupTempProject(tempDir);
      }
      for (const dir of tempDirs) {
        await cleanupTempProject(dir);
      }
    } finally {
      req.finishExecution();
    }
  }
});

app.get('/health', (req, res) => {
  const health = getHealthStatus();
  const sandboxStatus = sandboxStatusSnapshot();
  res.json({
    ...health,
    sandbox: sandboxStatus.available ? 'enabled' : 'disabled',
    mode: sandboxStatus.publicMode,
    sandboxStatus,
    config: {
      timeouts: CONFIG.timeouts,
      rateLimit: CONFIG.rateLimit
    }
  });
});

app.get('/sandbox-status', (req, res) => {
  res.json(sandboxStatusSnapshot());
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

app.get('/api/workloads', async (req, res) => {
  incCounter('requests', { type: 'workloads' });
  try {
    const args = ['workloads', '--json'];
    if (req.query.includeStress === '1' || req.query.includeStress === 'true') {
      args.push('--include-stress');
    }
    const result = await runProcess(CACHE_EXPLORE, args, {
      timeout: CONFIG.timeouts.compilation,
      maxOutputBuffer: CONFIG.memory.maxOutputBuffer,
    });
    res.json(JSON.parse(result.stdout.trim()));
  } catch (err) {
    console.error('Failed to list workloads:', err);
    incCounter('errors', { type: 'workloads' });
    res.status(500).json(workloadProcessErrorResponse(err, 'Failed to list workloads'));
  }
});

app.get('/api/workloads/history', async (req, res) => {
  incCounter('requests', { type: 'workloads_history' });

  try {
    res.json(await loadWorkloadHistory({
      summaryPath: CONFIG.workloads.historySummaryPath,
      dashboardBaseUrl: CONFIG.workloads.dashboardBaseUrl,
      timeoutMs: CONFIG.workloads.historyFetchTimeoutMs,
    }));
  } catch (err) {
    console.error('Failed to load workload history:', err);
    incCounter('errors', { type: 'workloads_history' });
    res.status(502).json({
      error: 'Failed to load workload history',
      message: err instanceof Error ? err.message : 'Failed to load workload history',
      type: err?.name === 'AbortError' ? 'timeout' : 'workload_history_error',
      timeout: err?.name === 'AbortError' || undefined,
    });
  }
});

app.get('/api/workloads/verify', async (req, res) => {
  incCounter('requests', { type: 'workloads_verify' });
  req.markExecutionStarted();
  try {
    const args = ['workloads', '--verify', '--json'];
    const requestedVariantTimeoutMs = Number.parseInt(req.query.variantTimeoutMs, 10);
    const variantTimeoutMs = Number.isFinite(requestedVariantTimeoutMs) && requestedVariantTimeoutMs >= 0
      ? Math.min(requestedVariantTimeoutMs, CONFIG.timeouts.max)
      : CONFIG.workloads.variantTimeoutMs;
    args.push('--variant-timeout-ms', String(variantTimeoutMs));
    if (req.query.includeStress === '1' || req.query.includeStress === 'true') {
      args.push('--include-stress');
    }
    const result = await runProcess(CACHE_EXPLORE, args, {
      timeout: CONFIG.timeouts.max,
      maxOutputBuffer: CONFIG.memory.maxOutputBuffer,
      signal: req.executionSignal,
    });
    res.json(JSON.parse(result.stdout.trim()));
  } catch (err) {
    console.error('Failed to verify workloads:', err);
    incCounter('errors', { type: 'workloads_verify' });
    res.status(500).json(workloadProcessErrorResponse(err, 'Failed to verify workloads'));
  } finally {
    req.finishExecution();
  }
});

// ============================================================================
// Link Shortener (SQLite-backed)
// ============================================================================

function dbUnavailableResponse(res) {
  return res.status(503).json({
    error: 'Persistence unavailable',
    message: 'Database-backed sharing is unavailable in this server process'
  });
}

function logShareError(action, err) {
  if (err.code === 'DB_UNAVAILABLE') {
    console.warn(`${action}: database unavailable`);
    return;
  }

  console.error(`${action}:`, err);
}

// Create short link
app.post('/shorten', (req, res) => {
  incCounter('requests', { type: 'share' });
  const { state } = req.body;
  if (!state) {
    return res.status(400).json({ error: 'No state provided' });
  }
  const payloadError = validateSharePayload(state);
  if (payloadError) {
    return res.status(413).json({ error: payloadError, type: 'payload_too_large' });
  }

  try {
    const code = createShortUrl(state);
    pruneShortUrls(
      CONFIG.persistence.maxShareEntries,
      CONFIG.persistence.shareMaxAgeDays,
      CONFIG.persistence.maxShareTotalBytes,
    );
    res.json({ id: code, url: `/s/${code}` });
  } catch (err) {
    logShareError('Failed to create short URL', err);
    incCounter('errors', { type: 'share' });
    if (err.code === 'DB_UNAVAILABLE') {
      return dbUnavailableResponse(res);
    }
    res.status(500).json({ error: 'Failed to create short URL' });
  }
});

// Retrieve short link
app.get('/s/:id', (req, res) => {
  const { id } = req.params;

  try {
    const data = getShortUrl(id, CONFIG.persistence.shareMaxAgeDays);
    if (!data) {
      return res.status(404).json({ error: 'Link not found' });
    }
    res.json({ state: data });
  } catch (err) {
    logShareError('Failed to retrieve short URL', err);
    if (err.code === 'DB_UNAVAILABLE') {
      return dbUnavailableResponse(res);
    }
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
  const payloadError = validateSharePayload(data);
  if (payloadError) {
    return res.status(413).json({ error: payloadError, type: 'payload_too_large' });
  }

  try {
    const code = createShortUrl(data);
    pruneShortUrls(
      CONFIG.persistence.maxShareEntries,
      CONFIG.persistence.shareMaxAgeDays,
      CONFIG.persistence.maxShareTotalBytes,
    );
    res.json({ code, url: `/s/${code}` });
  } catch (err) {
    logShareError('Failed to create short URL', err);
    incCounter('errors', { type: 'share' });
    if (err.code === 'DB_UNAVAILABLE') {
      return dbUnavailableResponse(res);
    }
    res.status(500).json({ error: 'Failed to create short URL' });
  }
});

app.get('/api/s/:code', (req, res) => {
  const { code } = req.params;

  try {
    const data = getShortUrl(code, CONFIG.persistence.shareMaxAgeDays);
    if (!data) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ data });
  } catch (err) {
    logShareError('Failed to retrieve short URL', err);
    if (err.code === 'DB_UNAVAILABLE') {
      return dbUnavailableResponse(res);
    }
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
  if (wss.clients.size > CONFIG.rateLimit.maxWebSocketConnections) {
    ws.close(1013, 'Server connection capacity reached');
    return;
  }
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

    const releaseExecution = reserveGlobalExecution();
    if (!releaseExecution) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Analysis capacity is full',
        suggestion: 'Retry shortly'
      }));
      return;
    }

    try {

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
      cacheSegments,
      timeout: requestedTimeout
    } = data;

    // Support both single code string and files array
    const inputFiles = files || (code ? code : null);
    if (!inputFiles) {
      ws.send(JSON.stringify({ type: 'error', error: 'No code provided' }));
      return;
    }

    // Apply sensible defaults for web UI to prevent timeouts
    const eventLimit = limit !== undefined ? limit : 1000000;  // Match HTTP default for responsive web UI
    const sampleRate = sample !== undefined ? sample : 1;       // No sampling by default
    const fastMode = fast === true;                             // Fast mode disables 3C classification
    const segmentCaching = cacheSegments === true;              // Segment caching for repeated loops

    // Configurable timeout with bounds
    const timeout = normalizeRequestTimeout(requestedTimeout);

    // Use Docker sandbox if available
    if (sandboxAvailable) {
      const sandboxController = new AbortController();
      const removeSandboxController = tracker.addAbortController(sandboxController);
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
          signal: sandboxController.signal,
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
            stripCacheState(json);
            attachResultProvenance(json, {
              config,
              sampleRate,
              eventLimit,
              fastMode,
              segmentCaching,
              prefetch: prefetch || 'none',
              sandbox: true,
            });
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
      } finally {
        removeSandboxController();
      }
      return;
    }

    // Fallback: Direct execution (development mode) with real-time streaming
    let tempDir, mainFile;
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

      // Use batch mode with --json; progress comes via stderr
      const args = [mainFile, '--config', config, optLevel, '--json'];

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
      // Add segment caching flag (caches repeated loop segments for speedup)
      if (segmentCaching) {
        args.push('--cache-segments');
      }

      const progressState = { partialProgress: null };

      console.log(`[WebSocket] spawning: ${CACHE_EXPLORE} ${args.join(' ')}`);
      const processResult = await runManagedProcess(CACHE_EXPLORE, args, {
        timeout,
        maxOutputBuffer: CONFIG.memory.maxOutputBuffer,
        mainFile,
        gracefulKillDelayMs: 2000,
        rejectOnNonZero: false,
        onProcess: (child) => {
          cleanupFn = tracker.addProcess(child, tempDir);
          console.log(`[WebSocket] process spawned with PID ${child.pid}`);
        },
        onTimeout: () => {
          if (progressState.partialProgress && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'warning',
              message: 'Execution timeout - sending partial results',
              partialProgress: progressState.partialProgress,
            }));
          }
        },
        transformStderr: createCacheExploreStderrTransformer(ws, progressState),
      });

      if (cleanupFn) {
        cleanupFn();
        cleanupFn = null;
      }

      let finalResult = null;
      const output = processResult.stdout.trim();
      if (output) {
        try {
          const parsed = JSON.parse(output);
          if (parsed.error) {
            console.log(`[WebSocket] got error: ${parsed.error}`);
            if (ws.readyState === ws.OPEN) {
              let rawError = parsed.details || parsed.error;
              rawError = rawError.replace(/\/tmp\/cache-explorer-[a-f0-9-]+\//g, '');
              ws.send(JSON.stringify({ type: 'compile_error', raw: rawError }));
            }
            finalResult = parsed;
          } else {
            stripCacheState(parsed);
            attachResultProvenance(parsed, {
              config,
              sampleRate,
              eventLimit,
              fastMode,
              segmentCaching,
              prefetch: prefetch || 'none',
              sandbox: false,
            });
            finalResult = parsed;
          }
        } catch (err) {
          console.log(`[WebSocket] failed to parse stdout as JSON: ${err.message}`);
        }
      }

      const result = (() => {
        if (processResult.timeout) {
          throw {
            stdout: processResult.stdout,
            stderr: processResult.stderr,
            exitCode: processResult.exitCode,
            mainFile,
            timeout: true,
            timeoutMs: timeout,
            partialProgress: progressState.partialProgress,
          };
        }
        if (processResult.exitCode !== 0 && finalResult && finalResult.error) {
          return { data: finalResult, stderr: processResult.stderr };
        }
        if (processResult.exitCode !== 0) {
          throw {
            stdout: processResult.stdout,
            stderr: processResult.stderr,
            exitCode: processResult.exitCode,
            mainFile,
            partialProgress: progressState.partialProgress,
          };
        }
        return { data: finalResult, stderr: processResult.stderr };
      })();

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
      if (cleanupFn) {
        cleanupFn();
      }
      if (tempDir) {
        tracker.tempDirs.delete(tempDir);
        await cleanupTempProject(tempDir);
      }
    }
    } finally {
      releaseExecution();
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

async function startServer() {
  await initializeExecutionMode();

  try {
    initDb();
    pruneShortUrls(
      CONFIG.persistence.maxShareEntries,
      CONFIG.persistence.shareMaxAgeDays,
      CONFIG.persistence.maxShareTotalBytes,
    );
    startCachePruning();
    console.log('Database and cache initialized');
  } catch (err) {
    console.warn('Database initialization failed, running without persistence:', err.message);
  }

  server.listen(CONFIG.server.port, CONFIG.server.host, () => {
    console.log(`Hardware Explorer Preview server running on http://${CONFIG.server.host}:${CONFIG.server.port}`);
    console.log(`WebSocket available at ws://${CONFIG.server.host}:${CONFIG.server.port}/ws`);
    console.log(`Deployment: ${deploymentSecurity.deploymentMode}; timeout=${CONFIG.timeouts.default}ms (max ${CONFIG.timeouts.max}ms), rate=${CONFIG.rateLimit.maxRequestsPerMinute}/min`);
  });
}

startServer().catch(err => {
  console.error(`Server startup refused: ${err.message}`);
  process.exit(1);
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
