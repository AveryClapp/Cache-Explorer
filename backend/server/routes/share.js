/**
 * URL Shortening / Share Routes
 */

import express from 'express';
import { createShortUrl, getShortUrl } from '../db.js';
import { incCounter } from '../metrics.js';

const router = express.Router();

// Legacy short URL creation
router.post('/shorten', (req, res) => {
  const { state } = req.body;
  if (!state) {
    return res.status(400).json({ error: 'Missing state' });
  }

  incCounter('short_url_created');
  const id = createShortUrl(state);
  res.json({ id, url: `/s/${id}` });
});

// Legacy short URL lookup
router.get('/s/:id', (req, res) => {
  const state = getShortUrl(req.params.id);
  if (!state) {
    incCounter('short_url_not_found');
    return res.status(404).json({ error: 'Not found' });
  }

  incCounter('short_url_resolved');
  res.json({ state });
});

// API v2 share endpoint
router.post('/api/share', (req, res) => {
  const { state } = req.body;
  if (!state) {
    return res.status(400).json({ error: 'Missing state' });
  }

  incCounter('short_url_created');
  const code = createShortUrl(state);
  res.json({ code, url: `/s/${code}` });
});

// API v2 share lookup
router.get('/api/s/:code', (req, res) => {
  const state = getShortUrl(req.params.code);
  if (!state) {
    incCounter('short_url_not_found');
    return res.status(404).json({ error: 'Not found' });
  }

  incCounter('short_url_resolved');
  res.json({ state });
});

export default router;
