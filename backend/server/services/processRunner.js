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
    signal,
  } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject({
        stdout: '',
        stderr: 'Execution cancelled',
        exitCode: null,
        mainFile,
        killed: true,
        cancelled: true,
        timeout: false,
      });
      return;
    }

    const useProcessGroup = process.platform !== 'win32';
    const proc = spawn(command, args, { detached: useProcessGroup });

    let stdout = '';
    let stderr = '';
    let killed = false;
    let timedOut = false;
    let cancelled = false;
    let forceKillTimer = null;

    const killProcess = (signalToSend) => {
      try {
        if (useProcessGroup && proc.pid) {
          process.kill(-proc.pid, signalToSend);
        } else {
          proc.kill(signalToSend);
        }
      } catch {
        proc.kill(signalToSend);
      }
    };

    const context = () => ({
      proc,
      stdout,
      stderr,
      mainFile,
      kill(signal = 'SIGKILL') {
        killed = true;
        killProcess(signal);
      },
    });

    onProcess?.(proc);

    const stopGracefully = () => {
      killed = true;
      killProcess('SIGTERM');
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => killProcess('SIGKILL'), gracefulKillDelayMs);
      }
    };

    const abortHandler = () => {
      cancelled = true;
      stopGracefully();
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    const timeoutId = timeout
      ? setTimeout(() => {
        timedOut = true;
        onTimeout?.(context());
        stopGracefully();
      }, timeout)
      : null;

    proc.stdout.on('data', (data) => {
      const text = asText(data);
      const output = transformStdout ? transformStdout(text, context()) : text;
      if (typeof output === 'string') stdout += output;
      onStdout?.(text, context());
      if (maxOutputBuffer && stdout.length > maxOutputBuffer) {
        killed = true;
        killProcess('SIGKILL');
      }
    });

    proc.stderr.on('data', (data) => {
      const text = asText(data);
      const output = transformStderr ? transformStderr(text, context()) : text;
      if (typeof output === 'string') stderr += output;
      onStderr?.(text, context());
      if (maxOutputBuffer && stderr.length > maxOutputBuffer) {
        killed = true;
        killProcess('SIGKILL');
      }
    });

    proc.on('close', (exitCode) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener('abort', abortHandler);

      const result = {
        stdout,
        stderr,
        exitCode,
        mainFile,
        killed,
        cancelled,
        timeout: timedOut || (killed && !cancelled),
        timeoutMs: timedOut || (killed && !cancelled) ? timeout : undefined,
      };

      if (rejectOnNonZero && killed) {
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
      signal?.removeEventListener('abort', abortHandler);
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
