#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const baseUrl = (process.env.HARDWARE_EXPLORER_LIVE_URL
  || process.env.CACHE_EXPLORER_E2E_URL
  || 'http://127.0.0.1:8080').replace(/\/$/, '')
const timeoutMs = Number(process.env.HARDWARE_EXPLORER_LIVE_TIMEOUT_MS || 180000)

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
  return [
    process.env.CACHE_EXPLORER_BROWSER,
    commandPath('google-chrome'),
    commandPath('google-chrome-stable'),
    commandPath('chromium'),
    commandPath('chromium-browser'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ].filter(Boolean).find(candidate => existsSync(candidate))
}

async function waitForHealthy() {
  let lastError
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      const health = await response.json()
      if (response.ok && health.status === 'healthy') return health
      lastError = new Error(`HTTP ${response.status}: ${JSON.stringify(health)}`)
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(`Backend did not become healthy: ${lastError?.message || 'unknown error'}`)
}

async function visible(locator, label, timeout = 10000) {
  await locator.waitFor({ state: 'visible', timeout })
  assert(await locator.isVisible(), `${label} is not visible`)
}

let browser
let timer
try {
  timer = setTimeout(() => {
    console.error(`Live backend smoke timed out after ${timeoutMs}ms`)
    process.exit(1)
  }, timeoutMs)
  timer.unref?.()

  const health = await waitForHealthy()
  assert(health.sandboxStatus?.publicMode === 'local', `expected local Docker product, got ${health.sandboxStatus?.publicMode}`)

  const executablePath = browserExecutable()
  assert(executablePath, 'No Chrome/Chromium executable found. Set CACHE_EXPLORER_BROWSER.')
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))

  const rootStartedAt = Date.now()
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
  await visible(page.getByText('Hardware Explorer', { exact: true }).first(), 'product name')
  await visible(page.getByText('Preview', { exact: true }).first(), 'Preview label')
  await visible(page.getByRole('button', { name: 'Execute', exact: true }), 'default Execute action')
  const rootVisibleMs = Date.now() - rootStartedAt

  await page.getByRole('button', { name: 'Execute', exact: true }).click()
  await visible(page.getByText('Evidence & Fidelity', { exact: true }), 'default analysis result', 90000)

  const nav = page.getByRole('navigation', { name: 'Product' })
  await nav.getByRole('link', { name: 'Profiles', exact: true }).click()
  await visible(page.getByText('CPU Profiles', { exact: true }), 'profiles workspace')
  assert(new URL(page.url()).searchParams.get('view') === 'profiles', 'Profiles did not produce a durable URL')

  await nav.getByRole('link', { name: 'Comparisons', exact: true }).click()
  await visible(page.getByText('Hardware Comparison', { exact: true }), 'comparison workspace')

  await nav.getByRole('link', { name: 'Workloads', exact: true }).click()
  await visible(page.getByText('Verified Workloads', { exact: true }), 'workload workspace')
  await visible(page.getByText('conv2d-intel14', { exact: true }).first(), 'default verified workload')

  await nav.getByRole('link', { name: 'Experiments', exact: true }).click()
  const experiment = page.locator('.experiment-modal')
  await visible(experiment.getByText('Hardware Experiment', { exact: true }), 'experiment workspace')
  await experiment.getByRole('button', { name: 'Apply', exact: true }).click()
  await experiment.getByRole('button', { name: 'Run', exact: true }).click()
  await visible(experiment.getByText('Overall', { exact: true }), 'default experiment result', 120000)
  const resultRows = await experiment.locator('.experiment-results-table tbody tr').count()
  assert(resultRows === 8, `default experiment should produce 8 rows, saw ${resultRows}`)

  const mobileStartedAt = Date.now()
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const mobileScriptRequests = []
  mobile.on('request', request => {
    if (request.resourceType() === 'script') mobileScriptRequests.push(request.url())
  })
  await mobile.goto(`${baseUrl}/?view=workloads`, { waitUntil: 'domcontentloaded' })
  await visible(mobile.getByText('Verified Workloads', { exact: true }), 'mobile workload workspace')
  assert(await mobile.locator('.editor-area').count() === 0, 'mobile workload deep link mounted the editor')
  const mobileVisibleMs = Date.now() - mobileStartedAt
  await mobile.close()

  assert(
    !mobileScriptRequests.some(url => /EditorPanel|editor\.api|monaco-vim/.test(url)),
    'task-only navigation unexpectedly loaded Monaco',
  )
  assert(pageErrors.length === 0, `browser page errors: ${pageErrors.join('; ')}`)

  console.log(`Live backend smoke passed (${baseUrl})`)
  console.log(`root visible=${rootVisibleMs}ms mobile workloads visible=${mobileVisibleMs}ms experiment rows=${resultRows}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (timer) clearTimeout(timer)
  if (browser) await browser.close().catch(() => {})
}
