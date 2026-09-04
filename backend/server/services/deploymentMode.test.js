import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentSecurityFromEnv } from './deploymentMode.js';

test('defaults to local direct execution', () => {
  assert.deepEqual(deploymentSecurityFromEnv({}), {
    deploymentMode: 'local',
    sandboxRequested: false,
  });
});
test('hosted mode requires sandboxing', () => {
  assert.throws(
    () => deploymentSecurityFromEnv({ HARDWARE_EXPLORER_DEPLOYMENT_MODE: 'hosted' }),
    /Hosted mode requires sandboxing/,
  );
});

test('new Hardware Explorer variables take precedence', () => {
  assert.deepEqual(deploymentSecurityFromEnv({
    HARDWARE_EXPLORER_DEPLOYMENT_MODE: 'hosted',
    CACHE_EXPLORER_DEPLOYMENT_MODE: 'local',
    HARDWARE_EXPLORER_ENABLE_SANDBOX: 'true',
    ENABLE_SANDBOX: '0',
  }), {
    deploymentMode: 'hosted',
    sandboxRequested: true,
  });
});

test('legacy and generic sandbox variables remain supported', () => {
  assert.equal(deploymentSecurityFromEnv({ CACHE_EXPLORER_ENABLE_SANDBOX: '1' }).sandboxRequested, true);
  assert.equal(deploymentSecurityFromEnv({ ENABLE_SANDBOX: '1' }).sandboxRequested, true);
  assert.equal(deploymentSecurityFromEnv({ ENABLE_SANDBOX: '0' }).sandboxRequested, false);
});
