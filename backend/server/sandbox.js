/**
 * Docker Sandbox Service
 *
 * Provides secure execution of user code inside Docker containers with:
 * - Resource limits (CPU, memory, time)
 * - Network isolation
 * - Filesystem isolation
 * - Seccomp system call filtering
 */

import { spawn } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCKER_DIR = join(dirname(__dirname), 'docker');
const SECCOMP_PROFILE = join(DOCKER_DIR, 'seccomp-profile.json');

// Sandbox configuration
const SANDBOX_CONFIG = {
  image: 'cache-explorer-sandbox:latest',
  // Resource limits
  memoryLimit: '256m',           // Max memory
  cpuQuota: 100000,              // 1 full CPU (100000/100000)
  pidLimit: 50,                  // Max processes
  timeout: 45000,                // Max execution time (ms) - compilation + execution + simulation
  // Security
  networkDisabled: true,
  readOnlyRoot: true,
  noNewPrivileges: true,
  dropCapabilities: ['ALL'],
};

/**
 * Check if Docker is available and the sandbox image exists
 */
export async function checkSandboxAvailable() {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['image', 'inspect', SANDBOX_CONFIG.image], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Run code in sandboxed Docker container
 *
 * @param {Object} options
 * @param {string} options.code - Source code to compile and run
 * @param {string} options.language - 'c' | 'cpp'
 * @param {string} options.config - Cache configuration name
 * @param {string} options.optLevel - Optimization level (-O0, -O2, etc)
 * @param {string} options.prefetch - Prefetch policy (none, stream, stride, etc)
 * @param {number} options.sampleRate - Sampling rate (1 = all events)
 * @param {number} options.eventLimit - Max events to process
 * @param {Object} options.customConfig - Custom cache parameters
 * @param {Array} options.defines - Preprocessor defines [{name, value}]
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export async function runInSandbox(options) {
  const {
    code,
    language = 'c',
    config = 'intel',
    optLevel = '-O0',
    prefetch = 'none',
    sampleRate = 1,
    eventLimit = 5000000,
    customConfig,
    defines = [],
    onProgress
  } = options;

  // Create temp directory for this execution
  const execId = randomUUID();
  const tempDir = `/tmp/cache-explorer-${execId}`;

  // Determine file extension
  const extensions = { c: 'c', cpp: 'cpp' };
  const ext = extensions[language] || 'c';
  const inputFile = join(tempDir, `input.${ext}`);

  try {
    // Create temp directory and write source file
    await mkdir(tempDir, { recursive: true });
    await writeFile(inputFile, code);

    if (onProgress) onProgress({ stage: 'preparing' });

    // Build docker run arguments
    const dockerArgs = [
      'run',
      '--rm',                                           // Remove container after execution
      '--network', 'none',                              // No network access
      '--memory', SANDBOX_CONFIG.memoryLimit,           // Memory limit
      `--cpu-quota=${SANDBOX_CONFIG.cpuQuota}`,         // CPU limit
      `--pids-limit=${SANDBOX_CONFIG.pidLimit}`,        // Process limit
      '--read-only',                                    // Read-only root filesystem
      '--tmpfs', '/tmp:rw,exec,size=64m,mode=1777',     // Writable /tmp with execute permission
      '--tmpfs', '/workspace:rw,size=64m,mode=1777',    // Writable workspace
      '--security-opt', 'no-new-privileges',            // No privilege escalation
      '--cap-drop', 'ALL',                              // Drop all capabilities
    ];

    // Add seccomp profile if it exists
    if (existsSync(SECCOMP_PROFILE)) {
      dockerArgs.push('--security-opt', `seccomp=${SECCOMP_PROFILE}`);
    }

    // Mount source file read-only
    dockerArgs.push('-v', `${inputFile}:/workspace/input.${ext}:ro`);

    // Add image name
    dockerArgs.push(SANDBOX_CONFIG.image);

    // Add run.sh positional arguments:
    // CODE_FILE, LANGUAGE, CONFIG, OPT_LEVEL, PREFETCH, SAMPLE_RATE, EVENT_LIMIT
    dockerArgs.push(`/workspace/input.${ext}`);  // CODE_FILE
    dockerArgs.push(language);                    // LANGUAGE
    dockerArgs.push(config);                      // CONFIG
    dockerArgs.push(optLevel);                    // OPT_LEVEL
    dockerArgs.push(prefetch);                    // PREFETCH
    dockerArgs.push(String(sampleRate));          // SAMPLE_RATE
    dockerArgs.push(String(eventLimit));          // EVENT_LIMIT

    if (onProgress) onProgress({ stage: 'compiling' });

    // Run Docker container
    const result = await new Promise((resolve, reject) => {
      const proc = spawn('docker', dockerArgs, {
        timeout: SANDBOX_CONFIG.timeout
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data;
      });

      proc.stderr.on('data', (data) => {
        stderr += data;
        // Parse progress from stderr
        const chunk = data.toString();
        if (chunk.includes('Compiling') && onProgress) {
          onProgress({ stage: 'compiling', message: chunk.trim() });
        } else if (chunk.includes('Running') && onProgress) {
          onProgress({ stage: 'running' });
        } else if (chunk.includes('Processing') && onProgress) {
          onProgress({ stage: 'processing' });
        }
      });

      proc.on('close', (exitCode) => {
        if (exitCode === 0) {
          resolve({ stdout, stderr });
        } else {
          reject({ stdout, stderr, exitCode });
        }
      });

      proc.on('error', (err) => {
        if (err.code === 'ETIMEDOUT') {
          proc.kill('SIGKILL');
          reject({
            stderr: 'Execution timed out',
            exitCode: 124,
            timeout: true
          });
        } else {
          reject(err);
        }
      });

      // Set timeout manually since spawn timeout might not work on all platforms
      setTimeout(() => {
        proc.kill('SIGKILL');
      }, SANDBOX_CONFIG.timeout);
    });

    if (onProgress) onProgress({ stage: 'done' });

    return result;

  } finally {
    // Cleanup temp directory
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Parse error output from sandbox execution
 */
export function parseSandboxError(error, tempFile = 'input.c') {
  const { stderr, exitCode, timeout } = error;

  if (timeout) {
    return {
      type: 'timeout',
      message: 'Program took too long to execute (possible infinite loop?)'
    };
  }

  // Filter out bash warnings before processing
  const filteredStderr = (stderr || '')
    .split('\n')
    .filter(line => !line.includes('initialize_job_control') && !line.includes('getpgrp failed'))
    .join('\n');

  // Try to parse JSON error from sandbox
  try {
    const json = JSON.parse(filteredStderr.trim());
    if (json.error) {
      return {
        type: json.error.includes('Compilation') ? 'compile_error' : 'runtime_error',
        message: json.error,
        details: json.details
      };
    }
  } catch {
    // Not JSON, parse as text
  }

  // Check for compile errors in stderr
  const errors = [];
  const lines = (filteredStderr || '').split('\n');

  for (const line of lines) {
    const match = line.match(/:(\d+):(\d+):\s*(error|warning):\s*(.+)$/);
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
      summary: `${errors.filter(e => e.severity === 'error').length} error(s)`
    };
  }

  // Runtime errors
  if (filteredStderr.includes('Segmentation fault') || filteredStderr.includes('SIGSEGV')) {
    return {
      type: 'runtime_error',
      message: 'Program crashed (segmentation fault)'
    };
  }

  // Generic error
  return {
    type: 'unknown_error',
    message: filteredStderr || 'Unknown error occurred',
    exitCode
  };
}

export default {
  checkSandboxAvailable,
  runInSandbox,
  parseSandboxError,
  SANDBOX_CONFIG
};
