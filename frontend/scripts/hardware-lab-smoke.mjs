import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { parseScenario } from '../src/lab/scenario.ts'

const base = process.env.HARDWARE_EXPLORER_LAB_URL || 'http://127.0.0.1:5194'
const executablePath = process.env.CACHE_EXPLORER_BROWSER || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome')
const output = await mkdtemp(join(tmpdir(), 'hardware-lab-smoke-'))
const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  const page = await context.newPage()
  const errors = [], requests = [], responses = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().endsWith('/compile')) requests.push(request.postDataJSON()) })
  page.on('response', async response => { if (response.url().endsWith('/compile') && response.ok()) responses.push(await response.json()) })
  await page.goto(`${base}/?view=lab`)
  await page.getByRole('heading', { name: 'Change one assumption. Follow the evidence.' }).waitFor()
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    const navProblems = await page.getByRole('navigation', { name: 'Product' }).evaluate(nav => {
      return [...nav.querySelectorAll('a')].flatMap(link => {
        const box = link.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(link)
        const text = range.getBoundingClientRect()
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return box.left < 0 || box.right > innerWidth || text.left < box.left || text.right > box.right || !link.contains(hit)
          ? [link.textContent] : []
      })
    })
    assert.deepEqual(navProblems, [], `Navigation labels overlap or are obscured at ${width}px`)
  }
  // Playwright clicks scroll programmatically, even inside overflow:hidden.
  // Reach the run action the way a user does: with the wheel, on a laptop-height viewport.
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await page.mouse.move(width / 2, height / 2)
    await page.mouse.wheel(0, 5000)
    await page.waitForTimeout(200)
    const run = await page.getByRole('button', { name: 'Run baseline & scenario', exact: true }).boundingBox()
    assert(run && run.y >= 0 && run.y + run.height <= height, `Run action cannot be scrolled into view at ${width}x${height}`)
    await page.mouse.wheel(0, -5000)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => /monaco|EditorPanel|editor\.api/.test(entry.name))), false, 'Lab must not load the editor')
  await page.getByRole('button', { name: 'Run baseline & scenario', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Comparison complete.' }).waitFor({ timeout: 90000 })
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[0].hardwareLab, {})
  assert.equal(requests[1].hardwareLab['l1d.sizeKB'], '64')
  assert.equal(responses[1].profile.modelConfidence, 'experimental')
  assert.equal(responses[1].provenance.hardwareProfile.validationConfidence, 'uncalibrated')
  await page.getByRole('heading', { name: 'Which source lines moved?' }).waitFor()
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true })
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export scenario', exact: true }).click()
  const download = await downloadEvent
  const path = join(output, 'scenario.json'); await download.saveAs(path)
  const exported = parseScenario(await readFile(path, 'utf8'))
  assert(exported.report && exported.files[0].code.includes('matrix'))
  await page.getByRole('link', { name: 'Profiles', exact: true }).click()
  await page.getByRole('link', { name: 'Hardware Lab', exact: true }).click()
  await page.getByRole('heading', { name: 'Which source lines moved?' }).waitFor()
  const input = page.getByLabel('Import Hardware Lab scenario', { exact: true })
  await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":999}') })
  await page.getByRole('alert').filter({ hasText: 'Unsupported' }).waitFor()
  const beforeImport = requests.length
  await input.setInputFiles(path)
  await page.getByRole('status').filter({ hasText: 'Imported locally.' }).waitFor()
  assert.equal(requests.length, beforeImport, 'Import must never auto-execute code')
  await page.getByRole('button', { name: 'Run baseline & scenario', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Comparison complete.' }).waitFor({ timeout: 90000 })
  assert.equal(requests.length, 4)
  assert.deepEqual(requests[0].files, requests[2].files)
  assert.deepEqual(requests[1].hardwareLab, requests[3].hardwareLab)
  await context.setOffline(true)
  await input.setInputFiles(path)
  await page.getByRole('status').filter({ hasText: 'Imported locally.' }).waitFor()
  assert.equal(requests.length, 4, 'Offline report viewing must not execute')
  await context.setOffline(false)
  await page.route('**/compile', route => route.abort('failed'))
  await page.getByRole('button', { name: 'Run baseline & scenario', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Which source lines moved?' }).count(), 0, 'A failed replay must not show stale results as current')
  await page.unroute('**/compile')
  let pendingRoute
  await page.route('**/compile', route => { pendingRoute = route })
  await page.getByRole('button', { name: 'Run baseline & scenario', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel comparison', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Run cancelled or timed out.' }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Which source lines moved?' }).count(), 0)
  await pendingRoute?.abort().catch(() => {})
  await context.close()

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
  const mobilePage = await mobile.newPage()
  mobilePage.on('pageerror', error => errors.push(error.message))
  await mobilePage.goto(`${base}/?view=lab`)
  await mobilePage.getByRole('heading', { name: 'Change one assumption. Follow the evidence.' }).waitFor()
  assert(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'Mobile layout overflows the viewport')
  await mobilePage.getByRole('button', { name: 'Huge pages', exact: true }).click()
  assert.equal(await mobilePage.getByRole('spinbutton', { name: 'Page size (bytes)', exact: true }).inputValue(), '2097152')
  await mobilePage.getByRole('button', { name: 'Run baseline & scenario', exact: true }).click()
  await mobilePage.getByRole('status').filter({ hasText: 'Comparison complete.' }).waitFor({ timeout: 90000 })
  await mobilePage.screenshot({ path: join(output, 'mobile.png'), fullPage: true })
  assert(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
  await mobile.close()
  assert.deepEqual(errors, [])
  console.log(`Hardware Lab responsive navigation, desktop/mobile, real default run, scenario export/replay, offline import, cancellation and failure recovery passed. Evidence: ${output}`)
} finally { await browser.close() }
