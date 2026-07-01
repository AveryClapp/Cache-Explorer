#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import net from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptDir, '..')
const host = '127.0.0.1'
const timeoutMs = Number(process.env.CACHE_EXPLORER_VISUAL_TIMEOUT_MS || 120000)

let previewProcess
let browser
let page
let shuttingDown = false
let watchdog

function assert(condition, message) {
  if (!condition) throw new Error(message)
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

async function pickPort(start = Number(process.env.CACHE_EXPLORER_VISUAL_PORT || 4273)) {
  for (let port = start; port < start + 50; port += 1) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`No free visual smoke port found starting at ${start}`)
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

function mockProfile(id, displayName, modelConfidence = 'modeled') {
  return {
    id,
    aliases: id === 'educational' ? ['teaching-l1'] : [],
    displayName,
    vendor: displayName.split(' ')[0],
    architecture: id === 'm3' ? 'arm64' : 'x86_64',
    class: id === 'educational' ? 'teaching' : 'desktop',
    modelConfidence,
    validation: {
      source: 'visual-smoke fixture',
      confidence: modelConfidence,
      caveats: ['Fixture data for visual regression only.'],
    },
    details: {
      cache: {
        levels: {
          l1d: { sizeKB: id === 'educational' ? 8 : 48, assoc: 4, lineSize: 64 },
          l2: { sizeKB: id === 'educational' ? 32 : 2048, assoc: 8, lineSize: 64 },
          l3: { sizeKB: id === 'educational' ? 0 : 32768, assoc: 16, lineSize: 64 },
        },
      },
      memory: {
        l1HitCycles: id === 'educational' ? 2 : 4,
        l2HitCycles: id === 'educational' ? 8 : 12,
        l3HitCycles: id === 'educational' ? 0 : 42,
        dramCycles: id === 'educational' ? 80 : 190,
        tlbMissPenaltyCycles: id === 'educational' ? 20 : 70,
        l1BandwidthBytesPerCycle: id === 'educational' ? 16 : 64,
        l2BandwidthBytesPerCycle: id === 'educational' ? 16 : 32,
        dramBandwidthGBs: id === 'm3' ? 100 : 70,
        maxMemoryLevelParallelism: id === 'educational' ? 2 : 10,
      },
      executionCore: {
        issueWidth: id === 'educational' ? 2 : 6,
        robSize: id === 'educational' ? 32 : 352,
        hideableCycles: id === 'educational' ? 16 : 96,
        branchPredictor: id === 'educational' ? 'simple' : 'tournament',
        branchMispredictPenalty: id === 'educational' ? 8 : 16,
        vectorBits: id === 'm3' ? 128 : 256,
        vectorIsa: id === 'm3' ? 'neon' : 'avx2',
        loadPorts: id === 'educational' ? 1 : 3,
        storePorts: id === 'educational' ? 1 : 2,
        integerPipelines: id === 'educational' ? 1 : 4,
        fpPipelines: id === 'educational' ? 1 : 2,
      },
      prefetch: {
        activePolicy: id === 'educational' ? 'none' : 'stream',
        activeDegree: id === 'educational' ? 0 : 2,
        l1Stream: id !== 'educational',
        l1Stride: id !== 'educational',
        l2Streams: id === 'educational' ? 0 : 16,
        l2MaxDistance: id === 'educational' ? 0 : 512,
        l3Prefetch: id !== 'educational',
        pointerPrefetch: id === 'zen4',
      },
      topology: {
        activeCores: id === 'educational' ? 1 : 8,
        l1Scope: 'per-core',
        l2Scope: id === 'm3' ? 'cluster' : 'per-core',
        l3Scope: id === 'educational' ? 'none' : 'shared',
        coherence: id === 'educational' ? 'single-core' : 'mesi',
      },
      tlb: {
        dtlb: { entries: id === 'educational' ? 16 : 96, associativity: 4, pageSize: 4096 },
        itlb: { entries: id === 'educational' ? 16 : 128, associativity: 8, pageSize: 4096 },
      },
    },
    modelContract: {
      version: 1,
      statusTerms: {},
      fields: {
        cacheHierarchy: mockContractField('cache hierarchy', 'modeled', true),
        tlb: mockContractField('tlb', 'modeled', true),
        cacheTiming: mockContractField('cache timing', 'estimated', true),
        simd: mockContractField('simd', 'metadata-only', false),
        numa: mockContractField('numa', 'unsupported', false),
      },
    },
    notes: 'Visual smoke profile fixture.',
  }
}

function mockResult() {
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
    summary: {
      primaryBottleneck: 'memory',
      estimatedCycles: 120000,
      confidence: 'medium',
      topSource: {
        file: 'examples/conv2d_kernel.c',
        line: 42,
        subsystem: 'memory',
        cycles: 48000,
      },
    },
    profile: mockProfile('intel14', 'Intel 14th Gen', 'calibrated'),
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

function mockWorkloads() {
  return {
    workloads: [
      {
        id: 'conv2d-intel14',
        description: 'Direct versus tiled Conv2D locality on Intel 14th Gen.',
        example: 'examples/conv2d_kernel.c',
        optLevel: '-O2',
        config: 'intel14',
        limit: 200000,
        variants: [{ id: 'direct' }, { id: 'tiled', defines: ['RUN_TILED=1'] }],
        expectedRelationships: [{ metric: 'l2.hitRate', relationship: 'tiled > direct' }],
        identity: {
          manifestSha256: 'visual-smoke-manifest',
          sourceFiles: {
            'examples/conv2d_kernel.c': { sha256: 'visual-smoke-source' },
          },
        },
      },
      {
        id: 'hash-probe-zen4',
        description: 'Hash-table probe pattern on Zen 4.',
        example: 'examples/hash_probe.c',
        optLevel: '-O3',
        config: 'zen4',
        limit: 150000,
        variants: [{ id: 'linear' }, { id: 'quadratic' }],
        expectedRelationships: [{ metric: 'l1d.misses', relationship: 'linear < quadratic' }],
      },
    ],
  }
}

function mockWorkloadHistory() {
  return {
    available: true,
    source: 'visual-smoke',
    files: [{ file: 'workload-history.json', generatedAt: '2026-07-01T00:00:00.000Z' }],
    latest: {
      file: 'workload-history.json',
      generatedAt: '2026-07-01T00:00:00.000Z',
      summary: { ok: true, workloads: 2, passed: 2, failed: 0, durationMs: 5200 },
    },
    failures: [],
    slowestWorkloads: [{ id: 'conv2d-intel14', ok: true, durationMs: 3200, checks: 1, variants: 2 }],
    durationDeltas: [],
  }
}

async function registerRoutes() {
  await page.route('**/health', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'healthy',
      sandbox: 'disabled',
      mode: 'development',
      version: 'visual-smoke',
      checks: { compiler: 'ok', temp_dir: 'ok' },
    }),
  }))
  await page.route('**/api/compilers', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      default: 'clang-21',
      compilers: [
        { id: 'clang-21', name: 'Clang', version: '21.0.0', major: 21, path: '/usr/bin/clang', source: 'mock', default: true },
      ],
    }),
  }))
  await page.route('**/profiles', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      profiles: [
        mockProfile('educational', 'Educational', 'educational'),
        mockProfile('intel14', 'Intel 14th Gen', 'calibrated'),
        mockProfile('zen4', 'AMD Zen 4', 'modeled'),
        mockProfile('m3', 'Apple M3', 'estimated'),
      ],
    }),
  }))
  await page.route('**/compile', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(mockResult()),
  }))
  const fulfillWorkloads = route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(mockWorkloads()),
  })
  await page.route('**/api/workloads', fulfillWorkloads)
  await page.route('**/api/workloads?**', fulfillWorkloads)
  await page.route('**/api/workloads/history', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(mockWorkloadHistory()),
  }))
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset)
}

function parsePng(buffer) {
  assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'invalid PNG signature')

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []

  while (offset < buffer.length) {
    const length = readUInt32(buffer, offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = readUInt32(data, 0)
      height = readUInt32(data, 4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += length + 12
  }

  assert(bitDepth === 8, `unsupported PNG bit depth ${bitDepth}`)
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
  assert(bytesPerPixel > 0, `unsupported PNG color type ${colorType}`)

  const inflated = inflateSync(Buffer.concat(idat))
  const rowBytes = width * bytesPerPixel
  const pixels = Buffer.alloc(rowBytes * height)
  let inOffset = 0

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inOffset]
    inOffset += 1
    const rowOffset = y * rowBytes
    const previousRowOffset = rowOffset - rowBytes

    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[inOffset + x]
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0
      const up = y > 0 ? pixels[previousRowOffset + x] : 0
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[previousRowOffset + x - bytesPerPixel] : 0
      let value
      if (filter === 0) value = raw
      else if (filter === 1) value = raw + left
      else if (filter === 2) value = raw + up
      else if (filter === 3) value = raw + Math.floor((left + up) / 2)
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
      } else {
        throw new Error(`unsupported PNG filter ${filter}`)
      }
      pixels[rowOffset + x] = value & 0xff
    }
    inOffset += rowBytes
  }

  return { width, height, bytesPerPixel, pixels }
}

function assertNonBlankPng(buffer, label) {
  const png = parsePng(buffer)
  const colors = new Set()
  let opaqueSamples = 0
  let luminanceSum = 0
  const step = Math.max(1, Math.floor((png.width * png.height) / 6000))

  for (let pixel = 0; pixel < png.width * png.height; pixel += step) {
    const offset = pixel * png.bytesPerPixel
    const red = png.pixels[offset]
    const green = png.bytesPerPixel > 1 ? png.pixels[offset + 1] : red
    const blue = png.bytesPerPixel > 1 ? png.pixels[offset + 2] : red
    const alpha = png.bytesPerPixel === 4 ? png.pixels[offset + 3] : 255
    if (alpha > 0) opaqueSamples += 1
    luminanceSum += (red + green + blue) / 3
    colors.add(`${red >> 4},${green >> 4},${blue >> 4},${alpha >> 6}`)
  }

  const averageLuminance = luminanceSum / Math.max(1, Math.ceil((png.width * png.height) / step))
  assert(png.width >= 320 && png.height >= 480, `${label} screenshot is unexpectedly small: ${png.width}x${png.height}`)
  assert(opaqueSamples > 100, `${label} screenshot has too few opaque pixels`)
  assert(colors.size >= 12, `${label} screenshot appears blank; only ${colors.size} sampled colors`)
  assert(averageLuminance > 8 && averageLuminance < 248, `${label} screenshot luminance looks blank: ${averageLuminance}`)
}

async function assertVisible(selector, label) {
  const locator = page.locator(selector)
  await locator.waitFor({ state: 'visible', timeout: 8000 })
  assert(await locator.isVisible(), `${label} is not visible`)
}

async function assertLayoutStable(label) {
  const metrics = await page.evaluate(() => {
    const selectors = ['.header', '.workspace', '.editor-panel', '.results-panel']
    return selectors
      .map(selector => {
        const element = document.querySelector(selector)
        if (!element) return null
        const rect = element.getBoundingClientRect()
        return {
          selector,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          overflow: element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2,
        }
      })
      .filter(Boolean)
  })

  for (const item of metrics) {
    assert(item.width > 0 && item.height > 0, `${label} ${item.selector} has empty bounds`)
    assert(item.right > 0 && item.bottom > 0, `${label} ${item.selector} is offscreen`)
  }
}

async function capture(outputDir, label) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await assertLayoutStable(label)
  const path = join(outputDir, `${label}.png`)
  const buffer = await page.screenshot({ path, fullPage: false })
  assertNonBlankPng(buffer, label)
  console.log(`[visual] captured ${path}`)
}

async function closeModal() {
  await page.getByRole('button', { name: /^Close/ }).click()
}

async function openHeaderTool(name) {
  await page.getByRole('button', { name: 'Tools', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}

async function runVisualFlow(url, outputDir) {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await assertVisible('.empty-state', 'launch surface')
  await capture(outputDir, 'desktop-launch')

  await page.getByRole('button', { name: 'Execute', exact: true }).click()
  await page.getByText('Evidence & Fidelity', { exact: true }).waitFor({ state: 'visible', timeout: 8000 })
  await capture(outputDir, 'desktop-result')

  await openHeaderTool('Explore')
  await page.getByText('Hardware Explorer', { exact: true }).waitFor({ state: 'visible', timeout: 8000 })
  await capture(outputDir, 'hardware-explorer')
  await closeModal()

  await openHeaderTool('Workloads')
  await page.getByText('Verified Workloads', { exact: true }).waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('.workload-name').filter({ hasText: 'conv2d-intel14' }).waitFor({ state: 'visible', timeout: 8000 })
  await capture(outputDir, 'workload-catalog')
  await closeModal()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Results', exact: true }).click()
  await assertVisible('.empty-state', 'mobile launch surface')
  await capture(outputDir, 'mobile-results-launch')
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
  assert(existsSync(resolve(frontendDir, 'dist', 'index.html')), 'Build frontend before visual check: npm run build')
  const executablePath = browserExecutable()
  assert(executablePath, 'No Chrome/Chromium executable found. Set CACHE_EXPLORER_BROWSER to a browser binary.')

  watchdog = setTimeout(() => {
    console.error(`Visual smoke timed out after ${timeoutMs}ms`)
    cleanup().finally(() => process.exit(1))
  }, timeoutMs)
  watchdog.unref?.()

  const outputDir = process.env.CACHE_EXPLORER_VISUAL_DIR
    ? resolve(process.env.CACHE_EXPLORER_VISUAL_DIR)
    : await mkdtemp(join(tmpdir(), 'cache-explorer-visual-'))
  await mkdir(outputDir, { recursive: true })

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
  await registerRoutes()
  await runVisualFlow(url, outputDir)
  console.log(`Visual smoke passed (${outputDir})`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (watchdog) clearTimeout(watchdog)
  await cleanup()
}
