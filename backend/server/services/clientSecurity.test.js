import assert from 'node:assert/strict';
import test from 'node:test';

import { isAllowedClientOrigin, isLoopbackHost, validateDirectBind } from './clientSecurity.js';

test('loopback detection accepts local names and addresses only', () => {
  for (const host of ['localhost', '127.0.0.1', '127.42.0.9', '::1', '[::1]']) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ['0.0.0.0', '192.168.1.2', 'example.com', '::']) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

test('browser origins are loopback or explicitly allowlisted', () => {
  assert.equal(isAllowedClientOrigin(undefined), true);
  assert.equal(isAllowedClientOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedClientOrigin('http://127.0.0.1:8080'), true);
  assert.equal(isAllowedClientOrigin('http://localhost:5173', [], false), false);
  assert.equal(isAllowedClientOrigin('https://explorer.example', ['https://explorer.example']), true);
  assert.equal(isAllowedClientOrigin('https://explorer.example', ['https://explorer.example'], false), true);
  assert.equal(isAllowedClientOrigin('https://untrusted.example', ['https://explorer.example']), false);
  assert.equal(isAllowedClientOrigin('not a URL'), false);
});

test('non-loopback local direct mode requires an explicit override', () => {
  assert.match(validateDirectBind({ deploymentMode: 'local', host: '0.0.0.0', allowNonLoopbackDirect: false }), /must bind to loopback/);
  assert.equal(validateDirectBind({ deploymentMode: 'local', host: '127.0.0.1', allowNonLoopbackDirect: false }), null);
  assert.equal(validateDirectBind({ deploymentMode: 'local', host: '0.0.0.0', allowNonLoopbackDirect: true }), null);
  assert.equal(validateDirectBind({ deploymentMode: 'hosted', host: '0.0.0.0', allowNonLoopbackDirect: false }), null);
});
