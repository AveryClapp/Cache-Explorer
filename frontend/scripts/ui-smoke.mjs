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

let previewProcess
let browser
let page
let shuttingDown = false

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

async function layoutMetrics() {
  return page.evaluate(() => {
    const empty = document.querySelector('.empty-state')
    const paths = Array.from(document.querySelectorAll('.empty-state-path')).map(element => ({
      text: element.textContent?.replace(/\s+/g, ' ').trim(),
      overflow: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height),
    }))

    return {
      target: document.querySelector('.empty-state-target')?.textContent?.trim(),
      pathCount: paths.length,
      pathOverflow: paths.some(path => path.overflow),
      emptyScrollDelta: empty ? empty.scrollHeight - empty.clientHeight : null,
      paths,
    }
  })
}

async function closeModal() {
  const closeButton = page.locator('.batch-modal-close')
  await assertVisible(closeButton, 'modal close button')
  await closeButton.click()
}

async function verifyLaunchSurface(url) {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await assertVisible(page.getByText('Choose a run path', { exact: true }), 'launch heading')
  await assertVisible(page.getByText('Current target', { exact: true }), 'target label')
  await assertVisible(page.getByRole('button', { name: /Run buffer/ }), 'run buffer path')

  const desktopLayout = await layoutMetrics()
  assert(desktopLayout.pathCount === 4, `expected 4 launch paths, saw ${desktopLayout.pathCount}`)
  assert(desktopLayout.target?.includes('Educational'), `unexpected target summary: ${desktopLayout.target}`)
  assert(desktopLayout.target?.includes('1M events'), `target summary should use compact limit: ${desktopLayout.target}`)
  assert(!desktopLayout.pathOverflow, `desktop launch paths overflow: ${JSON.stringify(desktopLayout.paths)}`)
  assert((desktopLayout.emptyScrollDelta ?? 0) <= maxLayoutScrollDelta, `desktop launch surface scrolls by ${desktopLayout.emptyScrollDelta}px`)

  await page.getByRole('button', { name: /Hardware map/ }).click()
  await assertVisible(page.getByText('Hardware Explorer', { exact: true }), 'hardware modal')
  await closeModal()

  await page.getByRole('button', { name: /Experiment matrix/ }).click()
  await assertVisible(page.getByText('Hardware Experiment', { exact: true }), 'experiment modal')
  await closeModal()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Results' }).click()
  await assertVisible(page.getByText('Choose a run path', { exact: true }), 'mobile launch heading')

  const mobileLayout = await layoutMetrics()
  assert(mobileLayout.pathCount === 4, `expected 4 mobile launch paths, saw ${mobileLayout.pathCount}`)
  assert(!mobileLayout.pathOverflow, `mobile launch paths overflow: ${JSON.stringify(mobileLayout.paths)}`)
  assert((mobileLayout.emptyScrollDelta ?? 0) <= maxLayoutScrollDelta, `mobile launch surface scrolls by ${mobileLayout.emptyScrollDelta}px`)
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
      example: 'examples/sequential_scan.c',
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

  await page.route('**/api/workloads', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ workloads: mockWorkloads }),
  }))

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Workloads' }).click()
  await assertVisible(page.getByText('Verified Workloads', { exact: true }), 'workload catalog modal')
  await assertVisible(page.getByText('conv2d-intel14', { exact: true }), 'conv2d workload row')
  await assertVisible(page.getByText('3 / 3', { exact: true }), 'workload result count')

  await page.getByLabel('Search workloads').fill('prefetch')
  await assertVisible(page.getByText('prefetch-stream-intel', { exact: true }), 'searched workload row')
  assert(await page.getByText('1 / 3', { exact: true }).isVisible(), 'search should narrow workload count')
  assert(await page.getByText('conv2d-intel14', { exact: true }).count() === 0, 'search should hide unmatched workloads')

  await page.getByLabel('Filter workloads by hardware target').selectOption('zen4')
  await assertVisible(page.getByText('No matching workloads', { exact: true }), 'filtered empty state')

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await assertVisible(page.getByText('3 / 3', { exact: true }), 'cleared workload result count')

  await page.getByLabel('Filter workloads by hardware target').selectOption('zen4')
  await assertVisible(page.getByText('hash-probe-zen4', { exact: true }), 'target-filtered workload row')
  assert(await page.getByText('1 / 3', { exact: true }).isVisible(), 'target filter should narrow workload count')

  await page.getByLabel('Sort workloads').selectOption('variants')
  await closeModal()
  await page.unroute('**/api/workloads')
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
  let shortenedState = null

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

  await page.setViewportSize({ width: 1280, height: 720 })
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

  await verifyLaunchSurface(url)
  await verifyWorkloadCatalogControls(url)
  await verifyShareRoundTrip(url)
  console.log(`UI smoke passed (${url})`)
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(frontendDir, 'ui-smoke-failure.png'), fullPage: true }).catch(() => {})
  }
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await cleanup()
}
