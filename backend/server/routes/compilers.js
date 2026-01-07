/**
 * Compiler Discovery Routes
 */

import express from 'express';
import { discoverCompilers, getCompiler, getDefaultCompiler } from '../compilers.js';

const router = express.Router();
let cachedCompilers = null;

// Initialize compilers on first request
async function ensureCompilersLoaded() {
  if (!cachedCompilers) {
    cachedCompilers = await discoverCompilers();
  }
  return cachedCompilers;
}

// Get available compilers
router.get('/api/compilers', async (req, res) => {
  const compilers = await ensureCompilersLoaded();
  const defaultCompiler = getDefaultCompiler(compilers);

  res.json({
    compilers,
    default: defaultCompiler?.id || null,
  });
});

// Get specific compiler info
router.get('/api/compilers/:id', async (req, res) => {
  const compilers = await ensureCompilersLoaded();
  const compiler = getCompiler(compilers, req.params.id);

  if (!compiler) {
    return res.status(404).json({ error: 'Compiler not found' });
  }

  res.json(compiler);
});

export default router;
