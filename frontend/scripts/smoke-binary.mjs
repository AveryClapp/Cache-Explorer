import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { fixtureAnalysis } from './test-binary-hotspots.mjs'
import { validateBundle } from '../src/binary/hotspots.ts'

const browser = await chromium.launch({ executablePath: process.env.CACHE_EXPLORER_BROWSER, chromiumSandbox: true })
const base = process.env.HARDWARE_EXPLORER_TEST_URL || 'http://127.0.0.1:5193'
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true })
    const page = await context.newPage()
    const errors = []
    const uploads = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.method() !== 'GET') uploads.push(request.url()) })
    // Local-only binary import must work even with no backend connection.
    await page.route('**/api/**', route => route.abort())
    await page.goto(`${base}/?view=binary`)
    await page.getByRole('heading', { name: 'Binary profiles', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Execute', exact: true }).count(), 0)
    const input = page.getByLabel('Open binary analysis JSON')
    await input.setInputFiles({ name: 'analysis.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixtureAnalysis())) })
    await page.getByText('Event limit reached', { exact: true }).waitFor()
    await page.locator('summary').filter({ hasText: 'update_world' }).click()
    await page.getByRole('cell', { name: '0x1100', exact: true }).waitFor()
    await page.getByRole('button', { name: /game plugin.dll/ }).click()
    await page.locator('summary').filter({ hasText: 'Unresolved function' }).click()
    await page.getByRole('cell', { name: 'unresolved', exact: true }).waitFor()
    await page.getByLabel('Rank by').selectOption('accesses')
    await page.getByLabel('Find function or RVA').fill('no-such-function')
    assert.equal(await page.getByRole('button', { name: 'Export filtered sites' }).isEnabled(), false)
    await page.getByLabel('Find function or RVA').fill('0x1100')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export filtered sites' }).click()
    const download = await downloadPromise
    const text = await readFile(await download.path(), 'utf8')
    const bundle = validateBundle(JSON.parse(text))
    assert.equal(bundle.codeHotspots.length, 1)
    assert.equal(bundle.codeHotspots[0].location.imageId, `sha256:${'b'.repeat(64)}`)
    assert(!text.includes('/private') && !text.includes('loadedBase'))
    await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":99}') })
    await page.getByRole('alert').waitFor()
    assert((await page.getByRole('alert').textContent()).includes('previous profile is still open'))
    assert.equal(uploads.length, 0, `Unexpected upload: ${uploads}`)
    assert.deepEqual(errors, [])
    await page.getByRole('link', { name: 'Comparisons', exact: true }).click()
    await page.getByRole('link', { name: 'Binary profiles', exact: true }).click()
    await page.getByText('Event limit reached', { exact: true }).waitFor()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert(overflow <= 1, `Page overflows by ${overflow}px at ${viewport.width}px`)
    await page.screenshot({ path: `/tmp/hardware-explorer-binary-${viewport.width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Close profile', exact: true }).click()
    await page.getByRole('heading', { name: 'Bring a Windows x86 capture', exact: true }).waitFor()
    await context.close()
    console.log(`Binary local-file journey, filtering, export, errors and layout passed at ${viewport.width}px.`)
  }
} finally { await browser.close() }
