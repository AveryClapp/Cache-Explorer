import { readFileSync } from 'node:fs';

// UI and HTTP validation share the field vocabulary. Native geometry checks are
// the final authority, executed by the CLI before compiling or running code.
const fields = JSON.parse(readFileSync(new URL('../../../frontend/src/lab/fields.json', import.meta.url), 'utf8'));
const byKey = new Map(fields.map(field => [field.key, field]));

export function normalizeHardwareLab(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 16) {
    throw new Error('Hardware Lab overrides must be an object with at most 16 fields.');
  }
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, input]) => {
    const field = byKey.get(key);
    if (!field) throw new Error(`Unknown Hardware Lab field: ${key}`);
    if (typeof input !== 'string' && typeof input !== 'number') throw new Error(`Invalid Hardware Lab value: ${key}`);
    const text = String(input);
    if (field.values) {
      if (!field.values.includes(text)) throw new Error(`Unsupported value for ${key}`);
      return [key, text];
    }
    if (!/^\d{1,10}$/.test(text) || Number(text) < field.min || Number(text) > field.max) {
      throw new Error(`${field.label} must be an integer from ${field.min} to ${field.max}.`);
    }
    const number = Number(text);
    if (['cache.lineSize', 'tlb.pageSize'].includes(key) && !Number.isInteger(Math.log2(number))) {
      throw new Error(`${field.label} must be a power of two.`);
    }
    return [key, String(number)];
  }));
}

export function hardwareLabArgs(overrides) {
  return Object.entries(overrides).flatMap(([key, value]) => ['--lab', `${key}=${value}`]);
}

export function validateHardwareLabRequest(body, sandbox) {
  const overrides = normalizeHardwareLab(body.hardwareLab);
  if (!Object.keys(overrides).length) return overrides;
  if (sandbox) throw Object.assign(new Error('Hardware Lab execution is local-only in Preview; the hosted runner does not yet support scenario overrides.'), { statusCode: 501 });
  if (body.cacheSegments || body.customConfig || !['c', 'cpp'].includes(body.language || 'c')) {
    throw new Error('Hardware Lab requires a named profile, C/C++ source and detailed simulation (no segment caching).');
  }
  if (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 200000) {
    throw new Error('Hardware Lab requires an event limit from 1 to 200000.');
  }
  if (body.sample !== undefined && (!Number.isInteger(body.sample) || body.sample < 1 || body.sample > 10000)) {
    throw new Error('Hardware Lab sample rate must be an integer from 1 to 10000.');
  }
  return overrides;
}

// Catalog enrichment must never turn an uncalibrated what-if into a calibrated
// hardware result, including when a previous result is read from the cache.
export function applyHardwareLabTrust(result) {
  const overrides = result.profile?.labOverrides;
  if (!overrides || !Object.keys(overrides).length) return result;
  const caveat = 'Hardware Lab overrides are hypothetical and uncalibrated; preset evidence does not validate this scenario.';
  result.profile.modelConfidence = 'experimental';
  if (result.profile.modelCoverage) result.profile.modelCoverage = Object.fromEntries(
    Object.entries(result.profile.modelCoverage).map(([key, status]) => [key, status === 'calibrated' ? 'estimated' : status])
  );
  result.profile.validation = { source: 'hardware-lab-scenario', confidence: 'uncalibrated', caveats: [caveat] };
  if (result.profile.modelContract?.fields) {
    result.profile.modelContract = { ...result.profile.modelContract, fields: Object.fromEntries(
      Object.entries(result.profile.modelContract.fields).map(([key, field]) => [key,
        field.status === 'calibrated' ? { ...field, status: 'estimated', caveats: [...(field.caveats || []), caveat] } : field])
    ) };
  }
  if (result.provenance) {
    result.provenance.hardwareProfile = { ...result.provenance.hardwareProfile,
      modelConfidence: 'experimental', validationConfidence: 'uncalibrated', labOverrides: overrides };
    result.provenance.caveats = [...new Set([...(result.provenance.caveats || []), caveat])];
    if (overrides['prefetch.policy']) result.provenance.fidelity = { ...result.provenance.fidelity, prefetch: overrides['prefetch.policy'] };
  }
  return result;
}
