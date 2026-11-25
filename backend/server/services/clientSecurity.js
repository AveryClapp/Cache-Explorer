import { isIP } from 'node:net';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function isLoopbackHost(host) {
  const normalized = String(host || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (LOOPBACK_HOSTS.has(normalized)) return true;
  if (isIP(normalized) === 4) return normalized.startsWith('127.');
  return false;
}

export function isAllowedClientOrigin(origin, allowedOrigins = [], allowLoopback = true) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    return allowLoopback && isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function validateDirectBind({ deploymentMode, host, allowNonLoopbackDirect }) {
  if (deploymentMode !== 'local' || isLoopbackHost(host) || allowNonLoopbackDirect) return null;
  return 'Local direct-execution mode must bind to loopback. Set HARDWARE_EXPLORER_ALLOW_NON_LOOPBACK_DIRECT=1 only behind an access-controlled local proxy.';
}
