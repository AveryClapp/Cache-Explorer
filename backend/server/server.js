import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = dirname(__dirname);
const CACHE_EXPLORE = join(BACKEND_DIR, 'scripts', 'cache-explore');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.post('/compile', async (req, res) => {
  const { code, config = 'educational', optLevel = '-O0' } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  const tempFile = `/tmp/cache-explorer-${randomUUID()}.c`;

  try {
    await writeFile(tempFile, code);

    const result = await new Promise((resolve, reject) => {
      const args = [tempFile, '--config', config, optLevel, '--json'];
      const proc = spawn(CACHE_EXPLORE, args);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (exitCode) => {
        if (exitCode !== 0) {
          reject(new Error(stderr || `Process exited with code ${exitCode}`));
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
    res.status(500).json({ error: err.message });
  } finally {
    unlink(tempFile).catch(() => {});
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Cache Explorer server running on http://localhost:${PORT}`);
});
