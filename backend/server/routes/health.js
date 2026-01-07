/**
 * Health and Metrics Routes
 */

import express from 'express';
import { isHealthy as isDbHealthy, getDbStats } from '../db.js';
import { getPrometheusMetrics, getHealthStatus } from '../metrics.js';
import { checkSandboxAvailable } from '../sandbox.js';

const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  const health = getHealthStatus();
  const dbHealthy = isDbHealthy();
  const status = health.status === 'healthy' && dbHealthy ? 200 : 503;

  res.status(status).json({
    ...health,
    database: dbHealthy ? 'healthy' : 'unhealthy',
    dbStats: getDbStats(),
  });
});

// Prometheus metrics endpoint
router.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(getPrometheusMetrics());
});

// Sandbox status (for debugging)
router.get('/sandbox-status', async (req, res) => {
  const sandboxAvailable = await checkSandboxAvailable();
  res.json({
    sandboxAvailable,
    mode: sandboxAvailable ? 'sandbox' : 'direct',
  });
});

export default router;
