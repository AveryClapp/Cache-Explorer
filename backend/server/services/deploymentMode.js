function firstDefined(env, names) {
  for (const name of names) {
    if (env[name] !== undefined && env[name] !== '') return env[name];
  }
  return undefined;
}
function parseBoolean(value) {
  if (value === undefined) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function deploymentSecurityFromEnv(env = process.env) {
  const deploymentMode = String(firstDefined(env, [
    'HARDWARE_EXPLORER_DEPLOYMENT_MODE',
    'CACHE_EXPLORER_DEPLOYMENT_MODE',
  ]) || 'local').trim().toLowerCase();

  if (!['local', 'hosted'].includes(deploymentMode)) {
    throw new Error(`Invalid deployment mode "${deploymentMode}"; expected local or hosted.`);
  }

  const sandboxRequested = parseBoolean(firstDefined(env, [
    'HARDWARE_EXPLORER_ENABLE_SANDBOX',
    'CACHE_EXPLORER_ENABLE_SANDBOX',
    'ENABLE_SANDBOX',
  ]));

  if (deploymentMode === 'hosted' && !sandboxRequested) {
    throw new Error(
      'Hosted mode requires sandboxing. Set HARDWARE_EXPLORER_ENABLE_SANDBOX=1 and build the sandbox image.',
    );
  }

  return { deploymentMode, sandboxRequested };
}
