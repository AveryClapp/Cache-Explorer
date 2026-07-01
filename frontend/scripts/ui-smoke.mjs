#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptDir, '..')
const host = '127.0.0.1'
const maxLayoutScrollDelta = 24
const smokeTimeoutMs = Number(process.env.CACHE_EXPLORER_UI_SMOKE_TIMEOUT_MS || 180000)

let previewProcess
let browser
let page
let shuttingDown = false
let currentStep = 'startup'
let smokeTimer

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function startSmokeTimeout() {
  smokeTimer = setTimeout(() => {
    console.error(`UI smoke timed out after ${smokeTimeoutMs}ms during "${currentStep}"`)
    cleanup().finally(() => process.exit(1))
  }, smokeTimeoutMs)
  smokeTimer.unref?.()
}

function clearSmokeTimeout() {
  if (smokeTimer) clearTimeout(smokeTimer)
}

async function runSmokeStep(label, action) {
  currentStep = label
  const startedAt = Date.now()
  console.log(`[ui-smoke] ${label}`)
  await action()
  console.log(`[ui-smoke] ${label} ok (${Date.now() - startedAt}ms)`)
}

function commandPath(command) {
  const lookup = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(lookup, [command], { encoding: 'utf8' })
  if (result.status !== 0) return null
  return result.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) || null
}

function browserExecutable() {
  const candidates = [
    process.env.CACHE_EXPLORER_BROWSER,
    commandPath('google-chrome'),
    commandPath('google-chrome-stable'),
    commandPath('chromium'),
    commandPath('chromium-browser'),
    commandPath('chrome'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ].filter(Boolean)

  return candidates.find(candidate => existsSync(candidate))
}

async function isPortFree(port) {
  return new Promise(resolvePort => {
    const server = net.createServer()
    server.once('error', () => resolvePort(false))
    server.once('listening', () => {
      server.close(() => resolvePort(true))
    })
    server.listen(port, host)
  })
}

async function pickPort(start = Number(process.env.CACHE_EXPLORER_UI_PORT || 4173)) {
  for (let port = start; port < start + 50; port += 1) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`No free UI smoke port found starting at ${start}`)
}

async function waitForHttp(url) {
  let lastError
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'unknown error'}`)
}

function startPreview(port) {
  const child = spawn(
    'npm',
    ['run', 'preview', '--', '--host', host, '--port', String(port), '--strictPort'],
    {
      cwd: frontendDir,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString() })
  child.stderr.on('data', chunk => { output += chunk.toString() })
  child.once('exit', code => {
    if (!shuttingDown && code !== null && code !== 0 && code !== 130) {
      console.error(output)
    }
  })

  return child
}

async function assertVisible(locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 5000 })
  assert(await locator.isVisible(), `${label} is not visible`)
}

async function waitForRequestCount(requests, count, label) {
  const startedAt = Date.now()
  while (requests.length < count) {
    if (Date.now() - startedAt > 5000) {
      throw new Error(`${label} did not reach ${count} requests; saw ${requests.length}`)
    }
    await delay(50)
  }
}

function workloadName(id) {
  return page.locator('.workload-row .workload-name').filter({ hasText: id })
}

async function layoutMetrics() {
  return page.evaluate(() => {
    const empty = document.querySelector('.empty-state')
    const paths = Array.from(document.querySelectorAll('.empty-state-path')).map(element => ({
      text: element.textContent?.replace(/\s+/g, ' ').trim(),
      overflow: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height),
    }))
    const trustItems = Array.from(document.querySelectorAll('.empty-state-trust-item')).map(element => ({
      text: element.textContent?.replace(/\s+/g, ' ').trim(),
      overflow: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height),
    }))
    const evidenceItems = Array.from(document.querySelectorAll('.empty-state-evidence span')).map(element => ({
      text: element.textContent?.replace(/\s+/g, ' ').trim(),
      overflow: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height),
    }))

    return {
      target: document.querySelector('.empty-state-target')?.textContent?.trim(),
      pathCount: paths.length,
      pathOverflow: paths.some(path => path.overflow),
      trustCount: trustItems.length,
      trustOverflow: trustItems.some(item => item.overflow),
      evidenceCount: evidenceItems.length,
      evidenceOverflow: evidenceItems.some(item => item.overflow),
      emptyScrollDelta: empty ? empty.scrollHeight - empty.clientHeight : null,
      paths,
      trustItems,
      evidenceItems,
    }
  })
}

async function closeModal() {
  const closeButton = page.locator('.batch-modal-close')
  await assertVisible(closeButton, 'modal close button')
  await closeButton.click()
}

async function verifyLaunchSurface(url) {
  await page.route('**/profiles', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profiles: [
          {
            id: 'educational',
            aliases: ['teaching-l1'],
            displayName: 'Educational',
            vendor: 'Generic',
            architecture: 'teaching',
            class: 'teaching',
            modelConfidence: 'educational',
            validation: {
              source: 'Local perf smoke',
              confidence: 'educational',
              caveats: ['L1 validated on local perf counters'],
            },
            modelContract: {
              version: 1,
              statusTerms: {},
              fields: {
                cacheHierarchy: {
                  subsystem: 'cache',
                  status: 'calibrated',
                  drivesSimulation: true,
                  resultSurface: ['levels'],
                  description: 'Cache sizes and associativity',
                },
                prefetch: {
                  subsystem: 'prefetch',
                  status: 'estimated',
                  drivesSimulation: true,
                  resultSurface: ['prefetch'],
                  description: 'Prefetch policy',
                },
                topology: {
                  subsystem: 'topology',
                  status: 'metadata-only',
                  drivesSimulation: false,
                  resultSurface: ['profile'],
                  description: 'Topology metadata',
                },
              },
            },
          },
        ],
      }),
    })
  })

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const environmentStatus = page.locator('.environment-status')
  await assertVisible(environmentStatus.getByText('Healthy', { exact: true }), 'environment health status')
  await assertVisible(environmentStatus.getByText('Direct', { exact: true }), 'environment sandbox status')
  const environmentLayout = await environmentStatus.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      overflow: element.scrollWidth > element.clientWidth || rect.right > window.innerWidth,
      width: Math.round(rect.width),
    }
  })
  assert(!environmentLayout.overflow, `environment status overflows: ${JSON.stringify(environmentLayout)}`)
  await assertVisible(page.getByText('Choose a run path', { exact: true }), 'launch heading')
  await assertVisible(page.getByText('Current target', { exact: true }), 'target label')
  await assertVisible(page.getByText('Trust packet', { exact: true }), 'launch trust packet label')
  await assertVisible(page.getByText('Compiler / profile / fidelity', { exact: true }), 'launch trust packet value')
  await assertVisible(page.getByText('Model contract', { exact: true }), 'launch model-contract evidence')
  await assertVisible(page.getByText('Repro command', { exact: true }), 'launch repro evidence')
  await assertVisible(page.getByRole('button', { name: 'Share', exact: true }), 'launch share action')
  await assertVisible(page.getByRole('button', { name: /Run buffer/ }), 'run buffer path')

  const desktopLayout = await layoutMetrics()
  assert(desktopLayout.pathCount === 4, `expected 4 launch paths, saw ${desktopLayout.pathCount}`)
  assert(desktopLayout.trustCount === 3, `expected 3 launch trust items, saw ${desktopLayout.trustCount}`)
  assert(desktopLayout.evidenceCount === 3, `expected 3 launch evidence items, saw ${desktopLayout.evidenceCount}`)
  assert(desktopLayout.target?.includes('Educational'), `unexpected target summary: ${desktopLayout.target}`)
  assert(desktopLayout.target?.includes('1M events'), `target summary should use compact limit: ${desktopLayout.target}`)
  assert(!desktopLayout.pathOverflow, `desktop launch paths overflow: ${JSON.stringify(desktopLayout.paths)}`)
  assert(!desktopLayout.trustOverflow, `desktop launch trust strip overflows: ${JSON.stringify(desktopLayout.trustItems)}`)
  assert(!desktopLayout.evidenceOverflow, `desktop launch evidence overflows: ${JSON.stringify(desktopLayout.evidenceItems)}`)
  assert((desktopLayout.emptyScrollDelta ?? 0) <= maxLayoutScrollDelta, `desktop launch surface scrolls by ${desktopLayout.emptyScrollDelta}px`)

  await page.getByRole('button', { name: /Hardware map/ }).click()
  const hardwareModal = page.locator('.hardware-explorer-modal')
  await assertVisible(hardwareModal.getByText('Hardware Explorer', { exact: true }), 'hardware modal')
  await assertVisible(hardwareModal.getByText('Trust Snapshot', { exact: true }), 'hardware trust snapshot')
  await assertVisible(hardwareModal.getByText('2/3', { exact: true }), 'hardware driven field count')
  await assertVisible(hardwareModal.getByText('Local perf smoke', { exact: true }), 'hardware validation source')
  await assertVisible(hardwareModal.getByText('teaching-l1', { exact: true }), 'hardware aliases')
  await assertVisible(hardwareModal.getByText('L1 validated on local perf counters', { exact: true }), 'hardware validation caveat')
  await closeModal()

  await page.getByRole('button', { name: /Experiment matrix/ }).click()
  await assertVisible(page.getByText('Hardware Experiment', { exact: true }), 'experiment modal')
  await closeModal()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  assert(!(await page.locator('.environment-status').isVisible()), 'environment status should collapse on mobile')
  await page.getByRole('button', { name: 'Results' }).click()
  await assertVisible(page.getByText('Choose a run path', { exact: true }), 'mobile launch heading')

  const mobileLayout = await layoutMetrics()
  assert(mobileLayout.pathCount === 4, `expected 4 mobile launch paths, saw ${mobileLayout.pathCount}`)
  assert(mobileLayout.trustCount === 3, `expected 3 mobile launch trust items, saw ${mobileLayout.trustCount}`)
  assert(mobileLayout.evidenceCount === 3, `expected 3 mobile launch evidence items, saw ${mobileLayout.evidenceCount}`)
  assert(!mobileLayout.pathOverflow, `mobile launch paths overflow: ${JSON.stringify(mobileLayout.paths)}`)
  assert(!mobileLayout.trustOverflow, `mobile launch trust strip overflows: ${JSON.stringify(mobileLayout.trustItems)}`)
  assert(!mobileLayout.evidenceOverflow, `mobile launch evidence overflows: ${JSON.stringify(mobileLayout.evidenceItems)}`)
  assert((mobileLayout.emptyScrollDelta ?? 0) <= maxLayoutScrollDelta, `mobile launch surface scrolls by ${mobileLayout.emptyScrollDelta}px`)

  await page.unroute('**/profiles')
}

async function verifyWorkloadCatalogControls(url) {
  const mockWorkloads = [
    {
      id: 'conv2d-intel14',
      description: 'Direct versus tiled Conv2D locality on Intel 14th Gen.',
      example: 'examples/conv2d_kernel.c',
      optLevel: '-O2',
      config: 'intel14',
      limit: 200000,
      variants: [
        { id: 'direct' },
        { id: 'tiled', defines: ['RUN_TILED=1'] },
      ],
      expectedRelationships: [
        { metric: 'l2.hitRate', relationship: 'tiled > direct' },
      ],
    },
    {
      id: 'prefetch-stream-intel',
      description: 'Sequential scan with stream prefetching enabled.',
      example: 'examples/prefetch_friendly.c',
      optLevel: '-O2',
      config: 'intel14',
      limit: 100000,
      prefetch: 'stream',
      variants: [
        { id: 'prefetch-off', prefetch: 'none' },
        { id: 'prefetch-stream', prefetch: 'stream' },
      ],
      expectedRelationships: [
        { metric: 'estimatedCycles', relationship: 'prefetch-stream < prefetch-off' },
      ],
    },
    {
      id: 'hash-probe-zen4',
      description: 'Hash-table probe pattern on Zen 4.',
      example: 'examples/hash_probe.c',
      optLevel: '-O3',
      config: 'zen4',
      limit: 150000,
      variants: [
        { id: 'linear' },
        { id: 'quadratic' },
      ],
      expectedRelationships: [
        { metric: 'l1d.misses', relationship: 'linear < quadratic' },
      ],
    },
  ]
  const stressWorkload = {
    id: 'false-sharing-stress-intel',
    description: 'Threaded false-sharing stress workload.',
    example: 'examples/false_sharing.c',
    optLevel: '-O1',
    config: 'intel',
    limit: 20000,
    stress: true,
    tags: ['stress', 'threaded', 'coherence', 'false-sharing'],
    variants: [
      { id: 'packed', defines: ['ITERATIONS=512'] },
      { id: 'padded', defines: ['ITERATIONS=512', 'RUN_PADDED=1'] },
    ],
    expectedRelationships: [
      { metric: 'coherence.falseSharingEvents', relationship: 'packed > padded' },
    ],
  }
  const mockHistory = {
    available: true,
    source: 'dashboard',
    files: [
      {
        file: 'workload-history-100.json',
        generatedAt: '2026-06-30T10:00:00.000Z',
        ok: true,
        passed: 3,
        failed: 0,
        durationMs: 7900,
      },
      {
        file: 'workload-history-101.json',
        generatedAt: '2026-06-30T11:00:00.000Z',
        ok: true,
        passed: 3,
        failed: 0,
        durationMs: 8500,
      },
    ],
    latest: {
      file: 'workload-history-101.json',
      generatedAt: '2026-06-30T11:00:00.000Z',
      summary: {
        ok: true,
        workloads: 3,
        passed: 3,
        failed: 0,
        durationMs: 8500,
      },
    },
    failures: [],
    slowestWorkloads: [
      { id: 'conv2d-intel14', ok: true, durationMs: 4200, checks: 1, variants: 2 },
      { id: 'hash-probe-zen4', ok: true, durationMs: 2600, checks: 1, variants: 2 },
    ],
    durationDeltas: [
      {
        id: 'conv2d-intel14',
        durationMs: 4200,
        previousDurationMs: 3000,
        deltaMs: 1200,
        deltaPct: 0.4,
      },
      {
        id: 'hash-probe-zen4',
        durationMs: 2600,
        previousDurationMs: 3200,
        deltaMs: -600,
        deltaPct: -0.1875,
      },
    ],
  }
  const mockVerification = {
    ok: false,
    summary: {
      ok: false,
      workloads: 3,
      passed: 2,
      failed: 2,
      durationMs: 7300,
    },
    workloads: [
      {
        id: 'conv2d-intel14',
        description: 'Direct versus tiled Conv2D locality on Intel 14th Gen.',
        ok: true,
        durationMs: 4200,
        variants: {
          direct: { ok: true, durationMs: 1800 },
          tiled: { ok: true, durationMs: 2400 },
        },
        checks: [
          {
            metric: 'l2.hitRate',
            relationship: 'tiled > direct',
            leftVariant: 'tiled',
            rightVariant: 'direct',
            operator: '>',
            leftValue: 0.94,
            rightValue: 0.72,
            passed: true,
          },
        ],
      },
      {
        id: 'prefetch-stream-intel',
        description: 'Sequential scan with stream prefetching enabled.',
        ok: false,
        durationMs: 1900,
        variants: {
          'prefetch-off': { ok: true, durationMs: 700 },
          'prefetch-stream': {
            ok: false,
            durationMs: 1200,
            timeout: true,
            error: 'cache-explore timed out after 1200ms',
          },
        },
        checks: [
          {
            metric: 'estimatedCycles',
            relationship: 'prefetch-stream < prefetch-off',
            leftVariant: 'prefetch-stream',
            rightVariant: 'prefetch-off',
            operator: '<',
            leftValue: 0,
            rightValue: 0,
            passed: false,
            error: 'relationship values unavailable because a variant timed out',
          },
        ],
      },
      {
        id: 'hash-probe-zen4',
        description: 'Hash-table probe pattern on Zen 4.',
        ok: true,
        durationMs: 1200,
        variants: {
          linear: { ok: true, durationMs: 600 },
          quadratic: { ok: true, durationMs: 600 },
        },
        checks: [
          {
            metric: 'l1d.misses',
            relationship: 'linear < quadratic',
            leftVariant: 'linear',
            rightVariant: 'quadratic',
            operator: '<',
            leftValue: 100,
            rightValue: 200,
            passed: true,
          },
        ],
      },
    ],
  }

  const workloadRequests = []
  const verificationRequests = []
  let workloadExperimentRequest = null

  const fulfillWorkloads = route => {
    const requestUrl = new URL(route.request().url())
    const includeStress = requestUrl.searchParams.get('includeStress') === '1'
    workloadRequests.push(requestUrl.search)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ workloads: includeStress ? [...mockWorkloads, stressWorkload] : mockWorkloads }),
    })
  }
  await page.route('**/api/workloads', fulfillWorkloads)
  await page.route('**/api/workloads?**', fulfillWorkloads)
  await page.route('**/api/workloads/history', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(mockHistory),
  }))
  const fulfillVerification = route => {
    const requestUrl = new URL(route.request().url())
    verificationRequests.push(requestUrl.search)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockVerification),
    })
  }
  await page.route('**/api/workloads/verify', fulfillVerification)
  await page.route('**/api/workloads/verify?**', fulfillVerification)
  await page.route('**/experiment', async route => {
    workloadExperimentRequest = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockExperimentResult()),
    })
  })

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Workloads' }).click()
  await assertVisible(page.getByText('Verified Workloads', { exact: true }), 'workload catalog modal')
  await assertVisible(page.getByText('Published History', { exact: true }), 'published workload history')
  await assertVisible(page.getByText('passing', { exact: true }), 'history passing status')
  await assertVisible(page.getByText('2 runs', { exact: true }), 'history run count')
  await assertVisible(page.getByText('Largest duration changes', { exact: true }), 'history duration delta label')
  await assertVisible(page.getByText('+1.2s', { exact: true }).first(), 'history regression delta')
  await assertVisible(page.getByText('-600ms', { exact: true }).first(), 'history improvement delta')
  await assertVisible(workloadName('conv2d-intel14'), 'conv2d workload row')
  await assertVisible(page.getByText('3 / 3', { exact: true }), 'workload result count')
  assert(await workloadName('false-sharing-stress-intel').count() === 0, 'stress workload should be excluded by default')

  const defaultVerifyRequestCount = verificationRequests.length + 1
  await page.getByRole('button', { name: 'Verify' }).click()
  await waitForRequestCount(verificationRequests, defaultVerifyRequestCount, 'default verification')
  assert(verificationRequests.at(-1) === '', `default verification should not include stress: ${verificationRequests.at(-1)}`)
  await assertVisible(page.getByText('2 passed / 2 failed', { exact: true }), 'verification summary chip')
  const timeoutRow = page.locator('.workload-row').filter({ hasText: 'prefetch-stream-intel' })
  await assertVisible(timeoutRow.getByText('Timed out', { exact: true }), 'timed out workload status')
  await assertVisible(timeoutRow.getByText('Timed out: prefetch-stream', { exact: true }), 'timed out workload diagnostic')
  await assertVisible(timeoutRow.getByText('timeout', { exact: true }), 'timed out variant chip')

  await page.getByLabel('Search workloads').fill('prefetch')
  await assertVisible(workloadName('prefetch-stream-intel'), 'searched workload row')
  assert(await page.getByText('1 / 3', { exact: true }).isVisible(), 'search should narrow workload count')
  assert(await workloadName('conv2d-intel14').count() === 0, 'search should hide unmatched workloads')

  await page.getByLabel('Filter workloads by hardware target').selectOption('zen4')
  await assertVisible(page.getByText('No matching workloads', { exact: true }), 'filtered empty state')

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await assertVisible(page.getByText('3 / 3', { exact: true }), 'cleared workload result count')

  await page.getByLabel('Filter workloads by hardware target').selectOption('zen4')
  await assertVisible(workloadName('hash-probe-zen4'), 'target-filtered workload row')
  assert(await page.getByText('1 / 3', { exact: true }).isVisible(), 'target filter should narrow workload count')

  await page.getByLabel('Sort workloads').selectOption('variants')
  await page.getByRole('button', { name: 'Clear' }).click()
  await assertVisible(page.getByText('3 / 3', { exact: true }), 'cleared filters before stress opt-in')

  await page.getByLabel('Include stress workloads').check()
  await assertVisible(page.getByText('4 / 4', { exact: true }), 'stress-inclusive workload count')
  await assertVisible(workloadName('false-sharing-stress-intel'), 'stress workload row')
  const stressRow = page.locator('.workload-row').filter({ hasText: 'false-sharing-stress-intel' })
  await assertVisible(stressRow.getByText('stress', { exact: true }), 'stress workload badge')
  assert(workloadRequests.at(-1) === '?includeStress=1', `stress catalog request missing opt-in: ${workloadRequests.at(-1)}`)

  const stressVerifyRequestCount = verificationRequests.length + 1
  await page.getByRole('button', { name: 'Verify' }).click()
  await waitForRequestCount(verificationRequests, stressVerifyRequestCount, 'stress verification')
  const stressVerifyParams = new URLSearchParams(verificationRequests.at(-1))
  assert(stressVerifyParams.get('includeStress') === '1', `stress verification request missing opt-in: ${verificationRequests.at(-1)}`)
  assert(stressVerifyParams.get('variantTimeoutMs') === '30000', `stress verification request missing timeout: ${verificationRequests.at(-1)}`)

  await page.getByLabel('Search workloads').fill('prefetch')
  const prefetchRow = page.locator('.workload-row').filter({ hasText: 'prefetch-stream-intel' })
  await assertVisible(prefetchRow, 'prefetch workload row before experiment load')
  await prefetchRow.getByRole('button', { name: 'Experiment' }).click()

  const experimentModal = page.locator('.experiment-modal')
  await assertVisible(experimentModal.getByText('Hardware Experiment', { exact: true }), 'workload experiment modal')
  await assertVisible(experimentModal.getByText('Variant set prefetch-stream-intel', { exact: true }), 'workload variant source label')
  assert(await experimentModal.locator('textarea').inputValue() === 'prefetch-off\nprefetch-stream', 'workload variants should populate experiment textarea')
  await assertVisible(experimentModal.getByText('intel14', { exact: true }), 'workload hardware chip')

  await experimentModal.getByRole('button', { name: 'Run', exact: true }).click()
  await assertVisible(experimentModal.getByText('Overall', { exact: true }), 'workload experiment result')
  assert(Array.isArray(workloadExperimentRequest?.variants), 'workload experiment should submit structured variants')
  assert(workloadExperimentRequest.variants[0]?.id === 'prefetch-off', `unexpected first workload variant: ${JSON.stringify(workloadExperimentRequest?.variants?.[0])}`)
  assert(workloadExperimentRequest.variants[0]?.prefetch === 'none', 'prefetch-off variant should disable prefetch')
  assert(workloadExperimentRequest.variants[1]?.id === 'prefetch-stream', `unexpected second workload variant: ${JSON.stringify(workloadExperimentRequest?.variants?.[1])}`)
  assert(workloadExperimentRequest.variants[1]?.prefetch === 'stream', 'prefetch-stream variant should enable stream prefetch')
  assert(workloadExperimentRequest.variants.every(variant => variant.code?.includes('Prefetch-Friendly Access Pattern')), 'structured variants should carry source code')
  assert(workloadExperimentRequest?.configs?.length === 1 && workloadExperimentRequest.configs[0] === 'intel14', `workload experiment configs mismatch: ${JSON.stringify(workloadExperimentRequest?.configs)}`)
  assert(workloadExperimentRequest?.limit === 100000, `workload experiment should use workload event limit, got ${workloadExperimentRequest?.limit}`)

  await closeModal()
  await page.unroute('**/experiment')
  await page.unroute('**/api/workloads/verify')
  await page.unroute('**/api/workloads/verify?**')
  await page.unroute('**/api/workloads/history')
  await page.unroute('**/api/workloads')
  await page.unroute('**/api/workloads?**')
}

function mockCacheLevel(hits, misses) {
  const total = hits + misses
  return {
    hits,
    misses,
    total,
    hitRate: total > 0 ? hits / total : 0,
    missRate: total > 0 ? misses / total : 0,
  }
}

function mockContractField(subsystem, status, drivesSimulation) {
  return {
    subsystem,
    status,
    drivesSimulation,
    resultSurface: [],
    description: `${subsystem} ${status}`,
  }
}

function mockResultWithContract() {
  const modelContract = {
    version: 1,
    statusTerms: {},
    fields: {
      cacheHierarchy: mockContractField('cache hierarchy', 'modeled', true),
      cacheTiming: mockContractField('cache timing', 'estimated', true),
      simd: mockContractField('simd', 'metadata-only', false),
      numa: mockContractField('numa', 'unsupported', false),
    },
  }

  return {
    config: 'intel14',
    events: 100000,
    cacheConfig: {
      l1d: { sizeKB: 48, assoc: 12, lineSize: 64, sets: 64 },
      l1i: { sizeKB: 32, assoc: 8, lineSize: 64, sets: 64 },
      l2: { sizeKB: 2048, assoc: 16, lineSize: 64, sets: 2048 },
      l3: { sizeKB: 36864, assoc: 12, lineSize: 64, sets: 49152 },
    },
    levels: {
      l1d: mockCacheLevel(94000, 6000),
      l2: mockCacheLevel(5200, 800),
      l3: mockCacheLevel(700, 100),
    },
    hotLines: [],
    profile: {
      id: 'intel14',
      displayName: 'Intel 14th Gen',
      vendor: 'Intel',
      architecture: 'x86_64',
      class: 'desktop',
      modelConfidence: 'calibrated',
      modelContract,
    },
    provenance: {
      resultKind: 'simulated',
      executor: 'direct-dev',
      hardwareProfile: {
        id: 'intel14',
        displayName: 'Intel 14th Gen',
        modelConfidence: 'calibrated',
        validationConfidence: 'calibrated',
      },
      fidelity: {
        trace: 'full',
        sampleRate: 1,
        eventLimit: 1000000,
        fastMode: false,
        cacheSegments: true,
        prefetch: 'stream',
      },
      source: {
        path: 'main.c',
        language: 'c',
        config: 'intel14',
        optLevel: '-O0',
      },
      toolchain: {
        compiler: {
          command: 'clang',
          version: 'clang 21.0.0',
          optLevel: '-O0',
        },
        simulator: {
          path: '/tmp/cache-sim',
          sha256: 'abc123def4567890',
        },
      },
      caveats: ['Cycles and bottlenecks are simulator estimates, not wall-clock measurements.'],
    },
  }
}

function mockLegacyResultWithContract() {
  const result = mockResultWithContract()
  delete result.provenance
  return result
}

function mockComparisonResult({
  config,
  displayName,
  modelConfidence,
  validationConfidence,
  hitRate,
  cycles,
  bottleneck,
  line,
}) {
  const misses = Math.round((1 - hitRate) * 1000)
  const hits = 1000 - misses
  return {
    config,
    events: 100000,
    levels: {
      l1d: mockCacheLevel(hits, misses),
      l2: mockCacheLevel(900, 100),
      l3: mockCacheLevel(950, 50),
    },
    hotLines: [],
    profile: {
      id: config,
      displayName,
      vendor: displayName.split(' ')[0],
      architecture: 'x86_64',
      class: 'desktop',
      modelConfidence,
    },
    summary: {
      primaryBottleneck: bottleneck,
      estimatedCycles: cycles,
      confidence: 'medium',
      topSource: {
        file: 'examples/conv2d_kernel.c',
        line,
        subsystem: 'memory',
        cycles: Math.round(cycles * 0.4),
      },
    },
    provenance: {
      resultKind: 'hardware-comparison',
      executor: 'direct-dev',
      hardwareProfile: {
        id: config,
        displayName,
        modelConfidence,
        validationConfidence,
      },
      fidelity: {
        trace: 'full',
        sampleRate: 1,
        eventLimit: 1000000,
        fastMode: false,
        cacheSegments: false,
        prefetch: 'none',
      },
      source: {
        path: 'main.c',
        language: 'c',
        config,
        optLevel: '-O0',
      },
      toolchain: {
        compiler: {
          command: 'clang',
          version: 'clang 21.0.0',
          optLevel: '-O0',
        },
        simulator: {
          path: 'cache-sim',
          sha256: 'abc123def4567890',
        },
      },
      caveats: [],
    },
  }
}

function mockComparisonResponse() {
  return {
    configs: {
      educational: mockComparisonResult({
        config: 'educational',
        displayName: 'Educational',
        modelConfidence: 'educational',
        validationConfidence: 'modeled',
        hitRate: 0.84,
        cycles: 160000,
        bottleneck: 'memory',
        line: 21,
      }),
      intel: mockComparisonResult({
        config: 'intel',
        displayName: 'Intel 14th Gen',
        modelConfidence: 'empirical',
        validationConfidence: 'empirical',
        hitRate: 0.95,
        cycles: 120000,
        bottleneck: 'balanced',
        line: 42,
      }),
      amd: mockComparisonResult({
        config: 'amd',
        displayName: 'AMD Zen 4',
        modelConfidence: 'simulated',
        validationConfidence: 'modeled',
        hitRate: 0.89,
        cycles: 135000,
        bottleneck: 'branch',
        line: 48,
      }),
      apple: mockComparisonResult({
        config: 'apple',
        displayName: 'Apple M3',
        modelConfidence: 'estimated',
        validationConfidence: 'modeled',
        hitRate: 0.92,
        cycles: 125000,
        bottleneck: 'frontend',
        line: 57,
      }),
    },
  }
}

async function verifyResultTrustPanel(url) {
  await page.route('**/compile', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockResultWithContract()),
    })
  })

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Execute' }).click()

  const panel = page.locator('.result-provenance-panel')
  await assertVisible(panel.getByText('Evidence & Fidelity', { exact: true }), 'evidence and fidelity panel')
  await assertVisible(panel.getByText('Modeled', { exact: true }), 'modeled contract bucket')
  await assertVisible(panel.getByText('1 drive simulation', { exact: true }), 'modeled contract count')
  await assertVisible(panel.getByText('Estimated', { exact: true }), 'estimated contract bucket')
  await assertVisible(panel.getByText('1 drive cycle estimates', { exact: true }), 'estimated contract count')
  await assertVisible(panel.getByText('Metadata', { exact: true }), 'metadata contract bucket')
  await assertVisible(panel.getByText('1 display only', { exact: true }), 'metadata contract count')
  await assertVisible(panel.getByText('Unsupported', { exact: true }), 'unsupported contract bucket')
  await assertVisible(panel.getByText('1 not modeled', { exact: true }), 'unsupported contract count')
  await assertVisible(panel.getByText('Local Repro Command', { exact: true }), 'local repro command')

  await page.unroute('**/compile')
}

async function verifyLegacyResultTrustPanel(url) {
  await page.route('**/compile', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockLegacyResultWithContract()),
    })
  })

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Execute' }).click()

  const panel = page.locator('.result-provenance-panel')
  await assertVisible(panel.getByText('Evidence & Fidelity', { exact: true }), 'legacy evidence and fidelity panel')
  await assertVisible(panel.getByText('Legacy', { exact: true }), 'legacy fidelity chip')
  await assertVisible(panel.getByText('Provenance metadata unavailable for this result.', { exact: true }), 'legacy provenance caveat')
  await assertVisible(panel.getByText('Modeled', { exact: true }), 'legacy modeled contract bucket')
  assert(await panel.getByText('Local Repro Command', { exact: true }).count() === 0, 'legacy result should not show repro command')

  await page.unroute('**/compile')
}

async function verifyHardwareComparison(url) {
  let compareRequest = null
  await page.route('**/compare', async route => {
    compareRequest = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockComparisonResponse()),
    })
  })

  await page.evaluate(() => {
    localStorage.removeItem('cache-explorer-hardware-run-set')
  })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Hardware', exact: true }).click()

  const modal = page.locator('.batch-modal').filter({ hasText: 'Hardware Comparison' })
  await assertVisible(modal.getByText('Hardware Comparison', { exact: true }), 'hardware comparison modal')
  await assertVisible(modal.getByText('Educational', { exact: true }), 'comparison educational row')
  await assertVisible(modal.getByText('Intel 14th Gen', { exact: true }), 'comparison intel row')
  await assertVisible(modal.getByText('AMD Zen 4', { exact: true }), 'comparison amd row')
  await assertVisible(modal.getByText('Apple M3', { exact: true }), 'comparison apple row')
  await assertVisible(modal.getByText('Full / Empirical', { exact: true }), 'comparison empirical trust')
  await assertVisible(modal.getByText('Full / Simulated', { exact: true }), 'comparison simulated trust')
  await assertVisible(modal.getByText('120,000', { exact: true }), 'comparison cycles')
  await assertVisible(modal.getByText('95.0%', { exact: true }), 'comparison hit rate')
  await assertVisible(modal.getByText('conv2d_kernel.c:42', { exact: true }), 'comparison source location')
  assert(await modal.getByRole('button', { name: 'Export CSV' }).isEnabled(), 'comparison CSV export should enable')
  assert(await modal.getByRole('button', { name: 'Export JSON' }).isEnabled(), 'comparison JSON export should enable')

  assert(compareRequest?.configs?.join(',') === 'educational,intel,amd,apple', `comparison configs mismatch: ${JSON.stringify(compareRequest?.configs)}`)
  assert(compareRequest?.limit === 1000000, `comparison request should preserve default event limit, got ${compareRequest?.limit}`)
  assert(compareRequest?.language === 'c', `comparison request should include language, got ${compareRequest?.language}`)

  await closeModal()
  await page.unroute('**/compare')
}

async function verifyHardwareComparisonEmptyState(url) {
  const failureMessage = 'Hardware comparison endpoint currently supports C and C++ inputs'
  await page.route('**/compare', async route => {
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ type: 'unsupported_language', message: failureMessage }),
    })
  })
  await page.route('**/compile', async route => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ type: 'server_error', message: 'Per-profile fallback failed' }),
    })
  })

  await page.evaluate(() => {
    localStorage.removeItem('cache-explorer-hardware-run-set')
  })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Hardware', exact: true }).click()

  const modal = page.locator('.batch-modal').filter({ hasText: 'Hardware Comparison' })
  await assertVisible(modal.getByText('No hardware results', { exact: true }), 'comparison empty-state title')
  await assertVisible(modal.getByText(failureMessage, { exact: true }), 'comparison empty-state message')
  await assertVisible(modal.getByText('4 profiles requested', { exact: true }), 'comparison empty-state profile count')
  assert(await modal.getByRole('button', { name: 'Export CSV' }).isDisabled(), 'comparison CSV export should stay disabled on empty state')
  assert(await modal.getByRole('button', { name: 'Export JSON' }).isDisabled(), 'comparison JSON export should stay disabled on empty state')

  await closeModal()
  await page.unroute('**/compile')
  await page.unroute('**/compare')
}

async function replaceEditorText(text) {
  await page.locator('.monaco-editor textarea').first().waitFor({ state: 'attached', timeout: 10000 })
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText(text)
}

async function verifyEditRunCompareShareReopen(url) {
  const editedCode = [
    '#include <stdio.h>',
    'int main(void) {',
    '  int EDIT_RUN_MARKER = 42;',
    '  return EDIT_RUN_MARKER;',
    '}',
    '',
  ].join('\n')
  let compilePayload = null
  let comparePayload = null
  let shortenedState = null

  await page.route('**/compile', async route => {
    compilePayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockResultWithContract()),
    })
  })
  await page.route('**/compare', async route => {
    comparePayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockComparisonResponse()),
    })
  })
  await page.route('**/shorten', async route => {
    shortenedState = route.request().postDataJSON().state
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'smoke-edit-run' }),
    })
  })
  await page.route('**/s/smoke-edit-run', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: shortenedState }),
    })
  })

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await replaceEditorText(editedCode)
  await page.getByRole('button', { name: 'Execute' }).click()

  await assertVisible(page.locator('.result-provenance-panel').getByText('Evidence & Fidelity', { exact: true }), 'edited run evidence and fidelity')
  assert(compilePayload?.code?.includes('EDIT_RUN_MARKER'), `edited compile payload missing marker: ${compilePayload?.code}`)

  await page.getByRole('button', { name: 'Hardware', exact: true }).click()
  await assertVisible(page.locator('.batch-modal').filter({ hasText: 'Hardware Comparison' }), 'edited comparison modal')
  assert(comparePayload?.code?.includes('EDIT_RUN_MARKER'), `edited compare payload missing marker: ${comparePayload?.code}`)
  await closeModal()

  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await assertVisible(page.getByText('Link copied!', { exact: true }), 'edited run share toast')
  await page.waitForFunction(() => window.__copiedText?.includes('?s=smoke-edit-run'), null, { timeout: 5000 })
  assert(shortenedState?.files?.[0]?.code?.includes('EDIT_RUN_MARKER'), 'shortened edited state should include edited source')

  const copiedUrl = await page.evaluate(() => window.__copiedText)
  await page.goto(copiedUrl, { waitUntil: 'domcontentloaded' })
  await assertVisible(page.locator('.view-line').filter({ hasText: 'EDIT_RUN_MARKER' }).first(), 'reopened edited source marker')

  await page.unroute('**/s/smoke-edit-run')
  await page.unroute('**/shorten')
  await page.unroute('**/compare')
  await page.unroute('**/compile')
}

async function verifySocketCloseFallback(url) {
  let compilePayload = null

  await page.addInitScript(() => {
    window.__cacheExplorerSocketPayloads = []

    class DirtyCloseSocket {
      constructor(socketUrl) {
        this.url = socketUrl
        this.readyState = 0

        setTimeout(() => {
          this.readyState = 1
          this.onopen?.({ type: 'open' })

          setTimeout(() => {
            this.readyState = 3
            this.onclose?.({ type: 'close', wasClean: false, code: 1006, reason: 'smoke dirty close' })
          }, 0)
        }, 0)
      }

      send(payload) {
        window.__cacheExplorerSocketPayloads.push(payload)
      }

      close() {
        this.readyState = 3
        this.onclose?.({ type: 'close', wasClean: true, code: 1000, reason: 'client closed' })
      }
    }

    window.WebSocket = DirtyCloseSocket
  })

  await page.route('**/compile', async route => {
    compilePayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockResultWithContract()),
    })
  })

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Execute' }).click()

  await assertVisible(page.locator('.result-provenance-panel').getByText('Evidence & Fidelity', { exact: true }), 'fallback evidence and fidelity panel')
  assert(compilePayload?.config === 'educational', `fallback compile config mismatch: ${JSON.stringify(compilePayload)}`)
  assert(compilePayload?.limit === 1000000, `fallback compile limit mismatch: ${JSON.stringify(compilePayload)}`)

  const socketPayloads = await page.evaluate(() => window.__cacheExplorerSocketPayloads || [])
  assert(socketPayloads.length === 1, `expected one socket payload before fallback, saw ${socketPayloads.length}`)

  await page.unroute('**/compile')
}

async function verifyShareRoundTrip(url) {
  const sharedState = {
    code: '#include <stdio.h>\nint main(void) { return 0; }\n',
    config: 'intel14',
    optLevel: '-O3',
    language: 'c',
    files: [
      {
        name: 'shared.c',
        code: '#include <stdio.h>\nint main(void) { return 0; }\n',
        language: 'c',
        isMain: true,
      },
    ],
    activeFileName: 'shared.c',
    mainFileName: 'shared.c',
    defines: [{ name: 'N', value: '64' }],
    prefetchPolicy: 'stream',
    selectedCompiler: 'clang-21',
    sampleRate: 4,
    eventLimit: 100000,
    fastMode: true,
    cacheSegments: true,
    runHardwareConfigIds: ['intel14', 'amd'],
    experimentVariants: [
      { id: 'baseline', defines: [] },
      { id: 'tuned', defines: ['N=64'] },
    ],
  }
  const missingEnvironmentState = {
    ...sharedState,
    config: 'future-socket',
    selectedCompiler: 'clang-missing',
    runHardwareConfigIds: ['intel12', 'future-gpu', 'zen4', 'zen4'],
  }
  let shortenedState = null
  let restoredCompareRequest = null

  await page.route('**/api/compilers', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        default: 'clang-21',
        compilers: [
          { id: 'clang-21', name: 'Clang', version: '21.0.0', major: 21, path: '/usr/bin/clang', source: 'mock', default: true },
          { id: 'gcc-15', name: 'GCC', version: '15.0.0', major: 15, path: '/usr/bin/gcc', source: 'mock' },
        ],
      }),
    })
  })
  await page.route('**/shorten', async route => {
    shortenedState = route.request().postDataJSON().state
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'smoke-share' }),
    })
  })
  await page.route('**/s/smoke-share', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: shortenedState || sharedState }),
    })
  })
  await page.route('**/s/smoke-seed', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: sharedState }),
    })
  })
  await page.route('**/s/smoke-missing-environment', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: missingEnvironmentState }),
    })
  })
  await page.route('**/compare', async route => {
    restoredCompareRequest = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockComparisonResponse()),
    })
  })

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`${url}?s=smoke-missing-environment`, { waitUntil: 'domcontentloaded' })
  await assertVisible(page.getByText('Educational', { exact: true }), 'fallback hardware value')
  await assertVisible(
    page.getByText('Shared hardware profile "future-socket" is not available here; using educational.', { exact: true }),
    'missing hardware notice',
  )
  await assertVisible(
    page.getByText('Shared compiler "clang-missing" is not available here; using clang-21.', { exact: true }),
    'missing compiler notice',
  )
  await assertVisible(
    page.getByText('Shared hardware run set skipped unavailable profiles "future-gpu".', { exact: true }),
    'missing run-set notice',
  )
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await assertVisible(page.getByText('Link copied!', { exact: true }), 'empty-state share copied toast')
  await page.waitForFunction(() => window.__copiedText?.includes('?s=smoke-share'), null, { timeout: 5000 })
  assert(shortenedState?.config === 'educational', `empty-state share should use resolved hardware config, got ${shortenedState?.config}`)
  assert(shortenedState?.selectedCompiler === 'clang-21', `empty-state share should use resolved compiler, got ${shortenedState?.selectedCompiler}`)
  assert(shortenedState?.runHardwareConfigIds?.join(',') === 'intel,amd', `empty-state share run set mismatch: ${JSON.stringify(shortenedState?.runHardwareConfigIds)}`)

  await page.getByRole('button', { name: 'Hardware', exact: true }).click()
  await assertVisible(page.locator('.batch-modal').filter({ hasText: 'Hardware Comparison' }), 'restored hardware comparison modal')
  assert(restoredCompareRequest?.configs?.join(',') === 'intel,amd', `restored comparison configs mismatch: ${JSON.stringify(restoredCompareRequest?.configs)}`)
  await closeModal()

  await page.goto(`${url}?s=smoke-seed`, { waitUntil: 'domcontentloaded' })
  await assertVisible(page.getByText('Intel 14th Gen', { exact: true }), 'shared hardware value')
  await assertVisible(page.getByText('-O3', { exact: true }), 'shared optimization value')
  await assertVisible(page.getByText('Stream', { exact: true }), 'shared prefetch value')
  await assertVisible(page.getByText('Fast', { exact: true }), 'shared fast-mode value')
  await assertVisible(page.getByText('1:4', { exact: true }), 'shared sample value')
  await assertVisible(page.getByText('100K', { exact: true }), 'shared limit value')
  assert(await page.locator('.toolbar-toggle').evaluate(element => element.classList.contains('active')), 'loop cache toggle should round-trip active')

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }))
  })
  await assertVisible(page.locator('.command-input'), 'command palette input')
  await page.locator('.command-input').fill('share')
  await page.keyboard.press('Enter')
  await assertVisible(page.getByText('Link copied!', { exact: true }), 'share copied toast')
  await page.waitForFunction(() => window.__copiedText?.includes('?s=smoke-share'), null, { timeout: 5000 })

  const copiedUrl = await page.evaluate(() => window.__copiedText)
  assert(copiedUrl?.includes('?s=smoke-share'), `unexpected copied share URL: ${copiedUrl}`)
  assert(shortenedState?.config === 'intel14', 'shortened state should include hardware config')
  assert(shortenedState?.eventLimit === 100000, 'shortened state should include event limit')
  assert(shortenedState?.cacheSegments === true, 'shortened state should include loop cache setting')

  await page.goto(copiedUrl, { waitUntil: 'domcontentloaded' })
  await assertVisible(page.getByText('Intel 14th Gen', { exact: true }), 'short-link hardware value')
  await assertVisible(page.getByText('-O3', { exact: true }), 'short-link optimization value')
  await assertVisible(page.getByText('Stream', { exact: true }), 'short-link prefetch value')
  await assertVisible(page.getByText('Fast', { exact: true }), 'short-link fast-mode value')
  await assertVisible(page.getByText('100K', { exact: true }), 'short-link limit value')

  await page.unroute('**/shorten')
  await page.unroute('**/s/smoke-share')
  await page.unroute('**/s/smoke-seed')
  await page.unroute('**/s/smoke-missing-environment')
  await page.unroute('**/compare')
  await page.unroute('**/api/compilers')
}

function mockExperimentProvenance(profile) {
  return {
    resultKind: 'hardware-experiment',
    executor: 'direct-dev',
    hardwareProfile: {
      id: profile.id,
      displayName: profile.displayName,
      modelConfidence: profile.modelConfidence,
      validationConfidence: profile.validationConfidence,
    },
    fidelity: {
      trace: 'full',
      sampleRate: 1,
      eventLimit: 100000,
      fastMode: false,
      cacheSegments: true,
      prefetch: 'none',
    },
    source: {
      path: 'examples/conv2d_kernel.c',
      language: 'c',
      config: profile.id,
      optLevel: '-O2',
    },
    toolchain: {
      compiler: {
        command: 'clang',
        version: 'clang 21.0.0',
        optLevel: '-O2',
      },
      simulator: {
        path: 'cache-sim',
        sha256: 'abc123def4567890',
      },
    },
    caveats: [],
  }
}

function mockExperimentResult() {
  const intel = {
    id: 'intel',
    displayName: 'Intel 14th Gen',
    modelConfidence: 'empirical',
    validationConfidence: 'empirical',
  }
  const amd = {
    id: 'amd',
    displayName: 'AMD Zen 4',
    modelConfidence: 'simulated',
    validationConfidence: 'modeled',
  }

  return {
    source: 'examples/conv2d_kernel.c',
    baselineVariant: 'direct',
    summary: [
      {
        variant: 'direct',
        variantSpec: 'direct',
        config: 'intel',
        profile: intel,
        primaryBottleneck: 'L2 misses',
        estimatedCycles: 120000,
        cycleDelta: null,
        cycleDeltaPercent: null,
        topSource: { file: 'examples/conv2d_kernel.c', line: 42, subsystem: 'memory' },
        hitRates: { l1d: 0.82 },
        events: 100000,
      },
      {
        variant: 'tiled',
        variantSpec: 'tiled:RUN_TILED=1',
        config: 'intel',
        profile: intel,
        primaryBottleneck: 'Compute',
        estimatedCycles: 90000,
        cycleDelta: -30000,
        cycleDeltaPercent: -0.25,
        topSource: { file: 'examples/conv2d_kernel.c', line: 57, subsystem: 'compute' },
        hitRates: { l1d: 0.91 },
        events: 100000,
      },
      {
        variant: 'direct',
        variantSpec: 'direct',
        config: 'amd',
        profile: amd,
        primaryBottleneck: 'L1D misses',
        estimatedCycles: 110000,
        cycleDelta: null,
        cycleDeltaPercent: null,
        topSource: { file: 'examples/conv2d_kernel.c', line: 42, subsystem: 'memory' },
        hitRates: { l1d: 0.88 },
        events: 100000,
      },
      {
        variant: 'tiled',
        variantSpec: 'tiled:RUN_TILED=1',
        config: 'amd',
        profile: amd,
        primaryBottleneck: 'L3 misses',
        estimatedCycles: 115000,
        cycleDelta: 5000,
        cycleDeltaPercent: 0.045,
        topSource: { file: 'examples/conv2d_kernel.c', line: 61, subsystem: 'memory' },
        hitRates: { l1d: 0.86 },
        events: 100000,
      },
    ],
    variants: {
      direct: {
        source: 'direct',
        summary: [],
        configs: {
          intel: { config: 'intel', events: 100000, provenance: mockExperimentProvenance(intel) },
          amd: { config: 'amd', events: 100000, provenance: mockExperimentProvenance(amd) },
        },
      },
      tiled: {
        source: 'tiled:RUN_TILED=1',
        summary: [],
        configs: {
          intel: { config: 'intel', events: 100000, provenance: mockExperimentProvenance(intel) },
          amd: { config: 'amd', events: 100000, provenance: mockExperimentProvenance(amd) },
        },
      },
    },
  }
}

async function verifyExperimentResults(url) {
  let experimentRequest = null
  await page.route('**/experiment', async route => {
    experimentRequest = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockExperimentResult()),
    })
  })

  await page.evaluate(() => {
    localStorage.removeItem('cache-explorer-hardware-run-set')
  })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Experiment', exact: true }).click()

  const modal = page.locator('.experiment-modal')
  await assertVisible(modal.getByText('Hardware Experiment', { exact: true }), 'experiment modal')
  await modal.getByRole('button', { name: 'Run', exact: true }).click()

  await assertVisible(modal.getByText('Overall', { exact: true }), 'experiment overall winner label')
  await assertVisible(modal.getByText('tiled', { exact: true }).first(), 'experiment tiled winner')
  await assertVisible(modal.getByText('205,000 cycles', { exact: true }), 'experiment overall cycles')
  await assertVisible(modal.getByText('Intel 14th Gen', { exact: true }).first(), 'experiment intel winner')
  await assertVisible(modal.getByText('AMD Zen 4', { exact: true }).first(), 'experiment amd winner')
  await assertVisible(modal.getByText('-30,000 (-25.0%)', { exact: true }).first(), 'experiment improvement delta')
  await assertVisible(modal.getByText('+5,000 (4.5%)', { exact: true }), 'experiment regression delta')
  await assertVisible(modal.getByText('91.0%', { exact: true }), 'experiment hit-rate cell')
  await assertVisible(modal.getByText('conv2d_kernel.c:57', { exact: true }), 'experiment top-source cell')
  await assertVisible(modal.getByText('Full / Empirical', { exact: true }).first(), 'experiment empirical trust label')
  await assertVisible(modal.getByText('Full / Simulated', { exact: true }).first(), 'experiment simulated trust label')
  assert(await modal.getByRole('button', { name: 'Export CSV' }).isEnabled(), 'experiment CSV export should enable after results')
  assert(await modal.getByRole('button', { name: 'Export JSON' }).isEnabled(), 'experiment JSON export should enable after results')

  assert(experimentRequest?.variants?.includes('direct'), 'experiment request should include direct variant')
  assert(experimentRequest?.variants?.includes('tiled:RUN_TILED=1'), 'experiment request should include tiled variant')
  assert(experimentRequest?.configs?.includes('intel'), 'experiment request should include Intel config')
  assert(experimentRequest?.configs?.includes('amd'), 'experiment request should include AMD config')
  assert(experimentRequest?.limit === 1000000, `experiment request should preserve default event limit, got ${experimentRequest?.limit}`)

  await closeModal()
  await page.unroute('**/experiment')
}

async function verifyExperimentShareReopen(url) {
  const experimentVariants = 'direct\nshared-tiled:RUN_TILED=1'
  const sharedState = {
    code: '#include <stdio.h>\nint main(void) { return 0; }\n',
    config: 'intel14',
    optLevel: '-O2',
    language: 'c',
    files: [
      {
        name: 'experiment.c',
        code: '#include <stdio.h>\nint main(void) { return 0; }\n',
        language: 'c',
        isMain: true,
      },
    ],
    activeFileName: 'experiment.c',
    mainFileName: 'experiment.c',
    selectedCompiler: 'clang-21',
    eventLimit: 200000,
    cacheSegments: true,
    runHardwareConfigIds: ['intel', 'amd'],
    experimentVariants,
  }
  let experimentRequest = null
  let shortenedState = null

  await page.route('**/s/smoke-experiment-seed', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: sharedState }),
    })
  })
  await page.route('**/s/smoke-experiment-roundtrip', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: shortenedState }),
    })
  })
  await page.route('**/shorten', async route => {
    shortenedState = route.request().postDataJSON().state
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'smoke-experiment-roundtrip' }),
    })
  })
  await page.route('**/experiment', async route => {
    experimentRequest = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockExperimentResult()),
    })
  })

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`${url}?s=smoke-experiment-seed`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Experiment', exact: true }).click()

  let modal = page.locator('.experiment-modal')
  await assertVisible(modal.getByText('Hardware Experiment', { exact: true }), 'shared experiment modal')
  assert(await modal.locator('textarea').inputValue() === experimentVariants, 'shared experiment variants should restore before run')
  await assertVisible(modal.getByText('intel', { exact: true }), 'shared experiment intel chip')
  await assertVisible(modal.getByText('amd', { exact: true }), 'shared experiment amd chip')

  await modal.getByRole('button', { name: 'Run', exact: true }).click()
  await assertVisible(modal.getByText('Overall', { exact: true }), 'shared experiment result')
  assert(experimentRequest?.variants?.includes('direct'), `shared experiment request missing direct variant: ${JSON.stringify(experimentRequest?.variants)}`)
  assert(experimentRequest?.variants?.includes('shared-tiled:RUN_TILED=1'), `shared experiment request missing shared variant: ${JSON.stringify(experimentRequest?.variants)}`)
  assert(experimentRequest?.configs?.join(',') === 'intel,amd', `shared experiment configs mismatch: ${JSON.stringify(experimentRequest?.configs)}`)
  assert(experimentRequest?.limit === 200000, `shared experiment limit mismatch: ${experimentRequest?.limit}`)

  await closeModal()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await assertVisible(page.getByText('Link copied!', { exact: true }), 'experiment share copied toast')
  await page.waitForFunction(() => window.__copiedText?.includes('?s=smoke-experiment-roundtrip'), null, { timeout: 5000 })
  assert(shortenedState?.experimentVariants === experimentVariants, `shortened experiment variants mismatch: ${shortenedState?.experimentVariants}`)
  assert(shortenedState?.runHardwareConfigIds?.join(',') === 'intel,amd', `shortened experiment run set mismatch: ${JSON.stringify(shortenedState?.runHardwareConfigIds)}`)

  const copiedUrl = await page.evaluate(() => window.__copiedText)
  await page.goto(copiedUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Experiment', exact: true }).click()
  modal = page.locator('.experiment-modal')
  await assertVisible(modal.getByText('Hardware Experiment', { exact: true }), 'reopened experiment modal')
  assert(await modal.locator('textarea').inputValue() === experimentVariants, 'short-link experiment variants should restore')

  await closeModal()
  await page.unroute('**/experiment')
  await page.unroute('**/shorten')
  await page.unroute('**/s/smoke-experiment-roundtrip')
  await page.unroute('**/s/smoke-experiment-seed')
}

async function cleanup() {
  if (browser) await browser.close().catch(() => {})
  if (previewProcess) {
    shuttingDown = true
    previewProcess.kill('SIGTERM')
    await delay(250)
    if (!previewProcess.killed) previewProcess.kill('SIGKILL')
  }
}

process.once('SIGINT', async () => {
  await cleanup()
  process.exit(130)
})

try {
  startSmokeTimeout()
  const executablePath = browserExecutable()
  assert(executablePath, 'No Chrome/Chromium executable found. Set CACHE_EXPLORER_BROWSER to a browser binary.')

  const port = await pickPort()
  const url = `http://${host}:${port}/`
  previewProcess = startPreview(port)
  await waitForHttp(url)

  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  page = await browser.newPage()
  page.on('pageerror', error => {
    console.error(`[pageerror] ${error.stack || error.message}`)
  })
  await page.addInitScript(() => {
    window.__copiedText = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => {
          window.__copiedText = text
        },
      },
    })
  })
  await page.route('**/health', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'healthy',
      sandbox: 'disabled',
      mode: 'development',
      version: 'ui-smoke',
      checks: {
        compiler: 'ok',
        temp_dir: 'ok',
        database: 'ok',
      },
    }),
  }))

  await runSmokeStep('launch surface', () => verifyLaunchSurface(url))
  await runSmokeStep('result trust panel', () => verifyResultTrustPanel(url))
  await runSmokeStep('legacy result trust panel', () => verifyLegacyResultTrustPanel(url))
  await runSmokeStep('hardware comparison', () => verifyHardwareComparison(url))
  await runSmokeStep('hardware comparison empty state', () => verifyHardwareComparisonEmptyState(url))
  await runSmokeStep('edit run compare share reopen', () => verifyEditRunCompareShareReopen(url))
  await runSmokeStep('workload catalog', () => verifyWorkloadCatalogControls(url))
  await runSmokeStep('experiment results', () => verifyExperimentResults(url))
  await runSmokeStep('experiment share reopen', () => verifyExperimentShareReopen(url))
  await runSmokeStep('share round trip', () => verifyShareRoundTrip(url))
  await runSmokeStep('socket close fallback', () => verifySocketCloseFallback(url))
  console.log(`UI smoke passed (${url})`)
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(frontendDir, 'ui-smoke-failure.png'), fullPage: true }).catch(() => {})
  }
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  clearSmokeTimeout()
  await cleanup()
}
