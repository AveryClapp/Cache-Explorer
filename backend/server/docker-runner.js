/**
 * Docker Sandbox Runner
 * Executes user code in isolated Docker containers with strict resource limits
 */

const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const DOCKER_IMAGE = 'cache-explorer-sandbox';
const TEMP_DIR = process.env.SANDBOX_TEMP_DIR || path.join(os.tmpdir(), 'cache-explorer');

// Resource limits
const LIMITS = {
  memory: '256m',
  cpus: '1',
  pidsLimit: '50',
  timeout: 45000, // 45 seconds total
};

// Ensure temp directory exists
async function ensureTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

/**
 * Run code in a sandboxed Docker container
 * @param {string} code - Source code to compile and run
 * @param {object} options - Execution options
 * @param {function} onProgress - Callback for progress/streaming updates
 * @returns {Promise<object>} - Execution result
 */
async function runInSandbox(code, options = {}, onProgress = null) {
  const {
    language = 'c',
    config = 'intel',
    optLevel = '-O0',
    prefetch = 'none',
    sampleRate = 1,
    eventLimit = 5000000,
  } = options;

  await ensureTempDir();

  const id = uuidv4();
  const ext = language === 'cpp' ? '.cpp' : language === 'rust' ? '.rs' : '.c';
  const codeFile = path.join(TEMP_DIR, `${id}${ext}`);
  const containerCodePath = `/tmp/code${ext}`;

  try {
    // Write code to temp file
    await fs.writeFile(codeFile, code);

    // Docker run arguments
    const args = [
      'run',
      '--rm',
      // Resource limits
      '--memory', LIMITS.memory,
      '--cpus', LIMITS.cpus,
      '--pids-limit', LIMITS.pidsLimit,
      // Security constraints
      '--network', 'none',
      '--read-only',
      '--tmpfs', '/tmp:size=64m,mode=1777',
      '--no-new-privileges',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      // Mount code file read-only
      '-v', `${codeFile}:${containerCodePath}:ro`,
      // Image and arguments
      DOCKER_IMAGE,
      containerCodePath,
      language,
      config,
      optLevel,
      prefetch,
      String(sampleRate),
      String(eventLimit),
    ];

    return await new Promise((resolve, reject) => {
      const docker = spawn('docker', args);

      let stdout = '';
      let stderr = '';
      let lastProgressLine = '';
      const maxOutputSize = 2 * 1024 * 1024; // 2MB max

      // Handle stdout (main output - JSON results)
      docker.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // Check for output size limit
        if (stdout.length > maxOutputSize) {
          docker.kill('SIGKILL');
          reject(new Error('Output too large (>2MB)'));
          return;
        }

        // Stream progress updates and partial results
        if (onProgress) {
          const lines = chunk.split('\n').filter(l => l.trim());
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              onProgress(parsed);
            } catch {
              // Not JSON, ignore
            }
          }
        }
      });

      // Handle stderr (progress messages)
      docker.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;

        // Parse progress messages from stderr
        if (onProgress) {
          const lines = chunk.split('\n').filter(l => l.trim());
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'progress') {
                onProgress(parsed);
              }
            } catch {
              // Not JSON progress, ignore
            }
          }
        }
      });

      // Timeout handler
      const timeout = setTimeout(() => {
        docker.kill('SIGKILL');
        reject(new Error('Execution timeout (45s)'));
      }, LIMITS.timeout);

      // Process exit handler
      docker.on('close', (code) => {
        clearTimeout(timeout);

        // Try to parse the final JSON output
        try {
          // Find the last complete JSON object in stdout
          const lines = stdout.trim().split('\n');
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.startsWith('{') && line.endsWith('}')) {
              const result = JSON.parse(line);
              resolve(result);
              return;
            }
          }

          // No valid JSON found
          resolve({
            error: 'No valid output',
            type: 'server_error',
            raw: stdout.slice(0, 1000),
          });
        } catch (parseErr) {
          resolve({
            error: 'Failed to parse output',
            type: 'server_error',
            raw: stdout.slice(0, 1000),
          });
        }
      });

      docker.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

  } finally {
    // Cleanup temp file
    try {
      await fs.unlink(codeFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if Docker and the sandbox image are available
 * @returns {Promise<object>} - Status object
 */
async function checkSandboxHealth() {
  try {
    // Check Docker is running
    await new Promise((resolve, reject) => {
      const docker = spawn('docker', ['info']);
      docker.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Docker not running'));
      });
      docker.on('error', reject);
    });

    // Check image exists
    await new Promise((resolve, reject) => {
      const docker = spawn('docker', ['image', 'inspect', DOCKER_IMAGE]);
      docker.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Image ${DOCKER_IMAGE} not found`));
      });
      docker.on('error', reject);
    });

    return { healthy: true };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

module.exports = {
  runInSandbox,
  checkSandboxHealth,
  DOCKER_IMAGE,
};
