import { spawn } from 'child_process';

export function runProcess(command, args, options = {}) {
  const {
    timeout,
    maxOutputBuffer,
    mainFile,
  } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeoutId = timeout
      ? setTimeout(() => {
          killed = true;
          proc.kill('SIGTERM');
          setTimeout(() => proc.kill('SIGKILL'), 1000);
        }, timeout)
      : null;

    proc.stdout.on('data', (data) => {
      stdout += data;
      if (maxOutputBuffer && stdout.length > maxOutputBuffer) {
        killed = true;
        proc.kill('SIGKILL');
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data;
      if (maxOutputBuffer && stderr.length > maxOutputBuffer) {
        killed = true;
        proc.kill('SIGKILL');
      }
    });

    proc.on('close', (exitCode) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (killed && exitCode !== 0) {
        reject({ stdout, stderr, exitCode, mainFile, timeout: true, timeoutMs: timeout });
      } else if (exitCode !== 0) {
        reject({ stdout, stderr, exitCode, mainFile });
      } else {
        resolve({ stdout, stderr });
      }
    });

    proc.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(err);
    });
  });
}
