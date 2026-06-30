import { spawn } from 'child_process';

function asText(data) {
  return typeof data === 'string' ? data : data.toString();
}

export function runManagedProcess(command, args, options = {}) {
  const {
    timeout,
    maxOutputBuffer,
    mainFile,
    gracefulKillDelayMs = 1000,
    rejectOnNonZero = true,
    transformStdout,
    transformStderr,
    onProcess,
    onStdout,
    onStderr,
    onTimeout,
  } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);

    let stdout = '';
    let stderr = '';
    let killed = false;
    let timedOut = false;
    let forceKillTimer = null;

    const context = () => ({
      proc,
      stdout,
      stderr,
      mainFile,
      kill(signal = 'SIGKILL') {
        killed = true;
        proc.kill(signal);
      },
    });

    onProcess?.(proc);

    const timeoutId = timeout
      ? setTimeout(() => {
        killed = true;
        timedOut = true;
        onTimeout?.(context());
        proc.kill('SIGTERM');
        forceKillTimer = setTimeout(() => proc.kill('SIGKILL'), gracefulKillDelayMs);
      }, timeout)
      : null;

    proc.stdout.on('data', (data) => {
      const text = asText(data);
      const output = transformStdout ? transformStdout(text, context()) : text;
      if (typeof output === 'string') stdout += output;
      onStdout?.(text, context());
      if (maxOutputBuffer && stdout.length > maxOutputBuffer) {
        killed = true;
        proc.kill('SIGKILL');
      }
    });

    proc.stderr.on('data', (data) => {
      const text = asText(data);
      const output = transformStderr ? transformStderr(text, context()) : text;
      if (typeof output === 'string') stderr += output;
      onStderr?.(text, context());
      if (maxOutputBuffer && stderr.length > maxOutputBuffer) {
        killed = true;
        proc.kill('SIGKILL');
      }
    });

    proc.on('close', (exitCode) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (forceKillTimer) clearTimeout(forceKillTimer);

      const result = {
        stdout,
        stderr,
        exitCode,
        mainFile,
        killed,
        timeout: timedOut || killed,
        timeoutMs: timedOut || killed ? timeout : undefined,
      };

      if (rejectOnNonZero && killed && exitCode !== 0) {
        reject(result);
      } else if (rejectOnNonZero && exitCode !== 0) {
        reject({ stdout, stderr, exitCode, mainFile });
      } else {
        resolve(result);
      }
    });

    proc.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(err);
    });
  });
}

export function runProcess(command, args, options = {}) {
  return runManagedProcess(command, args, {
    ...options,
    rejectOnNonZero: true,
  });
}
