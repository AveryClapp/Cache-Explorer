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

  await verifyLaunchSurface(url)
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
