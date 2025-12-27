import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = dirname(__dirname);
const CACHE_EXPLORE = join(BACKEND_DIR, 'scripts', 'cache-explore');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Parse clang error output into structured format
function parseCompileErrors(stderr, tempFile) {
  const errors = [];
  const lines = stderr.split('\n');

  for (const line of lines) {
    // Match clang error format: file:line:col: error: message
    const match = line.match(/^[^:]+:(\d+):(\d+):\s*(error|warning):\s*(.+)$/);
    if (match) {
      errors.push({
        line: parseInt(match[1]),
        column: parseInt(match[2]),
        severity: match[3],
        message: match[4]
      });
    }
  }

  if (errors.length > 0) {
    return {
      type: 'compile_error',
      errors,
      summary: `${errors.filter(e => e.severity === 'error').length} error(s), ${errors.filter(e => e.severity === 'warning').length} warning(s)`
    };
  }

  // Check for linker errors
  if (stderr.includes('undefined reference') || stderr.includes('ld:')) {
    return {
      type: 'linker_error',
      message: 'Linker error - check for missing functions or libraries',
      raw: stderr.replace(new RegExp(tempFile, 'g'), 'input.c')
    };
  }

  // Check for runtime errors
  if (stderr.includes('Segmentation fault') || stderr.includes('SIGSEGV')) {
    return {
      type: 'runtime_error',
      message: 'Program crashed (segmentation fault)',
      raw: stderr
    };
  }

  if (stderr.includes('timeout')) {
    return {
      type: 'timeout',
      message: 'Program took too long to execute (possible infinite loop?)'
    };
  }

  // Generic error
  return {
    type: 'unknown_error',
    message: stderr.replace(new RegExp(tempFile, 'g'), 'input.c')
  };
}

app.post('/compile', async (req, res) => {
  const { code, config = 'educational', optLevel = '-O0', language = 'c' } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'No code provided', type: 'validation_error' });
  }

  // Determine file extension based on language
  const extensions = { c: '.c', cpp: '.cpp', rust: '.rs' };
  const ext = extensions[language] || '.c';
  const tempFile = `/tmp/cache-explorer-${randomUUID()}${ext}`;

  try {
    await writeFile(tempFile, code);

    const result = await new Promise((resolve, reject) => {
      const args = [tempFile, '--config', config, optLevel, '--json'];

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

      const proc = spawn(CACHE_EXPLORE, args);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (exitCode) => {
        if (exitCode !== 0) {
          reject({ stderr, exitCode, tempFile });
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
    if (err.stderr) {
      const parsed = parseCompileErrors(err.stderr, tempFile);
      res.status(400).json(parsed);
    } else {
      res.status(500).json({ error: err.message, type: 'server_error' });
    }
  } finally {
    unlink(tempFile).catch(() => {});
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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

    const { code, config = 'educational', optLevel = '-O0', customConfig, defines, language = 'c' } = data;

    if (!code) {
      ws.send(JSON.stringify({ type: 'error', error: 'No code provided' }));
      return;
    }

    // Determine file extension based on language
    const extensions = { c: '.c', cpp: '.cpp', rust: '.rs' };
    const ext = extensions[language] || '.c';
    const tempFile = `/tmp/cache-explorer-${randomUUID()}${ext}`;

    try {
      // Status: writing file
      ws.send(JSON.stringify({ type: 'status', stage: 'preparing' }));
      await writeFile(tempFile, code);

      // Status: compiling
      ws.send(JSON.stringify({ type: 'status', stage: 'compiling' }));

      const result = await new Promise((resolve, reject) => {
        const args = [tempFile, '--config', config, optLevel, '--json'];

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

        const proc = spawn(CACHE_EXPLORE, args);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (chunk) => {
          stdout += chunk;
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
            } else if (line.includes('Processing')) {
              ws.send(JSON.stringify({ type: 'status', stage: 'processing' }));
            }
          }
        });

        proc.on('close', (exitCode) => {
          if (exitCode !== 0) {
            reject({ stderr, exitCode, tempFile });
          } else {
            resolve({ stdout, stderr });
          }
        });

        proc.on('error', reject);
      });

      // Status: done
      ws.send(JSON.stringify({ type: 'status', stage: 'done' }));

      const output = result.stdout.trim();
      try {
        const json = JSON.parse(output);
        ws.send(JSON.stringify({ type: 'result', data: json }));
      } catch {
        ws.send(JSON.stringify({ type: 'result', data: { raw: output } }));
      }
    } catch (err) {
      if (err.stderr) {
        const parsed = parseCompileErrors(err.stderr, tempFile);
        ws.send(JSON.stringify({ type: 'error', ...parsed }));
      } else {
        ws.send(JSON.stringify({ type: 'error', error: err.message }));
      }
    } finally {
      unlink(tempFile).catch(() => {});
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
