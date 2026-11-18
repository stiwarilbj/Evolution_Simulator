import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { LEGACY_RULE_VERSION, REFUGE_RULE_VERSION, starter, WALKTHROUGH_RULE_VERSION } from '../src/engine/config.js'
import { guideSource } from '../src/guide-replay.js'

async function openSimulator(page) {
  await page.addInitScript(() => localStorage.setItem('evolution.tour', '1'))
  await page.goto('./')
}

async function startRun(page, days = '10', configure) {
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await page.getByLabel('Run name').fill('Browser test run')
  await page.getByRole('spinbutton', { name: 'Days to run' }).fill(days)
  await configure?.()
  await page.getByRole('button', { name: /^Watch live/ }).click()
  await page.getByRole('button', { name: 'Evolve!' }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText(`Day 1 / ${days} · Ready`)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
}

async function fixedDay(page, seconds = '10') {
  await page.getByRole('combobox', { name: 'End each day' }).selectOption('timed')
  await page.getByRole('spinbutton', { name: 'Seconds per day', exact: true }).fill(seconds)
}

async function stepTo(page, seconds) {
  await page.getByRole('button', { name: 'Playback actions' }).click()
  await page.getByRole('button', { name: 'Step one tick', exact: true }).click()
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })
  await expect.poll(async () => Number(await elapsed.getAttribute('aria-valuenow'))).toBeCloseTo(seconds)
}

async function savedManualProgress(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('evolution-simulator', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const transaction = db.transaction('runs', 'readonly')
      const get = transaction.objectStore('runs').get(localStorage.getItem('evolution.active'))
      transaction.onabort = () => { db.close(); reject(transaction.error) }
      transaction.oncomplete = () => {
        db.close()
        const run = get.result
        resolve(run && { tick: run.partial?.tick ?? null, days: run.summaries.map(row => row.day) })
      }
    }
  }))
}

async function quickThrough(page, day, trigger = 'Quick Sim') {
  await page.getByRole('button', { name: trigger, exact: true }).click()
  await page.getByRole('button', { name: 'Complete through day' }).click()
  await page.getByLabel('Target day').fill(String(day))
  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
}

function batchStatus(page, label) {
  return page.getByRole('dialog').locator('dt').filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]')
}

function dayTile(page, day) {
  return page.getByRole('button', { name: new RegExp(`^Day ${day}, population`) })
}

async function openRunLibrary(page) {
  await page.getByRole('button', { name: 'Run options' }).click()
  await page.getByRole('button', { name: 'Run Library' }).click()
}

async function startRefugeFixture(page, configure) {
  const setup = { ...starter(REFUGE_RULE_VERSION), name:'Browser test run', days:10, mode:'live' }
  configure?.(setup)
  await openRunLibrary(page)
  await page.getByRole('dialog', { name:'Run Library' }).locator('input[type=file]').setInputFiles({
    name:'refuge-rules.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(setup)),
  })
  await page.getByRole('button', { name:'Evolve!' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 1 / 10 · Ready')
}

function historicalCohort(setup) {
  setup.endMode = 'timed'
  setup.food = 400
  Object.assign(setup.species[1], { enabled:true, energy:1000 })
}

async function fieldColors(page, canvas) {
  const screenshot = await canvas.screenshot({ scale:'css' })
  return page.evaluate(async encoded => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + encoded
    await image.decode()
    const sample = document.createElement('canvas')
    sample.width = image.width
    sample.height = image.height
    const ctx = sample.getContext('2d')
    ctx.drawImage(image, 0, 0)
    // World overhead keeps 600 field units in the shorter canvas dimension.
    const scale = Math.min(image.width, image.height) / 600
    const tone = (x, y) => {
      const pixels = ctx.getImageData(
        Math.round(image.width / 2 + x * scale) - 2, Math.round(image.height / 2 + y * scale) - 2, 5, 5).data
      return Array.from({ length:25 }, (_, i) => pixels[4 * i]).sort((a,b) => a - b)[12]
    }
    return {
      sides: [[-225,0],[0,-225],[225,0],[0,225]].map(([x,y]) => tone(x,y)),
      corners: [[-225,-225],[225,-225],[225,225],[-225,225]].map(([x,y]) => tone(x,y)),
      interior: tone(0,0),
    }
  }, screenshot.toString('base64'))
}

async function installSaveDelay(page) {
  await page.addInitScript(() => {
    const onComplete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')
    const saves = window.saveTest = { hold: false, pending: [] }
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      ...onComplete,
      set(handler) {
        onComplete.set.call(this, event => {
          if (saves.hold && this.mode === 'readwrite') saves.pending.push(() => handler.call(this, event))
          else handler.call(this, event)
        })
      },
    })
  })
}

async function releaseSaves(page) {
  await page.evaluate(() => {
    const saves = window.saveTest
    saves.hold = false
    for (const release of saves.pending.splice(0)) release()
  })
}

async function addFoodPoint(page, day, plants) {
  await page.getByRole('button', { name: 'Add point', exact: true }).click()
  const row = page.locator('.schedule-row').last()
  await row.getByRole('spinbutton', { name: 'Day', exact: true }).fill(String(day))
  await row.getByRole('spinbutton', { name: 'Plants', exact: true }).fill(String(plants))
}

async function delayReplays(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const jobs = new Map()
    const received = []
    window.replayTest = { jobs, received }
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (data.type !== 'replay') return super.postMessage(data)
        const receive = event => {
          if (event.data.type === 'replay-progress') return
          received.push(event.data.day ?? data.day)
          this.removeEventListener('message', receive)
        }
        jobs.set(data.day, {
          release: () => {
            this.addEventListener('message', receive)
            super.postMessage(data)
          },
          progress: () => this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'replay-progress', id: data.id },
          })),
          fail: () => this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'error', id: data.id, message: 'Replay unavailable' },
          })),
        })
      }
    }
  })
}

async function finishReplay(page, day, action = 'release') {
  await expect.poll(() => page.evaluate(day => window.replayTest.jobs.has(day), day)).toBe(true)
  await page.evaluate(({ day, action }) => {
    const job = window.replayTest.jobs.get(day)
    window.replayTest.jobs.delete(day)
    job[action]()
  }, { day, action })
  if (action === 'release') {
    await expect.poll(() => page.evaluate(day => window.replayTest.received.includes(day), day)).toBe(true)
  }
}

test('the production build runs a new experiment and shows its charts @pages', async ({ page, context, request, baseURL }) => {
  test.setTimeout(90000)
  const app = new URL(baseURL)
  const problems = []
  page.on('pageerror', error => problems.push(error.message))
  const isAppRequest = address => address.startsWith(app.href)
  context.on('response', response => {
    if (isAppRequest(response.url()) && !response.ok() && response.status() >= 400) problems.push(response.url())
  })
  context.on('requestfailed', failed => {
    if (isAppRequest(failed.url())) problems.push(failed.url())
  })
  if (process.env.PAGES_URL) {
    const built = await readFile('dist/index.html', 'utf8')
    const entry = built.match(/<script type="module"[^>]* src="([^"]+)"/)?.[1]
    expect(entry).toBeTruthy()
    await expect.poll(async () => (await request.get('./')).text(), { timeout: 45000 }).toContain(entry)
  }
  await openSimulator(page)
  await expect(page.getByRole('heading', { name: 'Current Generation Stats' })).toBeVisible()
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Random seed' }).fill('118')
    const size = page.getByRole('spinbutton', { name: 'σ Size', exact: true })
    const sizeRow = page.locator('.variance-row').filter({ has: size })
    await size.fill('1.00')
    await expect(sizeRow.getByText('Variance (σ²) = 1', { exact: true })).toBeVisible()
    await size.fill('0.50')
    await expect(sizeRow.getByText('Variance (σ²) = 0.25', { exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'End each day' })).toHaveValue('settled')
    await page.getByRole('button', { name: /^Refill rewards/ }).click()
    await expect(page.getByRole('spinbutton', { name: 'Plant reward' })).toHaveValue('0')
    await expect(page.getByRole('spinbutton', { name: 'Prey reward' })).toHaveValue('0')
    await page.getByRole('button', { name: /^Advanced Rules/ }).click()
    await expect(page.getByText('A hunter must be at least 25% larger than its prey.')).toBeVisible()
  })
  await quickThrough(page, 3)
  await expect(page.getByRole('heading', { name: 'Simulation complete' })).toBeVisible()
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.getByText(/Browser test run .* Through Day 3/)).toBeVisible()
  await expect(page.locator('.trends canvas').first()).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(app.pathname)
  expect(problems).toEqual([])
})

test('the four gray home sides and corners stay visible during replay and in Canvas @pages', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await expect(page).toHaveTitle('Evolution Simulator')
  await startRun(page)
  const field = page.getByRole('region', { name:'Simulation field' })
  const canvas = field.locator('canvas.world-canvas')
  const overhead = async () => {
    await page.getByRole('button', { name:'View options' }).click()
    await page.getByRole('button', { name:/^Overhead/ }).click()
  }
  const painted = { sides:[229,229,229,229], corners:[229,229,229,229], interior:255 }
  await overhead()
  await expect(field.getByText('Canvas view', { exact:true })).toHaveCount(0)
  await expect.poll(() => fieldColors(page, canvas)).toEqual(painted)

  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name:'Watch last day' }).click()
  const time = page.getByRole('slider', { name:'Replay time' })
  await expect(time).toBeVisible()
  await time.fill('0')
  await expect.poll(() => fieldColors(page, canvas)).toEqual(painted)
  await page.getByRole('button', { name:'Layers', exact:true }).click()
  await page.getByRole('button', { name:'More layer options' }).click()
  await page.getByRole('checkbox', { name:'Show refuges' }).check()
  await page.getByRole('button', { name:'Back to layers' }).click()
  await page.getByRole('button', { name:'Close layers' }).click()

  await page.setViewportSize({ width:680, height:600 })
  const settings = await page.getByRole('button', { name:'Simulation Settings' }).boundingBox()
  expect((await canvas.boundingBox()).y).toBeGreaterThan(settings.y + settings.height)
  const lost = await canvas.evaluate(element => {
    const extension = element.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    extension?.loseContext()
    return !!extension
  })
  expect(lost).toBe(true)
  await expect(field.getByText('Canvas view', { exact:true })).toBeVisible()
  await expect.poll(() => fieldColors(page, canvas)).toEqual(painted)
  await page.getByRole('button', { name:'Next day' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 2 / 10 · Ready')
  await expect.poll(() => fieldColors(page, canvas)).toEqual(painted)

  await openRunLibrary(page)
  const legacy = { ...starter(WALKTHROUGH_RULE_VERSION), mode:'live', days:10 }
  await page.getByRole('dialog', { name:'Run Library' }).locator('input[type=file]').setInputFiles({
    name:'old-rules.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(legacy)),
  })
  await page.getByRole('button', { name:'Evolve!' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 1 / 10 · Ready')
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name:'Watch last day' }).click()
  await expect(time).toBeVisible()
  await time.fill('0')
  if (!(await page.locator('.world').getAttribute('class')).includes('is-overhead')) await overhead()
  await expect.poll(() => fieldColors(page, canvas)).toEqual({
    sides:[255,255,255,255], corners:[255,255,255,255], interior:255,
  })
  expect(errors).toEqual([])
})

test('live generations end when settled and Quick Sim stops at the extinction tile @pages', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await startRefugeFixture(page, setup => Object.assign(setup, { seed:6, food:10 }))
  await expect(page.getByText('0.00 s elapsed')).toBeVisible()
  await page.getByRole('button', { name: 'Play through generations' }).click()
  const speed = page.getByRole('button', { name: 'Viewing speed', exact: true })
  await speed.click()
  await page.getByRole('slider', { name: 'Viewing speed multiplier' }).fill('12')
  await speed.click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const runStatus = page.getByRole('button', { name: 'Run options' })
  await expect(runStatus).toHaveText('Day 1 / 10 · Final')
  await expect(page.getByRole('progressbar', { name: 'Current day elapsed' })).toHaveAttribute('aria-valuemax', '5')
  await page.getByRole('button', { name: 'Next day' }).click()
  await expect(runStatus).toHaveText('Day 2 / 10 · Ready')

  await quickThrough(page, 10)
  await expect(page.getByRole('heading', { name: 'Population extinct' })).toBeVisible()
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 4')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const tile = page.getByRole('button', { name: /Extinct on Day 4/ })
  await expect(tile.locator('svg')).toBeVisible()
  await expect(tile.locator('xpath=preceding-sibling::*[1]')).toHaveAttribute('data-day', '4')
  await expect(dayTile(page, 5)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Quick Sim', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'More Generations' })).toHaveCount(0)

  await dayTile(page, 3).click()
  await tile.click()
  const time = page.getByRole('slider', { name: 'Replay time' })
  await expect(time).toHaveValue('6.7')
  await page.reload()
  await expect(tile).toBeVisible()
  await expect(time).toHaveValue('6.7')
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.getByText(/Browser test run .* Through Day 4/)).toBeVisible()
  expect(errors).toEqual([])
})

test('preparing a run that goes extinct on Day 1 opens its final replay', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await page.getByRole('spinbutton', { name: 'Energy', exact: true }).fill('10')
  await page.getByRole('button', { name: /^Prepare and watch/ }).click()
  await page.getByRole('button', { name: 'Evolve!' }).click()

  await expect(page.getByRole('button', { name: /Extinct on Day 1/ })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Replay time' })).toHaveValue('0.1')
  await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled()
  await page.getByRole('button', { name: 'Run options' }).click()
  await expect(page.getByRole('button', { name: 'Branch here' })).toBeDisabled()
})

test('World fits split windows and keeps its controls in full screen', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  const stats = page.getByRole('heading', { name: 'Current Generation Stats' })
  const timeline = page.getByRole('button', { name: 'Day 1, live', exact: true })
  const quick = page.getByRole('button', { name: 'Quick Sim', exact: true })
  const view = page.getByRole('button', { name: 'View options' })

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 720, height: 540 },
    { width: 512, height: 480 },
    { width: 320, height: 420 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(stats).toBeInViewport({ ratio: 1 })
    await expect(timeline).toBeInViewport({ ratio: 1 })
    await expect(quick).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => {
      const nav = document.querySelector('.app-header nav').getBoundingClientRect()
      const run = document.querySelector('.run-center').getBoundingClientRect()
      return nav.right <= run.left || nav.bottom <= run.top
    })).toBe(true)
    const exactValues = page.getByRole('button', { name: 'Exact values' })
    if (await exactValues.isVisible()) {
      const legend = await exactValues.boundingBox()
      const ribbon = await page.locator('.ribbon').boundingBox()
      expect(legend.y + legend.height).toBeLessThanOrEqual(ribbon.y + ribbon.height)
    }
    await expect.poll(() => page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }))).toEqual(viewport)
  }

  await view.click()
  await page.getByRole('button', { name: 'Full screen', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('world'))).toBe(true)
  await expect(stats).toBeInViewport({ ratio: 1 })
  await expect(timeline).toBeInViewport({ ratio: 1 })
  await quick.click()
  await expect(page.getByRole('dialog', { name: 'Quick Sim' })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await view.click()
  await page.getByRole('button', { name: 'Exit full screen' }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)

  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.click()
  const food = page.getByRole('heading', { name: 'Food', exact: true })
  await food.scrollIntoViewIfNeeded()
  await expect(food).toBeInViewport({ ratio: 1 })
  await expect(trends).toBeInViewport({ ratio: 1 })
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('World shows hunting and resting thoughts and keeps one speed scale across days @pages', async ({ page }) => {
  await openSimulator(page)
  await page.emulateMedia({ reducedMotion:'reduce' })
  const { setup } = guideSource('hunt')
  Object.assign(setup, { mode:'live', days:10 })
  await openRunLibrary(page)
  await page.getByRole('dialog', { name:'Run Library' }).locator('input[type=file]').setInputFiles({
    name:'hunt.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(setup)),
  })
  await page.getByRole('button', { name:'Evolve!' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 1 / 10 · Ready')
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name:'Close', exact:true }).click()
  await dayTile(page, 1).click()

  const time = page.getByRole('slider', { name:'Replay time' })
  await expect(time).toHaveValue('0')
  await page.getByRole('button', { name:'Layers', exact:true }).click()
  await page.getByRole('button', { name:'Color by speed' }).click()
  await page.getByRole('button', { name:'Close layers' }).click()
  const bounds = page.locator('.speed-key div span')
  await expect(bounds).toHaveText(['8.89', '11.43'])
  await page.getByRole('combobox', { name:'Generation statistics species' }).selectOption('orange')
  await expect(bounds).toHaveText(['8.89', '11.43'])

  await page.getByRole('button', { name:'View options' }).click()
  await page.getByRole('button', { name:'Creatures', exact:true }).click()
  const details = page.getByRole('complementary', { name:'Creature details' })
  await details.getByRole('combobox', { name:'Creature', exact:true }).selectOption('51')
  await details.getByRole('button', { name:'Close creature details' }).click()
  await time.fill('0.2')
  await expect(page.getByRole('button', { name:'Creature thought · Chasing' }).locator('.lucide-utensils')).toBeVisible()
  await time.fill('0.5')
  await expect(page.getByRole('button', { name:'Creature thought · Home' }).getByText('zzz')).toBeVisible()
  await expect(page.getByRole('button', { name:'Current creature details · Orange · #51' })).toBeVisible()

  await dayTile(page, 3).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 3 / 10 · Replay')
  await expect(time).toHaveValue('0')
  await expect(bounds).toHaveText(['8.89', '11.43'])
})

test('World restores layers for every creature after clearing a selection', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  const layers = page.getByRole('button', { name: 'Layers', exact: true })
  const moreLayers = page.getByRole('button', { name: 'More layer options' })
  const sense = page.getByRole('button', { name: 'Sense range', exact: true })
  const selectedOnly = page.getByRole('checkbox', { name: 'Selected creature only' })

  await page.getByRole('button', { name: 'Follow creature' }).click()
  await layers.click()
  await sense.click()
  await moreLayers.click()
  await selectedOnly.check()

  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('button', { name: 'Creatures', exact: true }).click()
  const details = page.getByRole('complementary', { name: 'Creature details' })
  await details.getByRole('combobox', { name: 'Creature', exact: true }).selectOption('')
  await details.getByRole('button', { name: 'Close creature details' }).click()

  await layers.click()
  await expect(sense).toHaveAttribute('aria-pressed', 'true')
  await moreLayers.click()
  await expect(selectedOnly).toBeDisabled()
  await expect(selectedOnly).not.toBeChecked()
})

test('World continues drawing live playback after losing WebGL', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))

  const field = page.getByRole('region', { name: 'Simulation field' })
  const canvas = field.locator('canvas.world-canvas')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const time = page.getByRole('progressbar', { name: 'Current day elapsed' })
  const elapsed = async () => Number(await time.getAttribute('aria-valuenow'))
  await expect.poll(elapsed).toBeGreaterThan(0)
  const lost = await canvas.evaluate(element => {
    const extension = element.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    extension?.loseContext()
    return !!extension
  })
  expect(lost).toBe(true)
  await expect(field.getByText('Canvas view', { exact: true })).toBeVisible()
  await expect.poll(() => canvas.evaluate(element => {
    const context = element.getContext('2d')
    const pixel = context?.getImageData(element.width / 2, element.height / 2, 1, 1).data
    return !!pixel && pixel[0] > 150 && pixel[3] === 255
  })).toBe(true)
  const fallbackTime = await elapsed()
  const startingImage = await canvas.evaluate(element => element.toDataURL())

  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
  await expect.poll(elapsed).toBeGreaterThan(fallbackTime)
  await expect.poll(() => canvas.evaluate((element, image) => element.toDataURL() !== image, startingImage)).toBe(true)
  expect(errors).toEqual([])
})

test('slow live playback draws intermediate poses and replay seeks directly to the requested pose', async ({ page }) => {
  await page.addInitScript(() => {
    const motion = window.motionTest = { time:0, poses:[] }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args)
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'frame') motion.time = data.frame.time
        })
      }
    }
    const painter = CanvasRenderingContext2D.prototype
    const originals = { clear:painter.fillRect, fill:painter.fill, ellipse:painter.ellipse, gradient:painter.createLinearGradient }
    const bodyGradients = new WeakSet()
    let seen = false, center
    painter.fillRect = function (...args) {
      if (this.canvas.classList.contains('world-canvas') && this.fillStyle === '#242424') seen = false
      return originals.clear.apply(this, args)
    }
    painter.ellipse = function (x, y, ...args) {
      if (this.canvas.classList.contains('world-canvas')) center = [x.toFixed(2), y.toFixed(2)].join(',')
      return originals.ellipse.call(this, x, y, ...args)
    }
    painter.createLinearGradient = function (...args) {
      const gradient = originals.gradient.apply(this, args)
      if (this.canvas.classList.contains('world-canvas')) bodyGradients.add(gradient)
      return gradient
    }
    painter.fill = function (...args) {
      if (!seen && bodyGradients.has(this.fillStyle)) {
        motion.poses.push({ time:motion.time, center })
        seen = true
      }
      return originals.fill.apply(this, args)
    }
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  const field = page.getByRole('region', { name:'Simulation field' })
  const canvas = field.locator('canvas.world-canvas')
  await page.getByRole('button', { name:'View options' }).click()
  await page.getByRole('button', { name:/^Overhead/ }).click()
  const nextPaint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const position = () => page.evaluate(() => window.motionTest.poses.at(-1)?.center)
  await nextPaint()
  const initial = await canvas.screenshot()
  const elapsed = page.getByRole('progressbar', { name:'Current day elapsed' })
  const readTime = async () => Number(await elapsed.getAttribute('aria-valuenow'))
  const play = page.getByRole('button', { name:'Play', exact:true })
  const pause = page.getByRole('button', { name:'Pause', exact:true })
  await play.click()
  await expect.poll(readTime).toBeGreaterThan(.2)
  await pause.click()
  expect((await canvas.screenshot()).equals(initial)).toBe(false)

  await canvas.evaluate(element => element.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext())
  await expect(field.getByText('Canvas view', { exact:true })).toBeVisible()
  const speed = page.getByRole('button', { name:'Viewing speed', exact:true })
  await speed.click()
  const slider = page.getByRole('slider', { name:'Viewing speed multiplier' })
  await slider.fill('0')
  await speed.click()
  await page.evaluate(() => { window.motionTest.poses = [] })
  await play.click()
  await expect.poll(() => page.evaluate(() => {
    const { poses, time } = window.motionTest
    return new Set(poses.filter(pose => pose.time === time).map(pose => pose.center)).size
  })).toBeGreaterThan(6)
  await pause.click()
  await nextPaint()
  const settled = await position()
  await nextPaint()
  expect(await position()).toBe(settled)
  const pausedTime = await readTime()
  await page.getByRole('button', { name:'Playback actions' }).click()
  await page.getByRole('button', { name:'Step one tick', exact:true }).click()
  await expect.poll(readTime).toBeGreaterThan(pausedTime)
  await expect.poll(position).not.toBe(settled)
  await speed.click()
  await slider.fill('12')
  await speed.click()
  const before = await readTime()
  await play.click()
  await expect.poll(readTime).toBeGreaterThan(before + .5)
  await pause.click()

  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name:'Watch last day' }).click()
  const replayTime = page.getByRole('slider', { name:'Replay time' })
  await replayTime.fill('0')
  await expect(replayTime).toHaveValue('0')
  await nextPaint()
  const dawn = await position()
  await replayTime.fill('0.5')
  await expect.poll(position).not.toBe(dawn)
  await replayTime.fill('0')
  await expect.poll(position).toBe(dawn)
  await page.getByRole('button', { name:'Next day' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 2 / 10 · Ready')
  expect(errors).toEqual([])
})

test('Mini line shows a point as soon as the first day is completed', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Generation options' }).click()
  await page.getByRole('button', { name: 'Mini line', exact: true }).click()
  await page.locator('.flower-legend').getByRole('button', { name: 'Population', exact: true }).click()

  const chart = page.locator('.ribbon-line')
  await expect(chart.locator('path')).toHaveAttribute('d', /^\s*M[^L]*$/)
  await expect(chart.locator('circle')).toHaveCount(1)
  await expect(chart.locator('circle')).toBeVisible()
  await expect(chart.locator('circle')).toHaveAttribute('cx', '50')

  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(chart.locator('circle')).toHaveCount(3)
  await expect(chart.locator('path')).toHaveAttribute('d', /M.*L.*L/)
})

test('Mini line points stay above their generation tiles when the window shrinks', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Generation options' }).click()
  await page.getByRole('button', { name: 'Mini line', exact: true }).click()

  const line = page.locator('.ribbon-line path')
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 640, height: 750 },
    { width: 512, height: 480 },
  ]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => line.evaluate(path => {
      const screen = path.getScreenCTM()
      const endpoints = [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())]
      const tiles = [1, 3].map(day => document.querySelector(`.day-tile[data-day="${day}"]`).getBoundingClientRect())
      return Math.max(...tiles.map(({ left, width }, i) =>
        Math.abs(endpoints[i].matrixTransform(screen).x - (left + width / 2))))
    }), { message: `Chart alignment at ${viewport.width} × ${viewport.height}` }).toBeLessThan(1)
  }
})

test('Mini line can plot Population and Age at Death', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const options = page.getByRole('button', { name: 'Generation options' })
  const legend = page.locator('.flower-legend')
  const population = legend.getByRole('button', { name: 'Population', exact: true })
  const deathAge = legend.getByRole('button', { name: 'Age at Death', exact: true })
  const line = page.locator('.ribbon-line path')
  const table = page.getByRole('dialog', { name: 'Generation statistics' })

  await options.click()
  await page.getByRole('button', { name: 'Mini line', exact: true }).click()
  await population.click()
  await expect(table).toBeHidden()
  await expect(population).toHaveAttribute('aria-pressed', 'true')
  await expect(line).toHaveAttribute('stroke', '#EEEDD6')
  await expect(line).toHaveAttribute('d', /M.*L/)

  await page.setViewportSize({ width: 512, height: 480 })
  await deathAge.click()
  await expect(deathAge).toHaveAttribute('aria-pressed', 'true')
  await expect(population).toHaveAttribute('aria-pressed', 'false')
  await expect(line).toHaveAttribute('stroke', '#DDDAD0')
  await expect(line).toHaveAttribute('d', /M/)
  const exactValues = legend.getByRole('button', { name: 'Exact values', exact: true })
  await expect(exactValues).toBeInViewport({ ratio: 1 })
  await exactValues.click()
  await expect(table).toBeVisible()
  await table.getByRole('button', { name: 'Done', exact: true }).click()

  await options.click()
  await page.getByRole('button', { name: /Walkthrough flower/ }).click()
  await population.click()
  await expect(table).toBeVisible()
})

test('browser Back closes a focused Trends chart and restores World controls', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  const worldUrl = page.url()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const trendsUrl = page.url()
  const focus = page.getByRole('button', { name: 'Focus Population', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Focused chart' })
  await focus.click()
  await expect(dialog).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(worldUrl)
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Quick Sim' })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()

  await page.goForward()
  await expect(page).toHaveURL(trendsUrl)
  await expect(dialog).toBeHidden()
  await focus.click()
  await expect(dialog).toBeVisible()
})

test('Trends marks the food rules used on each completed day of a branch', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByLabel('Food schedule').selectOption('step')
    await addFoodPoint(page, 3, 25)
    await addFoodPoint(page, 5, 45)
    await addFoodPoint(page, 8, 90)
  })
  await quickThrough(page, 5)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 5')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.click()
  const markers = page.locator('.trend-annotations span')
  await expect(markers).toHaveText([/Day 3 · 25 plants/, /Day 5 · 45 plants/])

  const runOptions = page.getByRole('button', { name: 'Run options' })
  await runOptions.click()
  await page.getByRole('button', { name: 'Branch here', exact: true }).click()
  await page.getByLabel('Branch after day').fill('4')
  await page.getByRole('button', { name: 'Edit branch rules' }).click()
  await page.getByLabel('Food schedule').selectOption('step')
  await addFoodPoint(page, 2, 70)
  await addFoodPoint(page, 5, 70)
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await expect(runOptions).toHaveText('Day 5 / 10 · Ready')
  await quickThrough(page, 6)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 6')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await trends.click()
  await expect(markers).toHaveText([/Day 3 · 25 plants/, /Day 5 · Branch · 70 plants/])
  await page.reload()
  await expect(markers).toHaveText([/Day 3 · 25 plants/, /Day 5 · Branch · 70 plants/])
})

test('a food-only branch keeps the day length at the fork', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await quickThrough(page, 2)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  const runOptions = page.getByRole('button', { name: 'Run options' })
  const branch = page.getByRole('button', { name: 'Branch here', exact: true })
  const create = page.getByRole('button', { name: 'Create branch', exact: true })
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })

  await runOptions.click()
  await branch.click()
  await page.getByLabel('Branch after day').fill('2')
  await page.getByRole('button', { name: 'Edit branch rules' }).click()
  await page.getByRole('spinbutton', { name: 'Seconds per day', exact: true }).fill('2')
  await create.click()
  await expect(runOptions).toHaveText('Day 3 / 10 · Ready')
  await expect(elapsed).toHaveAttribute('aria-valuemax', '2')
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await runOptions.click()
  await branch.click()
  await page.getByLabel('Branch after day').fill('2')
  await page.getByLabel('Plants per day').fill('70')
  await create.click()
  await expect(runOptions).toHaveText('Day 3 / 10 · Ready')
  await expect(elapsed).toHaveAttribute('aria-valuemax', '10')
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await expect(page.getByRole('slider', { name: 'Replay time' })).toHaveAttribute('max', '10')
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.locator('.trend-annotations span')).toHaveText([/Day 3 · Branch · 70 plants/])
})

test('a branch defaults to the plant supply recorded on the selected day', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByLabel('Food schedule').selectOption('step')
    await addFoodPoint(page, 3, 25)
    await addFoodPoint(page, 5, 70)
  })
  await quickThrough(page, 5)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 5')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  const run = page.getByRole('button', { name: 'Run options' })
  const branch = page.getByRole('button', { name: 'Branch here', exact: true })
  const day = page.getByLabel('Branch after day')
  const plants = page.getByLabel('Plants per day')
  await run.click()
  await branch.click()
  await expect(day).toHaveValue('5')
  await expect(plants).toHaveValue('70')
  await day.fill('4')
  await expect(plants).toHaveValue('25')
  await plants.fill('85')
  await day.fill('2')
  await expect(plants).toHaveValue('85')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await run.click()
  await branch.click()
  await day.fill('4')
  await expect(plants).toHaveValue('25')
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await expect(run).toHaveText('Day 5 / 10 · Ready')
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('checkbox', { name: 'HUD' }).check()
  await expect(page.locator('.world-hud')).toContainText('Plants left 25')
})

test('earlier completed days can be branched from the run limit', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  const runOptions = page.getByRole('button', { name: 'Run options' })
  const branch = page.getByRole('button', { name: 'Branch here', exact: true })
  const branchDay = page.getByLabel('Branch after day')

  await runOptions.click()
  await expect(branch).toBeDisabled()
  await runOptions.click()
  await quickThrough(page, 9)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 9')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(runOptions).toHaveText('Day 10 / 10 · Ready')
  await runOptions.click()
  await expect(branch).toBeEnabled()
  await branch.click()
  await expect(branchDay).toHaveValue('9')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await quickThrough(page, 10)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 10')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await expect(runOptions).toHaveText('Day 10 / 10 · Replay')
  await runOptions.click()
  await branch.click()
  await expect(branchDay).toHaveAttribute('max', '9')
  await expect(branchDay).toHaveValue('9')
  await page.getByLabel('Plants per day').fill('70')
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await expect(runOptions).toHaveText('Day 10 / 10 · Ready')
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.getByText(/Browser test run · branch .* Through Day 9/)).toBeVisible()
})

async function startDelayedBranch(page) {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
}

async function openDayTwoBranch(page) {
  await page.getByRole('button', { name: 'Run options' }).click()
  await page.getByRole('button', { name: 'Branch here', exact: true }).click()
  await page.getByLabel('Branch after day').fill('2')
}

for (const exit of ['Cancel', 'Close settings', 'browser Back']) {
  test(`a pending branch is discarded on ${exit}`, async ({ page }) => {
    await startDelayedBranch(page)
    const sourceId = await page.evaluate(() => localStorage.getItem('evolution.active'))
    const trends = page.getByRole('link', { name: 'Trends', exact: true })
    if (exit === 'browser Back') {
      await trends.click()
      await page.getByRole('link', { name: 'World', exact: true }).click()
    }
    await openDayTwoBranch(page)
    if (exit === 'Close settings') await page.getByRole('button', { name: 'Edit branch rules' }).click()
    const submit = page.getByRole('button', { name: 'Create branch', exact: true })
    await submit.click()
    await expect(page.getByText('Preparing branch from Day 2…')).toBeVisible()
    await expect(submit).toBeDisabled()
    await expect.poll(() => page.evaluate(() => window.replayTest.jobs.has(2))).toBe(true)

    if (exit === 'browser Back') await page.goBack()
    else {
      await page.getByRole('button', { name: exit, exact: true }).click()
      await trends.click()
    }
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(trends).toHaveAttribute('aria-current', 'page')
    const trendsUrl = page.url()
    await finishReplay(page, 2)

    await expect(page).toHaveURL(trendsUrl)
    expect(await page.evaluate(() => localStorage.getItem('evolution.active'))).toBe(sourceId)
    await page.reload()
    await expect(trends).toHaveAttribute('aria-current', 'page')
    await openRunLibrary(page)
    const library = page.getByRole('dialog', { name: 'Run Library' })
    const source = library.locator('article').filter({ has: page.getByText('Browser test run', { exact: true }) })
    await expect(source).toContainText('Active')
    await expect(source).toContainText('Saved through Day 3')
    await expect(library.getByText('Browser test run · branch', { exact: true })).toHaveCount(0)
  })
}

test('a failed branch can be retried without duplicating the new run', async ({ page }) => {
  await startDelayedBranch(page)
  await openDayTwoBranch(page)
  const dialog = page.getByRole('dialog', { name: 'Branch here' })
  const submit = dialog.getByRole('button', { name: 'Create branch', exact: true })
  await submit.click()
  await expect(submit).toBeDisabled()
  await finishReplay(page, 2, 'fail')
  await expect(dialog.getByRole('alert')).toHaveText('Replay unavailable')
  await expect(page.getByLabel('Branch after day')).toHaveValue('2')
  await expect(submit).toBeEnabled()

  await submit.click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await finishReplay(page, 2)
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 3 / 10 · Ready')
  await expect.poll(() => savedManualProgress(page)).toEqual({ tick: null, days: [1, 2] })
  await openRunLibrary(page)
  const library = page.getByRole('dialog', { name: 'Run Library' })
  const branch = library.locator('article').filter({ has: page.getByText('Browser test run · branch', { exact: true }) })
  await expect(branch).toHaveCount(1)
  await expect(branch).toContainText('Active')
  await expect(branch).toContainText('Saved through Day 2')
})

test('Trends downloads the filtered days and checks that CSV bounds are whole days', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  const download = page.getByRole('button', { name: 'Download', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Download' })
  const confirmDownload = dialog.getByRole('button', { name: 'Download', exact: true })
  await trends.click()
  await download.click()
  await expect(confirmDownload).toBeDisabled()
  await dialog.getByRole('button', { name: 'Setup JSON' }).click()
  await expect(confirmDownload).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  await quickThrough(page, 5)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 5')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByLabel('Filter By Species').selectOption('blue')
  await page.getByRole('combobox', { name: /^Range/ }).selectOption('custom')
  await page.getByRole('spinbutton', { name: 'From day' }).fill('2')
  await page.getByRole('spinbutton', { name: 'To day' }).fill('3')
  await download.click()
  const from = dialog.getByLabel('From day')
  await expect(dialog.getByLabel('Scope')).toHaveValue('blue')
  await expect(from).toHaveValue('2')
  await expect(dialog.getByLabel('Through day')).toHaveValue('3')
  await from.fill('2.5')
  await expect(confirmDownload).toBeDisabled()
  await from.fill('2')
  await expect(dialog.getByText('2 data rows')).toBeVisible()

  const pendingDownload = page.waitForEvent('download')
  await confirmDownload.click()
  const file = await pendingDownload
  expect(file.suggestedFilename()).toBe('evolution-results.csv')
  const csv = await readFile(await file.path(), 'utf8')
  const [header, ...data] = csv.split('\r\n').map(line => line.split(',').map(cell => cell.replaceAll('"', '')))
  const dayIndex = header.indexOf('day'), scopeIndex = header.indexOf('scope')
  expect(data.map(row => [row[dayIndex], row[scopeIndex]])).toEqual([['2', 'blue'], ['3', 'blue']])
})

test('downloaded chart PNG keeps the chart readable on a light page', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByRole('button', { name: 'Focus Population', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Focused chart' })
  const chart = dialog.locator('canvas')
  await expect.poll(() => chart.evaluate(canvas => canvas.width)).toBeGreaterThan(0)
  const source = await chart.evaluate(canvas => ({ width: canvas.width, height: canvas.height }))
  const pendingDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download chart PNG', exact: true }).click()
  const file = await pendingDownload
  expect(file.suggestedFilename()).toBe('population.png')

  const png = await readFile(await file.path())
  const result = await page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    image.close()
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const hasLightMarks = pixels.some((value, index) =>
      index % 4 === 0 && value > 200 && pixels[index + 1] > 200 && pixels[index + 2] > 180)
    return {
      width: canvas.width,
      height: canvas.height,
      background: [...pixels.slice(0, 4)],
      hasLightMarks,
    }
  }, png.toString('base64'))
  expect(result).toEqual({ ...source, background: [36, 36, 36, 255], hasLightMarks: true })
})

test('Jump to chart reaches Overview with separate or combined scales', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()

  const jump = page.getByLabel('Jump to chart')
  const separate = page.getByRole('button', { name: 'Separate scales' })
  const combined = page.getByRole('button', { name: 'Combined scales' })
  const surface = page.locator('#main-surface')
  const overviewOffset = () => page.locator('.trends .overview').evaluate(section =>
    section.getBoundingClientRect().top - section.closest('#main-surface').getBoundingClientRect().top)

  await separate.click()
  await expect(combined).toBeVisible()
  await surface.evaluate(element => element.scrollTo(0, 0))
  await expect.poll(overviewOffset).toBeGreaterThan(100)
  await jump.selectOption({ label: 'Overview' })
  await expect.poll(async () => Math.abs(await overviewOffset())).toBeLessThan(2)

  await combined.click()
  await expect(separate).toBeVisible()
  await surface.evaluate(element => element.scrollTo(0, 0))
  await expect.poll(overviewOffset).toBeGreaterThan(100)
  await jump.selectOption({ label: 'Overview' })
  await expect.poll(async () => Math.abs(await overviewOffset())).toBeLessThan(2)
})

test('Trends chart actions stay inside the selected day range', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 5)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 5')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.click()

  const chart = page.getByRole('img', { name: /^Population by generation/ })
  const range = page.getByRole('combobox', { name: 'Range', exact: true })
  const pin = page.getByText('Day 5 · Pinned', { exact: true })
  await chart.press('End')
  await expect(pin).toBeVisible()

  await range.selectOption('custom')
  await page.getByRole('spinbutton', { name: 'From day', exact: true }).fill('2')
  await page.getByRole('spinbutton', { name: 'To day', exact: true }).fill('3')
  await chart.press('Enter')
  await expect(pin).toHaveCount(0)
  await expect(trends).toHaveAttribute('aria-current', 'page')

  await range.selectOption('all')
  await expect(pin).toBeVisible()
  await range.selectOption('custom')
  const firstVisible = page.getByText('Day 2 · Pinned', { exact: true })
  await chart.press('ArrowRight')
  await expect(firstVisible).toBeVisible()
  await chart.press('ArrowRight')
  await expect(page.getByText('Day 3 · Pinned', { exact: true })).toBeVisible()
  await chart.press('ArrowLeft')
  await expect(firstVisible).toBeVisible()
  await chart.press('End')
  await expect(page.getByText('Day 3 · Pinned', { exact: true })).toBeVisible()
  await chart.press('Home')
  await expect(firstVisible).toBeVisible()
  await chart.press('Enter')
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 2 / 10 · Replay')
})

test('Food and Births and Deaths can be hidden and restored by name', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const titles = ['Food', 'Births and Deaths']
  for (const title of titles) {
    await page.getByRole('button', { name: `Hide ${title}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
  }
  for (const title of titles) {
    await page.getByRole('button', { name: `+ ${title}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  }
})

test('Constant food settings can start after shortening a scheduled run', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  const schedule = page.getByLabel('Food schedule')
  await schedule.selectOption('step')
  await addFoodPoint(page, 20, 75)
  await page.getByRole('spinbutton', { name: 'Days to run' }).fill('10')
  await page.getByRole('button', { name: /^Watch live/ }).click()
  const evolve = page.getByRole('button', { name: 'Evolve!' })
  await evolve.click()
  await expect(page.locator('.settings-errors')).toContainText('Use unique days')

  await schedule.selectOption('constant')
  await expect(page.locator('.schedule-row')).toHaveCount(0)
  await expect(page.locator('.settings-errors')).toHaveCount(0)
  await schedule.selectOption('step')
  await expect(page.locator('.schedule-row').getByLabel('Day', { exact: true })).toHaveValue('20')
  await schedule.selectOption('constant')
  await evolve.click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Ready')
})

test('Settings rejects invalid day lengths instead of rounding them', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Simulation Settings' })
  await fixedDay(page)
  const seconds = settings.getByRole('spinbutton', { name: 'Seconds per day', exact: true })
  const evolve = settings.getByRole('button', { name: 'Evolve!' })
  await settings.getByRole('spinbutton', { name: 'Days to run' }).fill('10')
  await settings.getByRole('button', { name: /^Watch live/ }).click()

  for (const [value, error] of [
    ['10.04', 'Enter seconds in tenths.'],
    ['0.99', 'Seconds per day must be from 1 to 60.'],
    ['60.04', 'Seconds per day must be from 1 to 60.'],
  ]) {
    await seconds.fill(value)
    await evolve.click()
    await expect(seconds).toHaveAccessibleDescription(error)
    await expect(seconds).toHaveValue(value)
  }

  await seconds.fill('10.3')
  await evolve.click()
  await expect(settings).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Ready')
  await expect(page.getByRole('progressbar', { name: 'Current day elapsed' })).toHaveAttribute('aria-valuemax', '10.3')
})

test('discarding a settings draft clears its species removal undo', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Simulation Settings' })
  const orange = settings.getByRole('button', { name: /^Orange/ })
  const undo = settings.getByRole('button', { name: 'Undo', exact: true })
  const remove = settings.getByRole('button', { name: 'Remove', exact: true })

  await orange.click()
  await settings.getByText('Species actions', { exact: true }).click()
  await remove.click()
  await expect(orange).toHaveCount(0)
  await expect(undo).toBeVisible()
  await settings.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await settings.getByRole('button', { name: 'Discard draft', exact: true }).click()
  await expect(orange).toHaveCount(1)
  await expect(undo).toHaveCount(0)

  await orange.click()
  await remove.click()
  await expect(orange).toHaveCount(0)
  await undo.click()
  await expect(orange).toHaveCount(1)
})

test('discarding edits to a duplicated run restores the duplicated setup', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByLabel('Run name').fill('Archive source')
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('321')
    await page.getByRole('spinbutton', { name: 'Random seed' }).fill('37')
  })
  await startRun(page)

  await openRunLibrary(page)
  const source = page.getByRole('dialog', { name: 'Run Library' }).locator('article').filter({ hasText: 'Archive source' })
  await source.getByText('Actions', { exact: true }).click()
  await source.getByRole('button', { name: 'Duplicate', exact: true }).click()

  const settings = page.getByRole('dialog', { name: 'Simulation Settings' })
  const name = settings.getByLabel('Run name')
  const food = settings.getByRole('spinbutton', { name: 'Food', exact: true })
  const discard = settings.getByRole('button', { name: 'Discard changes', exact: true })
  await expect(name).toHaveValue('Archive source copy')
  await expect(food).toHaveValue('321')
  await expect(discard).toHaveCount(0)
  await name.fill('Working title')
  await food.fill('444')

  await settings.getByRole('button', { name: 'Close settings' }).click()
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await expect(name).toHaveValue('Working title')
  await expect(food).toHaveValue('444')
  await settings.getByRole('button', { name: /^Advanced Rules/ }).click()
  const foraging = settings.getByRole('combobox', { name: 'Foraging rules' })
  await foraging.selectOption('walkthrough')
  await discard.click()
  await settings.getByRole('button', { name: 'Discard draft', exact: true }).click()
  await expect(name).toHaveValue('Archive source copy')
  await expect(food).toHaveValue('321')
  await expect(foraging).toHaveValue('standard')
  await expect(settings.getByRole('spinbutton', { name: 'Random seed' })).toHaveValue('37')
  await expect(discard).toHaveCount(0)
})

test('mutation profiles follow the selected species and its trait switches', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await page.getByRole('button', { name: /^Advanced Rules/ }).click()
  const profile = page.getByLabel('Mutation profile')
  const size = page.getByRole('checkbox', { name: 'Allow size mutation' })
  const sense = page.getByRole('checkbox', { name: 'Allow sense mutation' })

  await profile.selectOption('speed')
  await expect(size).not.toBeChecked()
  await expect(sense).not.toBeChecked()

  await page.getByRole('button', { name: /^Orange/ }).click()
  await expect(size).toBeChecked()
  await expect(profile).toHaveValue('all')
  await profile.selectOption('locked')
  await expect(page.getByRole('checkbox', { name: 'Allow speed mutation' })).not.toBeChecked()
  await expect(size).not.toBeChecked()
  await expect(sense).not.toBeChecked()

  await page.getByRole('button', { name: 'Blue', exact: true }).click()
  await expect(profile).toHaveValue('speed')
  await size.check()
  await expect(profile).toHaveValue('')
  await sense.check()
  await expect(profile).toHaveValue('all')
  await page.getByRole('button', { name: /^Orange/ }).click()
  await expect(profile).toHaveValue('locked')
})

test('Trends compares sight spread in the filtered days and opens each closing cohort', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
      if (kind === 'webgl2') return null
      return getContext.call(this, kind, ...options)
    }
    const { fillRect, fill } = CanvasRenderingContext2D.prototype
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (this.canvas.classList.contains('world-canvas') && this.fillStyle === '#242424') window.sightCircles = 0
      return fillRect.apply(this, args)
    }
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (this.canvas.classList.contains('world-canvas') && this.fillStyle === '#e4f5fe') window.sightCircles++
      return fill.apply(this, args)
    }
  })
  await openSimulator(page)
  await startRefugeFixture(page, historicalCohort)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByText('Chart options', { exact: true }).click()
  await page.getByLabel('Cohort').selectOption('dusk')
  await page.getByText('Chart options', { exact: true }).click()
  await page.getByLabel('Filter By Species').selectOption('blue')
  await page.getByRole('combobox', { name: 'Range', exact: true }).selectOption('custom')
  await page.getByLabel('From day').fill('2')
  await page.getByLabel('To day').fill('2')
  await page.getByText('Compare sight ranges', { exact: true }).click()
  await expect(page.getByText(/Choose at least two completed days/)).toBeVisible()
  await page.getByLabel('To day').fill('3')

  const world = page.locator('main.world')
  const clock = page.getByRole('slider', { name: 'Replay time' })
  for (const [day, label, count, spread] of [[2, 'Narrowest', 157, '0.54'], [3, 'Widest', 233, '0.62']]) {
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: label + ' spread · Day ' + day }) })
    await expect(card.getByText(String(count), { exact: true })).toBeVisible()
    await expect(card.getByText(spread, { exact: true })).toBeVisible()
    await card.getByRole('button', { name: 'Show Day ' + day + ' at dusk' }).click()
    await expect(page).toHaveURL(new RegExp('/s/' + day + '/viewer$'))
    await expect(world).toHaveClass(/is-overhead/)
    await expect(clock).toHaveValue(await clock.getAttribute('max'))
    await expect.poll(() => page.evaluate(() => window.sightCircles)).toBe(count)
    if (day === 3) {
      await page.getByRole('button', { name: 'View options' }).click()
      await page.getByRole('button', { name: 'Creatures', exact: true }).click()
      const creatures = page.getByRole('combobox', { name: 'Creature', exact: true })
      const blue = await creatures.getByRole('option', { name: / · Blue$/ }).first().getAttribute('value')
      await creatures.selectOption(blue)
      await page.getByRole('button', { name: 'Close creature details' }).click()
      await page.getByRole('button', { name: 'Layers', exact: true }).click()
      await page.getByRole('button', { name: 'More layer options' }).click()
      await page.getByRole('checkbox', { name: 'Selected creature only' }).check()
      await expect.poll(() => page.evaluate(() => window.sightCircles)).toBe(1)
    }
    await page.goBack()
    await expect(page.getByLabel('Filter By Species')).toHaveValue('blue')
    await expect(page.getByLabel('From day')).toHaveValue('2')
    await expect(card).toBeVisible()
  }
})

test('compact Trends plots fill the dawn spread and read the mean and SD together', async ({ page }) => {
  await page.addInitScript(() => {
    window.ageChart = { texts:[], fills:[] }
    const { fill, fillText } = CanvasRenderingContext2D.prototype
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (this.canvas.closest('#chart-age')) window.ageChart.fills.push(this.fillStyle)
      return fill.apply(this, args)
    }
    CanvasRenderingContext2D.prototype.fillText = function (label, ...args) {
      if (this.canvas.closest('#chart-age')) window.ageChart.texts.push(label)
      return fillText.call(this, label, ...args)
    }
  })
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 4)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 4')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.locator('.walkthrough-plots h2')).toHaveText(['Population', 'Age', 'Speed', 'Size', 'Sense Range'])
  const age = page.locator('#chart-age canvas')
  await expect.poll(() => page.evaluate(() => window.ageChart.fills)).toContain('rgba(253, 222, 59, 0.1)')
  await age.hover({ position:{ x:40, y:60 } })
  await expect.poll(() => page.evaluate(() => window.ageChart.texts)).toContain('Mean  0.00 ± 0.00')
  const day = page.locator('#chart-population canvas')
  await day.focus()
  await day.press('Home')
  await day.press('Space')
  await expect(page.getByText(/50 blobs at dawn/)).toBeVisible()
  await page.getByText('Chart options', { exact: true }).click()
  await page.getByLabel('Cohort').selectOption('dusk')
  await expect(page.getByText(/blobs at dusk/)).toBeVisible()
  await page.getByRole('combobox', { name:'Spread', exact:true }).selectOption('percentile')
  await expect(page.getByText('Dusk · Mean and percentiles')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Dawn · Mean ± SD')).toBeVisible()
  await age.hover({ position:{ x:40, y:60 } })
  await expect.poll(() => page.evaluate(() => window.ageChart.texts)).toContain('Mean  0.00 ± 0.00')
})

test('guided sight comparison opens the early and Day 648 cohorts without changing the active run', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 2)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const address = page.url()
  await page.getByRole('button', { name: 'Watch the sight example' }).click()
  await expect(page.getByRole('heading', { name: 'Sight across generations' })).toBeVisible()
  const stages = page.getByRole('group', { name: 'Sight comparison stages' })
  const early = stages.getByRole('button', { name: 'Day 1 · Early sight' })
  const later = stages.getByRole('button', { name: 'Day 648 · Later sight' })
  await expect(early).toHaveAttribute('aria-pressed', 'true', { timeout:40000 })
  await expect(page.getByText('Dawn sight · Mean 20.00 ± 0.00 · 50 blobs')).toBeVisible()
  await later.click()
  await expect(later).toHaveAttribute('aria-pressed', 'true')
  const sight = await page.getByText(/^Dawn sight · Mean/).textContent()
  const reading = sight.match(/Mean ([\d.]+) ± ([\d.]+) · (\d+) blobs/)
  expect(reading).not.toBeNull()
  expect(Number(reading[1])).toBeGreaterThan(20)
  expect(Number(reading[2])).toBeGreaterThan(0)
  expect(Number(reading[3])).toBeGreaterThan(1)
  const clock = page.getByRole('slider', { name: 'Example progress' })
  await expect(clock).toHaveValue('1.6')
  await page.getByRole('button', { name: 'Play example', exact:true }).click()
  await expect.poll(async () => Number(await clock.inputValue())).toBeGreaterThan(1.6)
  await page.getByRole('button', { name: 'Back to Trends' }).click()
  await expect(page).toHaveURL(address)
  await expect(page.getByText(/^Browser test run · Seed \d+ · Through Day 2$/)).toBeVisible()
})

test('Trait Space shows exact ages and newborn shares for both days and the selected species', async ({ page }) => {
  await openSimulator(page)
  await startRefugeFixture(page, historicalCohort)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()
  await page.getByLabel('Filter By Species').selectOption('blue')
  await page.getByRole('combobox', { name: 'Trait', exact: true }).selectOption('age')
  const compare = page.getByRole('spinbutton', { name: 'Compare day' })
  await compare.fill('2')
  await compare.press('Tab')

  const table = page.getByRole('table', { name: 'Living blobs by age' })
  await expect(table.getByRole('columnheader')).toHaveText(['Age (days)', 'Day 3', 'Day 2'])
  const cells = label => table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) }).getByRole('cell')
  await expect(cells('0')).toHaveText(['110', '73'])
  await expect(cells('3')).toHaveText(['32', '0'])
  await expect(cells('Living blobs')).toHaveText(['233', '157'])
  await expect(cells('Newborn share')).toHaveText(['47.2%', '46.5%'])
  await expect(page.getByRole('spinbutton', { name: 'Bins' })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Percentage' }).check()
  await expect(cells('0')).toHaveText(['47.2%', '46.5%'])
  await page.getByLabel('Filter By Species').selectOption('orange')
  await expect(cells('Living blobs')).toHaveText(['78', '40'])
  await compare.fill('0')
  await compare.press('Tab')
  await expect(cells('Living blobs')).toHaveText(['78'])
})

test('Trait Space keeps selections within the species filter and only loads whole days', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('400')
    await page.getByRole('button', { name: /^Orange/ }).click()
    await page.getByLabel('Enabled', { exact: true }).check()
    await page.getByRole('spinbutton', { name: 'Sense Range', exact: true }).fill('20')
    await page.getByRole('spinbutton', { name: 'Energy', exact: true }).fill('1000')
  })
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()
  await finishReplay(page, 3)

  const traitSpace = page.locator('.trait-space')
  const creature = traitSpace.getByRole('combobox', { name: /^Creature/ })
  const orange = await creature.locator('option').filter({ hasText: /^Orange #/ }).first().getAttribute('value')
  const species = page.getByLabel('Filter By Species')
  const watchCreature = traitSpace.getByRole('button', { name: 'Watch creature' })
  await creature.selectOption(orange)
  await species.selectOption('orange')
  await expect(creature).toHaveValue(orange)
  await expect(watchCreature).toBeVisible()
  await species.selectOption('blue')
  await expect(creature).toHaveValue('')
  await expect(watchCreature).toHaveCount(0)
  await species.selectOption('all')
  await expect(creature).toHaveValue('')

  const samples = day => traitSpace.getByText(new RegExp(`^Day ${day} · \\d+ samples`))
  const day = traitSpace.getByRole('spinbutton', { name: 'Day', exact: true })
  const compare = traitSpace.getByRole('spinbutton', { name: 'Compare day' })
  const bins = traitSpace.getByRole('spinbutton', { name: 'Bins' })
  const pendingDays = () => page.evaluate(() => [...window.replayTest.jobs.keys()])
  const before = await pendingDays()
  for (const [field, invalid, previous] of [[day, '1.5', '3'], [day, '', '3'], [compare, '2.5', '0'], [bins, '5.5', '20']]) {
    await field.fill(invalid)
    await field.press('Tab')
    await expect(field).toHaveValue(previous)
  }
  await expect(samples(3)).toBeVisible()
  expect(await pendingDays()).toEqual(before)

  await day.fill('2')
  await day.press('Tab')
  await expect(traitSpace.getByRole('status')).toHaveText('Loading Day 2…')
  await expect(traitSpace.getByLabel('Trait histogram')).toHaveCount(0)
  await finishReplay(page, 2)
  await expect(samples(2)).toBeVisible()
  await compare.fill('3')
  await compare.press('Tab')
  const comparisonBars = traitSpace.getByLabel('Trait histogram').locator('rect[fill="#F6AD73"]')
  await expect(comparisonBars.first()).toBeAttached()
  await compare.fill('0')
  await compare.press('Tab')
  await expect(comparisonBars).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Trait Space centers the mean over a histogram with one trait value', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('400')
    await page.getByLabel('Allow sense mutation').uncheck()
    await page.getByRole('button', { name: /^Orange/ }).click()
    await page.getByLabel('Enabled', { exact: true }).check()
    await page.getByRole('spinbutton', { name: 'Sense Range', exact: true }).fill('30')
    await page.getByRole('spinbutton', { name: 'Energy', exact: true }).fill('1000')
    await page.getByLabel('Allow sense mutation').uncheck()
  })
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const species = page.getByLabel('Filter By Species')
  await species.selectOption('blue')
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()
  const traitSpace = page.locator('.trait-space')
  await traitSpace.getByRole('combobox', { name: 'Trait', exact: true }).selectOption('sense')

  const histogram = traitSpace.getByLabel('Trait histogram')
  const mean = histogram.locator('line[stroke-dasharray]')
  const axisLabels = histogram.locator('text')
  await expect(histogram.locator('rect')).toHaveCount(1)
  await expect(mean).toHaveAttribute('x1', '380')
  await expect(mean).toHaveAttribute('x2', '380')
  await expect(axisLabels).toHaveText(['20.00'])
  await expect(axisLabels.first()).toHaveAttribute('x', '380')

  await species.selectOption('all')
  await expect(axisLabels).toHaveText(['20.00', '30.00'])
  const position = Number(await mean.getAttribute('x1'))
  expect(position).toBeGreaterThan(30)
  expect(position).toBeLessThan(730)
})

test('Trait Space can retry a failed day without changing the selected day', async ({ page }) => {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('400')
  })
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const species = page.getByLabel('Filter By Species')
  await species.selectOption('blue')
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()

  const traitSpace = page.locator('.trait-space')
  const day = traitSpace.getByRole('spinbutton', { name: 'Day', exact: true })
  const retry = traitSpace.getByRole('button', { name: 'Retry Day 3' })
  await finishReplay(page, 3, 'fail')
  const alert = traitSpace.getByRole('alert')
  await expect(alert).toHaveText('Could not load Day 3. Replay unavailable')
  await expect(day).toHaveValue('3')

  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(traitSpace.getByRole('status')).toHaveText('Loading Day 3…')
  await expect(retry).toHaveCount(0)
  await finishReplay(page, 3)
  await expect(traitSpace.getByText(/^Day 3 · \d+ samples/)).toBeVisible()
  await expect(traitSpace.getByLabel('Trait histogram')).toBeVisible()
  await expect(alert).toHaveCount(0)
  await expect(day).toHaveValue('3')
  await expect(species).toHaveValue('blue')
})

test('Trait Space retries a failed comparison without losing the primary day', async ({ page }) => {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('400')
  })
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()
  await finishReplay(page, 3)

  const traitSpace = page.locator('.trait-space')
  const samples = traitSpace.getByText(/^Day 3 · \d+ samples/)
  const creature = traitSpace.getByRole('combobox', { name: /^Creature/ })
  await expect(samples).toBeVisible()
  await creature.selectOption({ index: 1 })
  const creatureId = await creature.inputValue()
  const compare = traitSpace.getByRole('spinbutton', { name: 'Compare day' })
  const comparisonBars = traitSpace.getByLabel('Trait histogram').locator('rect[fill="#F6AD73"]')
  await compare.fill('2')
  await compare.press('Tab')
  await finishReplay(page, 2, 'fail')
  await expect(traitSpace.getByText('Could not load comparison Day 2. Replay unavailable')).toBeVisible()
  await expect(samples).toBeVisible()
  await expect(comparisonBars).toHaveCount(0)

  const retry = traitSpace.getByRole('button', { name: 'Retry comparison Day 2' })
  await expect(retry).toBeEnabled({ timeout: 3000 })
  await retry.click()
  await expect(traitSpace.getByRole('status')).toHaveText('Loading comparison Day 2…')
  await expect(retry).toHaveCount(0)
  await finishReplay(page, 2)

  await expect(comparisonBars.first()).toBeAttached()
  await expect(traitSpace.getByRole('status')).toHaveCount(0)
  await expect(traitSpace.getByRole('alert')).toHaveCount(0)
  await expect(compare).toHaveValue('2')
  await expect(samples).toBeVisible()
  await expect(creature).toHaveValue(creatureId)
})

for (const [width, height] of [[320, 420], [1280, 900]]) {
  test(`Run Library actions fit at ${width} × ${height}${width === 320 ? ' @pages' : ''}`, async ({ page }) => {
    await openSimulator(page)
    await startRun(page, '10', () => page.getByLabel('Run name').fill('Archived field'))
    await startRun(page, '10', () => page.getByLabel('Run name').fill('Active field'))
    await page.setViewportSize({ width, height })
    await openRunLibrary(page)

    const library = page.getByRole('dialog', { name: 'Run Library' })
    const active = library.locator('article').filter({ hasText: '● Active' })
    const archive = library.locator('article').filter({ hasText: 'Archived field' })
    const activeToggle = active.getByRole('button', { name: 'Actions', exact: true })
    const archiveToggle = archive.getByRole('button', { name: 'Actions', exact: true })
    const activePanel = active.getByRole('group', { name: /^Actions for / })
    const archivePanel = archive.getByRole('group', { name: 'Actions for Archived field' })
    const verifyFit = async panel => {
      await expect(panel).toBeVisible()
      expect(await panel.evaluate(element => {
        const dialog = element.closest('dialog')
        const left = dialog.getBoundingClientRect().left + dialog.clientLeft
        const right = left + dialog.clientWidth
        const bounds = element.getBoundingClientRect()
        return dialog.scrollWidth === dialog.clientWidth && bounds.left >= left && bounds.right <= right &&
          [...element.querySelectorAll('button')].every(button => {
            const rect = button.getBoundingClientRect()
            return rect.left >= bounds.left && rect.right <= bounds.right && button.scrollWidth <= button.clientWidth
          })
      })).toBe(true)
    }

    await activeToggle.press('Enter')
    await expect(activeToggle).toBeFocused()
    await expect(activeToggle).toHaveAttribute('aria-expanded', 'true')
    await verifyFit(activePanel)
    await expect(activePanel.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    await activeToggle.press('Space')
    await expect(activeToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(activePanel).toBeHidden()
    await activeToggle.press('Space')
    await page.keyboard.press('Tab')
    await expect(activePanel.getByRole('button', { name: 'View results' })).toBeFocused()
    await activePanel.getByRole('button', { name: 'Rename', exact: true }).click()
    await active.getByLabel('Name', { exact: true }).fill('Renamed field')
    await active.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(active).toContainText('Renamed field')

    await archiveToggle.click()
    await expect(activeToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(activePanel).toBeHidden()
    await expect(archiveToggle).toHaveAttribute('aria-expanded', 'true')
    await verifyFit(archivePanel)
    await expect(archivePanel.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
    const pendingDownload = page.waitForEvent('download')
    await archivePanel.getByRole('button', { name: 'Export setup' }).click()
    const file = await pendingDownload
    expect(file.suggestedFilename()).toBe('evolution-setup.json')
    const exported = JSON.parse(await readFile(await file.path(), 'utf8'))
    expect(exported.setup).toMatchObject({ name: 'Archived field', days: 10 })
    expect(exported.revisions).toEqual([])
  })
}

test('renaming the active run keeps days whose saves are still pending', async ({ page }) => {
  await installSaveDelay(page)
  await openSimulator(page)
  await startRun(page)
  const runOptions = page.getByRole('button', { name: 'Run options' })
  const closeDialog = page.getByRole('button', { name: 'Close dialog' })
  const library = page.getByRole('dialog', { name: 'Run Library' })

  await openRunLibrary(page)
  const active = library.locator('article').filter({ hasText: 'Browser test run' })
  await expect(active).toContainText('Saved through Day 0')
  await closeDialog.click()
  await page.evaluate(() => { window.saveTest.hold = true })
  await quickThrough(page, 3)
  await expect(page.getByRole('heading', { name: 'Simulation complete' })).toBeVisible()
  await expect(batchStatus(page, 'Completed through')).toHaveText('Day 3')
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 0')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await openRunLibrary(page)
  await active.getByText('Actions', { exact: true }).click()
  await active.getByRole('button', { name: 'Rename', exact: true }).click()
  await active.getByLabel('Name', { exact: true }).fill('Renamed field')
  await active.getByRole('button', { name: 'Save', exact: true }).click()
  await closeDialog.click()
  await expect(runOptions).toHaveAttribute('title', 'Renamed field')
  await expect(dayTile(page, 3)).toBeVisible()

  await releaseSaves(page)
  await openRunLibrary(page)
  await expect(library.locator('article').filter({ hasText: 'Renamed field' })).toContainText('Saved through Day 3')
  await page.reload()
  await expect(runOptions).toHaveAttribute('title', 'Renamed field')
  await expect(dayTile(page, 3)).toBeVisible()
})

test('resuming a run keeps completed days while saves are pending', async ({ page }) => {
  await installSaveDelay(page)
  await openSimulator(page)
  await startRun(page, '10', () => page.getByLabel('Run name').fill('Other run'))
  await startRun(page)
  const library = page.getByRole('dialog', { name: 'Run Library' })
  const original = library.locator('article').filter({ hasText: 'Browser test run' })
  const other = library.locator('article').filter({ hasText: 'Other run' })
  const runOptions = page.getByRole('button', { name: 'Run options' })
  await openRunLibrary(page)
  await expect(original).toContainText('Saved through Day 0')
  await expect(other).toContainText('Saved through Day 0')
  await page.getByRole('button', { name: 'Close dialog' }).click()

  await page.evaluate(() => { window.saveTest.hold = true })
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Completed through')).toHaveText('Day 3')
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 0')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await openRunLibrary(page)
  await other.getByRole('button', { name: 'Resume' }).click()
  await expect(runOptions).toHaveAttribute('title', 'Other run')
  await openRunLibrary(page)
  await original.getByRole('button', { name: 'Resume' }).click()
  await expect(runOptions).toHaveAttribute('title', 'Browser test run')
  await expect(runOptions).toHaveText('Day 4 / 10 · Ready')
  await expect(dayTile(page, 3)).toBeVisible()

  await quickThrough(page, 4)
  await expect(batchStatus(page, 'Completed in this batch')).toHaveText('1 of 1')
  await expect(batchStatus(page, 'Completed through')).toHaveText('Day 4')
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 0')
  await releaseSaves(page)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 4')
  await page.reload()
  await expect(dayTile(page, 3)).toBeVisible()
  await expect(dayTile(page, 4)).toBeVisible()
})

async function installBatchHold(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const batch = window.batchTest = { hold: false, release: null, stopping: false }
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (data.type === 'batch' && batch.hold) {
          batch.hold = false
          batch.release = () => {
            batch.release = null
            super.postMessage(data)
            if (batch.stopping) super.postMessage({ type: 'stop' })
          }
          return
        }
        if (data.type === 'stop' && batch.release) {
          batch.stopping = true
          return
        }
        return super.postMessage(data)
      }
    }
  })
}

test('switching runs saves the day Quick Sim was working on', async ({ page }) => {
  await installBatchHold(page)
  await openSimulator(page)
  await startRun(page, '10', () => page.getByLabel('Run name').fill('Other run'))
  await startRun(page)
  const runOptions = page.getByRole('button', { name: 'Run options' })
  const library = page.getByRole('dialog', { name: 'Run Library' })
  const original = library.locator('article').filter({ hasText: 'Browser test run' })
  const other = library.locator('article').filter({ hasText: 'Other run' })
  await page.evaluate(() => { window.batchTest.hold = true })
  await quickThrough(page, 5)
  await page.getByRole('button', { name: 'Hide progress', exact: true }).click()

  await openRunLibrary(page)
  await other.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(runOptions).toHaveText('Day 1 / 10 · Stopping batch')
  await expect(runOptions).toHaveAttribute('title', 'Browser test run')
  expect(await page.evaluate(() => window.batchTest.stopping)).toBe(true)
  await page.evaluate(() => window.batchTest.release())
  await expect(runOptions).toHaveAttribute('title', 'Other run')

  await openRunLibrary(page)
  await expect(original).toContainText('Saved through Day 1')
  await original.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(runOptions).toHaveText('Day 2 / 10 · Ready')
  await expect(dayTile(page, 1)).toBeVisible()
  await expect(page).toHaveURL(/\/s\/2\/viewer$/)
  await page.reload()
  await expect(runOptions).toHaveText('Day 2 / 10 · Ready')
  await expect(dayTile(page, 1)).toBeVisible()
})

test('viewing the active run results keeps Quick Sim running', async ({ page }) => {
  await installBatchHold(page)
  await openSimulator(page)
  await startRun(page)
  const library = page.getByRole('dialog', { name: 'Run Library' })
  const active = library.locator('article').filter({ hasText: 'Browser test run' })
  await page.evaluate(() => { window.batchTest.hold = true })
  await quickThrough(page, 5)
  await page.getByRole('button', { name: 'Hide progress', exact: true }).click()

  await openRunLibrary(page)
  await active.getByText('Actions', { exact: true }).click()
  await active.getByRole('button', { name: 'View results' }).click()
  await expect(page).toHaveURL(/\/stats$/)
  await expect(page.getByText(/Browser test run .* Through Day 0 · Simulating/)).toBeVisible()
  expect(await page.evaluate(() => window.batchTest.stopping)).toBe(false)

  await page.getByRole('button', { name: 'Progress', exact: true }).click()
  await page.evaluate(() => window.batchTest.release())
  await expect(page.getByRole('heading', { name: 'Simulation complete' })).toBeVisible()
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 5')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByText(/Browser test run .* Through Day 5/)).toBeVisible()
})

test('a copied setup link keeps the shared settings after reload', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('321')
    await page.getByRole('spinbutton', { name: 'Random seed' }).fill('118')
    await page.getByRole('spinbutton', { name: 'σ Size', exact: true }).fill('1.00')
  })
  await page.getByRole('button', { name: 'Run options' }).click()
  await page.getByRole('button', { name: 'Run Library' }).click()
  const run = page.getByRole('dialog', { name: 'Run Library' }).locator('article').filter({ hasText: 'Browser test run' })
  await run.getByText('Actions', { exact: true }).click()
  await run.getByRole('button', { name: 'Copy setup link' }).click()
  await expect(page.getByText('Setup link copied. It opens a new experiment draft.')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toContain('#/setup/')

  const recipient = await browser.newPage()
  try {
    const settings = recipient.getByRole('dialog', { name: 'Simulation Settings' })
    const name = settings.getByLabel('Run name')
    const food = settings.getByRole('spinbutton', { name: 'Food', exact: true })
    await recipient.goto(link)
    await expect(name).toHaveValue('Browser test run')
    await expect(food).toHaveValue('321')

    await recipient.reload()
    await expect(name).toHaveValue('Browser test run')
    await expect(food).toHaveValue('321')
    await expect(settings.getByRole('spinbutton', { name: 'Random seed' })).toHaveValue('118')
    await expect(settings.getByRole('spinbutton', { name: 'σ Size', exact: true })).toHaveValue('1.00')
    await expect(recipient).toHaveURL(link)

    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(recipient).toHaveURL(/#\/r\/[^/]+\/s\/\d+\/viewer$/)
    await recipient.reload()
    await expect(recipient.getByRole('button', { name: 'Simulation Settings' })).toBeEnabled()
    await expect(settings).toHaveCount(0)

    await recipient.goto(link)
    await settings.getByRole('button', { name: 'Evolve!' }).click()
    await expect(recipient.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Ready')
    await expect(recipient).toHaveURL(/#\/r\/[^/]+\/s\/1\/viewer$/)
  } finally {
    await recipient.close()
  }
})

test('Watch creature follows a newborn at dusk or at the next recorded dawn', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('400'))
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  const close = page.getByRole('button', { name: 'Close', exact: true })
  await close.click()
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.click()
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()
  const creatures = page.locator('.trait-space').getByRole('combobox', { name: /^Creature/ })
  // Day 1 starts with 50 founders, so #51 is the first newborn.
  await creatures.selectOption('51')
  const watchCreature = page.getByRole('button', { name: 'Watch creature' })
  const runOptions = page.getByRole('button', { name: 'Run options' })
  const replayTime = page.getByRole('slider', { name: 'Replay time' })
  const current = page.getByRole('button', { name: /Current creature details.*#51/ })
  await watchCreature.click()
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  const end = Number(await replayTime.getAttribute('max'))
  await expect.poll(async () => Math.abs(Number(await replayTime.inputValue()) - end)).toBeLessThan(1e-8)
  await expect(current).toBeVisible()
  await current.click()
  await expect(page.getByRole('button', { name: /Born to #/ })).toBeVisible()

  await quickThrough(page, 2)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
  await close.click()
  await trends.click()
  await watchCreature.click()
  await expect(runOptions).toHaveText('Day 2 / 10 · Replay')
  await expect(replayTime).toHaveValue('0')
  await expect(current).toBeVisible()
})

test('a replay applies the predation threshold saved with its setup', async ({ page }) => {
  await openSimulator(page)
  const setup = { ...starter(), days: 10, mode: 'live', sameSpecies: false }
  Object.assign(setup.species[0], { energy: 1000, sense: 60 })
  Object.assign(setup.species[1], { enabled: true, count: 30, size: 12, energy: 1000, sense: 60 })

  for (const [version, threshold] of [[setup.version, 25], [LEGACY_RULE_VERSION, 20]]) {
    const species = version === LEGACY_RULE_VERSION
      ? setup.species.map(({ standardDeviation, ...s }) => ({ ...s, variance:{ speed:.25, size:.25, sense:.25 } }))
      : setup.species
    await openRunLibrary(page)
    await page.getByRole('dialog', { name: 'Run Library' }).locator('input[type=file]').setInputFiles({
      name: 'predation.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...setup, version, species })),
    })
    if (version === LEGACY_RULE_VERSION) {
      await expect(page.getByRole('spinbutton', { name: 'σ² Size', exact: true })).toHaveValue('0.25')
    }
    await page.getByRole('button', { name: /^Advanced Rules/ }).click()
    await expect(page.getByText(`A hunter must be at least ${threshold}% larger than its prey.`)).toBeVisible()
    await page.getByRole('button', { name: 'Evolve!' }).click()
    await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Ready')

    await quickThrough(page, 1)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
    await page.getByRole('button', { name: 'Watch last day' }).click()
    await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Replay')
    await page.reload()

    const time = page.getByRole('slider', { name: 'Replay time' })
    await time.fill('0')
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('button', { name: 'Creatures', exact: true }).click()
    const details = page.getByRole('complementary', { name: 'Creature details' })
    await details.getByRole('combobox', { name: 'Creature', exact: true }).selectOption('51')
    await details.getByRole('combobox', { name: 'Filter creature events' }).selectOption('prey')
    await time.fill('0.2')
    if (version === LEGACY_RULE_VERSION) {
      await expect(details.getByRole('button', { name: /Hunted #7$/ })).toBeVisible()
    } else {
      await expect(details.getByText('No matching events at this point in the day.')).toBeVisible()
    }
  }
})

test('replay shows food credits without refills and refuge distance while returning', async ({ page }) => {
  await openSimulator(page)
  await startRefugeFixture(page)
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Replay')

  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('button', { name: 'Creatures', exact: true }).click()
  const details = page.getByRole('complementary', { name: 'Creature details' })
  await details.getByRole('combobox', { name: 'Creature', exact: true }).selectOption('1')
  const time = page.getByRole('slider', { name: 'Replay time' })
  const distance = details.getByText(/^\d[\d,.]* units from the nearest refuge$/)
  await expect(distance).toHaveCount(0)

  const credits = details.getByText('Food credits', { exact: true }).locator('xpath=following-sibling::dd[1]')
  await time.fill('0.6')
  await expect(credits).toHaveText('0')
  await expect(details.getByText('440.0 / 500 energy')).toBeVisible()
  await time.fill('0.7')
  await expect(credits).toHaveText('1')
  await expect(details.getByText('430.0 / 500 energy')).toBeVisible()

  // Founder #1's center is at x=107.6 on the way to the left side of the gray border.
  await time.fill('1.1')
  await expect(details.getByText('Returning', { exact: true })).toBeVisible()
  await expect(distance).toHaveText('57.6 units from the nearest refuge')

  await time.fill('2')
  await expect(details.getByText('Home', { exact: true })).toBeVisible()
  await expect(distance).toHaveCount(0)
})

test('creature details use the movement and energy rules for the day being watched', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    for (const [name, value] of [['Food', '400'], ['Size', '12'], ['Sense Range', '30'], ['Energy', '1000']]) {
      await page.getByRole('spinbutton', { name, exact: true }).fill(value)
    }
    await page.getByRole('button', { name: /^Advanced Rules/ }).click()
    await page.getByRole('combobox', { name: /^Energy model/ }).selectOption('product')
  })
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const runOptions = page.getByRole('button', { name: 'Run options' })
  const details = page.getByRole('complementary', { name: 'Creature details' })
  const travel = details.getByText('Travel rate', { exact: true }).locator('xpath=following-sibling::dd[1]')
  const energy = details.getByText('Energy cost', { exact: true }).locator('xpath=following-sibling::dd[1]')
  const follow = page.getByRole('button', { name: 'Follow creature' })
  const founder = page.getByRole('button', { name: /Current creature details.*#1$/ })
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  await follow.click()
  await founder.click()
  await expect(travel).toHaveText('120.0 units/s')
  await expect(energy).toHaveText('259.2/s')

  await runOptions.click()
  await page.getByRole('button', { name: 'Branch here', exact: true }).click()
  await page.getByRole('button', { name: 'Edit branch rules' }).click()
  await page.getByRole('button', { name: /^Advanced Rules/ }).click()
  await page.getByRole('combobox', { name: /^Stride/ }).selectOption('speed')
  await page.getByRole('combobox', { name: /^Energy model/ }).selectOption('additive')
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await expect(runOptions).toHaveText('Day 2 / 10 · Ready')
  await follow.click()
  await founder.click()
  await expect(travel).toHaveText('100.0 units/s')
  await expect(energy).toHaveText('172.8/s')

  await page.getByRole('button', { name: 'Previous day', exact: true }).click()
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  await expect(travel).toHaveText('120.0 units/s')
  await expect(energy).toHaveText('259.2/s')
})

test('replay stops at the next live day and the saved results survive a reload', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => Number(await page.getByRole('progressbar', { name: 'Current day elapsed' }).getAttribute('aria-valuenow')))
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click()
  const additional = page.getByRole('spinbutton', { name: 'Additional generations' })
  await expect(batchStatus(page, 'Next day to simulate')).toHaveText('Day 1')
  await additional.fill('0')
  await expect(page.getByText('Finish Day 1.', { exact: true })).toBeVisible()
  await additional.fill('1')
  await expect(page.getByText('Finish Day 1, then complete Day 2.', { exact: true })).toBeVisible()
  await additional.fill('2')
  await expect(page.getByText('Finish Day 1, then complete Days 2–3.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
  await expect(batchStatus(page, 'Completed through')).toHaveText('Day 3')
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const runOptions = page.getByRole('button', { name: 'Run options' })
  await expect(runOptions).toHaveText('Day 3 / 10 · Replay')
  await page.getByRole('button', { name: 'Previous day', exact: true }).click()
  await expect(runOptions).toHaveText('Day 2 / 10 · Replay')
  const nextDay = page.getByRole('button', { name: 'Next day', exact: true })
  await nextDay.click()
  await expect(runOptions).toHaveText('Day 3 / 10 · Replay')
  await nextDay.click()
  await expect(runOptions).toHaveText('Day 4 / 10 · Ready')
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })
  await expect(elapsed).toHaveAttribute('aria-valuenow', '0')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => Number(await elapsed.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Previous day', exact: true }).click()
  await expect(runOptions).toHaveText('Day 3 / 10 · Replay')
  await nextDay.click()
  await expect(elapsed).toHaveAttribute('aria-valuenow', '0')
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.reload()
  await expect(page.getByText(/Browser test run .* Through Day 3/)).toBeVisible()
  await expect(page.locator('.trends canvas').first()).toBeVisible()
  await page.getByRole('link', { name: 'World', exact: true }).click()
  await quickThrough(page, 10)
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await expect(runOptions).toHaveText('Day 10 / 10 · Replay')
  await expect(nextDay).toBeDisabled()
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click()
  await expect(batchStatus(page, 'Next day to simulate')).toHaveText('Run complete')
  await expect(page.getByRole('button', { name: 'Watch Day 10', exact: true })).toBeEnabled()
})

test('Quick Sim previews only new days when the live day has ended', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await page.getByRole('button', { name: 'Play through generations' }).click()
  const speed = page.getByRole('button', { name: 'Viewing speed', exact: true })
  await speed.click()
  await page.getByRole('slider', { name: 'Viewing speed multiplier' }).fill('12')
  await speed.click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Final')

  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Quick Sim' })
  const additional = dialog.getByRole('spinbutton', { name: 'Additional generations' })
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await expect(batchStatus(page, 'Next day to simulate')).toHaveText('Day 2')
  await additional.fill('2')
  await expect(dialog.getByText('Complete Days 2–3.', { exact: true })).toBeVisible()
  await additional.fill('1')
  await expect(dialog.getByText('Complete Day 2.', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Complete through day' }).click()
  const target = dialog.getByRole('spinbutton', { name: 'Target day' })
  await target.fill('1')
  await expect(dialog.getByText('Day 1 is ready to watch.', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Watch Day 1', exact: true })).toBeEnabled()
  await target.fill('2')
  await expect(dialog.getByText('Complete Day 2.', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Additional generations', exact: true }).click()
  await expect(additional).toHaveValue('1')
  await dialog.getByRole('button', { name: 'Simulate', exact: true }).click()
  await expect(batchStatus(page, 'Completed in this batch')).toHaveText('1 of 1')
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
})

test('manual live steps survive reload and worker retry', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (data.type === 'init') window.simulationWriter = this
        return super.postMessage(data)
      }
    }
  })
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  const run = page.getByRole('button', { name: 'Run options' })
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })
  for (let tick = 1; tick <= 3; tick++) await stepTo(page, tick / 10)
  await expect.poll(() => savedManualProgress(page)).toEqual({ tick: 3, days: [] })

  await page.reload()
  await expect(run).toHaveText('Day 1 / 10 · Paused')
  await expect.poll(async () => Number(await elapsed.getAttribute('aria-valuenow'))).toBeCloseTo(0.3)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  await stepTo(page, 0.4)
  await expect.poll(() => savedManualProgress(page)).toEqual({ tick: 4, days: [] })

  await page.evaluate(() => window.simulationWriter.dispatchEvent(new Event('error')))
  await expect(page.getByRole('alert')).toContainText('resume the unfinished day from its last checkpoint')
  await page.getByRole('button', { name: 'Retry simulation' }).click()
  await expect(run).toHaveText('Day 1 / 10 · Paused')
  await expect.poll(async () => Number(await elapsed.getAttribute('aria-valuenow'))).toBeCloseTo(0.4)
  await stepTo(page, 0.5)
})

test('a manual step ending the day saves only the completed result', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page, '1'))
  for (let tick = 1; tick <= 10; tick++) await stepTo(page, tick / 10)
  await expect.poll(() => savedManualProgress(page)).toEqual({ tick: null, days: [1] })
  await page.reload()
  await expect(dayTile(page, 1)).toHaveCount(1)
  await expect.poll(() => savedManualProgress(page)).toEqual({ tick: null, days: [1] })
})

test('playback actions disable advancing at dusk and work again on the next day', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await fixedDay(page, '1')
    await page.getByRole('button', { name: /^Advanced Rules/ }).click()
    await expect(page.getByRole('combobox', { name: /^Energy model/ })).toHaveValue('walkthrough')
    await expect(page.getByText('10.002 energy per 0.1 s step for Blue')).toBeVisible()
  })
  const actions = page.getByRole('button', { name: 'Playback actions' })
  const finish = page.getByRole('button', { name: 'Finish Day', exact: true })
  const step = page.getByRole('button', { name: 'Step one tick', exact: true })
  const end = page.getByRole('button', { name: 'Go to end', exact: true })
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })
  const through = page.getByRole('button', { name: 'Play through generations' })
  await expect(through).toHaveAttribute('aria-pressed', 'true')
  await through.click()
  await page.getByRole('button', { name: 'Follow creature' }).click()
  await page.getByRole('button', { name: /Current creature details.*#1$/ }).click()
  const details = page.getByRole('complementary', { name: 'Creature details' })
  await expect(details.getByText('10.002 per step')).toBeVisible()

  await actions.click()
  await step.click()
  await expect(elapsed).toHaveAttribute('aria-valuenow', '0.1')
  await expect(details.getByText('490.0 / 500 energy')).toBeVisible()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(elapsed).toHaveAttribute('aria-valuenow', '1')
  await actions.click()
  await expect(finish).toBeDisabled()
  await expect(step).toBeDisabled()

  await page.getByRole('button', { name: 'Next day', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 2 / 10 · Ready')
  await expect(elapsed).toHaveAttribute('aria-valuenow', '0')
  await expect(step).toBeEnabled()
  await finish.click()

  const replay = page.getByRole('slider', { name: 'Replay time' })
  await expect(replay).toHaveValue('1')
  await actions.click()
  await expect(end).toBeDisabled()
  await expect(step).toBeDisabled()
  await replay.fill('0.5')
  await step.click()
  await expect(replay).toHaveValue('0.6')
  await actions.click()
  await end.click()
  await expect(replay).toHaveValue('1')
})

test('turning off Play Through cancels an automatic replay that is still loading', async ({ page }) => {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 2)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await dayTile(page, 1).click()
  await finishReplay(page, 1)

  const runOptions = page.getByRole('button', { name: 'Run options' })
  const through = page.getByRole('button', { name: 'Play through generations' })
  const replayTime = page.getByRole('slider', { name: 'Replay time' })
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  await through.click()
  await expect(through).toHaveAttribute('aria-pressed', 'true')
  const end = await replayTime.getAttribute('max')
  await replayTime.fill(String(Number(end) - 0.1))
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByText('Building replay for Day 2…')).toBeVisible()

  await through.click()
  await expect(page.getByRole('button', { name: 'Replay day', exact: true })).toBeEnabled()
  await finishReplay(page, 2)
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  await expect.poll(async () => Math.abs(Number(await replayTime.inputValue()) - Number(end))).toBeLessThan(1e-8)
  await expect(through).toHaveAttribute('aria-pressed', 'false')

  await page.getByRole('button', { name: 'Next day', exact: true }).click()
  await expect(runOptions).toHaveText('Day 2 / 10 · Replay')
  await expect(replayTime).toHaveValue('0')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
})

test('canceling Quick Sim leaves a finished replay at dusk', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()

  const replayTime = page.getByRole('slider', { name: 'Replay time', includeHidden: true })
  const speed = page.getByRole('button', { name: 'Viewing speed', exact: true })
  const quick = page.getByRole('button', { name: 'Quick Sim', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Quick Sim' })
  const play = page.getByRole('button', { name: 'Play', exact: true })
  await speed.click()
  await page.getByRole('slider', { name: 'Viewing speed multiplier' }).fill('0')
  await speed.click()
  await replayTime.fill('9.5')
  await play.click()
  await quick.click()
  await expect(dialog).toBeVisible()
  await expect(replayTime).toHaveValue('10', { timeout: 10000 })

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Replay day', exact: true })).toBeEnabled()
  await expect(replayTime).toHaveValue('10')

  await page.getByRole('button', { name: 'Next day', exact: true }).click()
  await play.click()
  await quick.click()
  await expect(page.getByRole('button', { name: 'Play', exact: true, includeHidden: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
})

test('stopping early reports the saved boundary and allows another batch', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '1000')
  await quickThrough(page, 1000)
  await page.getByRole('button', { name: 'Stop after this day' }).click()
  await expect(page.getByRole('heading', { name: 'Simulation stopped' })).toBeVisible()
  const reached = await batchStatus(page, 'Completed through').innerText()
  const lastDay = Number(reached.replace('Day ', ''))
  expect(lastDay).toBeGreaterThan(0)
  expect(lastDay).toBeLessThan(1000)
  await expect(batchStatus(page, 'Saved through')).toHaveText(reached)
  await expect(page.getByRole('button', { name: 'Watch last day' })).toBeEnabled()
  await quickThrough(page, lastDay + 1, 'New Quick Sim')
  await expect(page.getByRole('heading', { name: 'Simulation complete' })).toBeVisible()
  await expect(batchStatus(page, 'Saved through')).toHaveText(`Day ${lastDay + 1}`)
})

test('a stale replay cannot change the current day, page, or history', async ({ page }) => {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(page.getByRole('heading', { name: 'Simulation complete' })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await dayTile(page, 2).click()
  await expect(page.getByText('Building replay for Day 2…')).toBeVisible()
  await dayTile(page, 1).click()
  await finishReplay(page, 1)
  await finishReplay(page, 2)
  await expect(dayTile(page, 1)).toHaveAttribute('aria-current', 'true')
  await expect(page).toHaveURL(/\/s\/1\/viewer$/)

  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click()
  await page.getByRole('button', { name: 'Complete through day' }).click()
  await page.getByLabel('Target day').fill('3')
  await page.getByRole('button', { name: 'Watch Day 3' }).click()
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.click()
  await finishReplay(page, 3)
  await expect(trends).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/\/s\/1\/stats$/)
  await page.goBack()
  await expect(page.getByRole('link', { name: 'World', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.goForward()
  await expect(trends).toHaveAttribute('aria-current', 'page')
})

test('a failed replay keeps the current day and can be retried', async ({ page }) => {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await finishReplay(page, 3, 'fail')
  await expect(page.getByRole('alert')).toContainText('Could not open the replay for Day 3.')
  await expect(page).toHaveURL(/\/s\/4\/viewer$/)
  await page.getByRole('button', { name: 'Retry replay' }).click()
  await finishReplay(page, 3)
  await expect(page).toHaveURL(/\/s\/3\/viewer$/)
  await expect(dayTile(page, 3)).toHaveAttribute('aria-current', 'true')
})

test('an unresponsive replay times out and can be retried', async ({ page }) => {
  await delayReplays(page)
  await page.clock.install()
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const loading = page.getByText('Building replay for Day 3…')
  await expect(loading).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.replayTest.jobs.has(3))).toBe(true)

  await page.clock.fastForward(20_000)
  await page.evaluate(() => window.replayTest.jobs.get(3).progress())
  await page.clock.fastForward(15_000)
  await expect(loading).toBeVisible()

  await page.clock.fastForward(15_001)
  const retry = page.getByRole('button', { name: 'Retry replay' })
  await expect(retry).toBeEnabled()
  await expect(loading).toHaveCount(0)
  await expect(page).toHaveURL(/\/s\/4\/viewer$/)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()

  await page.evaluate(() => window.replayTest.jobs.delete(3))
  await retry.click()
  await finishReplay(page, 3)
  await expect(page).toHaveURL(/\/s\/3\/viewer$/)
  await expect(dayTile(page, 3)).toHaveAttribute('aria-current', 'true')
  await expect(retry).toHaveCount(0)
})

test('a stalled size-mutation experiment times out and can be run again', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let stalled
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (!stalled && data.type === 'init' && data.config.name.startsWith('Size mutation · ')) {
          stalled = this
          return
        }
        return super.postMessage(data)
      }
      terminate() {
        if (this === stalled) window.stalledPairWorkerTerminated = true
        super.terminate()
      }
    }
  })
  await openSimulator(page)
  await page.getByRole('link', { name: 'About', exact: true }).click()
  const startPair = page.getByRole('button', { name: 'Run both and compare' })
  await expect(startPair).toBeEnabled()
  await page.clock.install()
  await expect(page.getByRole('spinbutton', { name: 'Seed', exact: true })).toHaveValue('118')
  await page.getByRole('combobox', { name: 'Days per run' }).selectOption('100')
  await startPair.click()
  const progress = page.getByRole('progressbar', { name: 'Paired experiment progress' })
  await expect(progress).toBeVisible()
  await page.clock.fastForward(10_001)

  await expect(page.getByRole('status').filter({ hasText: 'The experiment took too long to start. Try again.' })).toBeVisible()
  await expect(progress).toHaveCount(0)
  expect(await page.evaluate(() => window.stalledPairWorkerTerminated)).toBe(true)
  await expect(page.getByRole('spinbutton', { name: 'Seed', exact: true })).toHaveValue('118')
  await expect(startPair).toBeEnabled()

  await startPair.click()
  await expect(page.getByRole('heading', { name: 'Compare runs', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Day 100 results' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play comparison' })).toBeEnabled()
  await expect(page.getByRole('region', { name: 'Left run' }).getByRole('heading')).toHaveText(/Wide \(1\.00\).*Seed 118/)
  await expect(page.getByRole('region', { name: 'Right run' }).getByRole('heading')).toHaveText(/Narrow \(0\.50\).*Seed 118/)
})

test('the 600-generation experiment lowers average size and replays real hunts @pages', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await page.getByRole('link', { name: 'About', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Days per run' })).toHaveValue('600')
  await page.getByRole('button', { name: 'Run both and compare' }).click()

  const sizes = page.getByRole('region', { name: 'Average size over 600 generations' })
  await expect(sizes).toBeVisible({ timeout: 30_000 })
  const cells = side => sizes.getByRole('row', { name: new RegExp('^' + side) }).getByRole('cell')
  await expect(cells('Left').first()).toHaveText('10.00')
  await expect(cells('Right').first()).toHaveText('10.00')
  const wide = Number(await cells('Left').nth(1).textContent())
  const narrow = Number(await cells('Right').nth(1).textContent())
  expect(wide).toBeLessThan(10)
  expect(narrow).toBeLessThan(wide)
  expect(narrow).toBeGreaterThan(6.5)
  expect(narrow).toBeLessThan(7.5)
  await expect(page.getByRole('heading', { name: 'Day 600 results' })).toBeVisible()
  const hunts = page.getByRole('row', { name: /^Successful hunts/ }).getByRole('cell')
  await expect(hunts.nth(0)).toHaveText(/^[1-9]\d*$/)
  await expect(hunts.nth(1)).toHaveText(/^[1-9]\d*$/)

  const watchLeft = page.getByRole('button', { name: /^Watch left hunt/ })
  const watchRight = page.getByRole('button', { name: /^Watch right hunt/ })
  await expect(watchLeft).toBeEnabled()
  await expect(watchRight).toBeEnabled()
  await watchLeft.click()
  await expect(page.getByRole('button', { name: 'Pause comparison' })).toBeEnabled()
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Shared day progress' }).inputValue())).toBeGreaterThan(0)

  await page.reload()
  await expect(sizes).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Day 600 results' })).toBeVisible()
  await expect(watchRight).toBeEnabled()
  expect(errors).toEqual([])
})

test('Compare keeps a cleared run selector empty when the page reloads', async ({ page }) => {
  await openSimulator(page)
  for (const name of ['Right archive', 'Left archive']) {
    await startRun(page, '10', () => page.getByLabel('Run name').fill(name))
    await quickThrough(page, 1)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
  }

  await openRunLibrary(page)
  const archivedRun = page.getByRole('dialog', { name: 'Run Library' }).locator('article').filter({ hasText: 'Right archive' })
  await archivedRun.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Day 1 results' })).toBeVisible()

  const left = page.getByRole('combobox', { name: 'Left run', exact: true })
  const right = page.getByRole('combobox', { name: 'Right run', exact: true })
  const leftId = await left.inputValue()
  const rightId = await right.inputValue()
  const choose = page.getByText('Choose two different saved experiments.')
  for (const [cleared, kept, clearedId, keptId] of [
    [right, left, rightId, leftId],
    [left, right, leftId, rightId],
  ]) {
    await cleared.selectOption('')
    await expect(choose).toBeVisible()
    await page.reload()
    await expect(cleared).toHaveValue('')
    await expect(kept).toHaveValue(keptId)
    await expect(choose).toBeVisible()
    await cleared.selectOption(clearedId)
    await expect(page.getByRole('heading', { name: 'Day 1 results' })).toBeVisible()
  }
})

test('Compare opens runs with results and fits both playback percentages', async ({ page }) => {
  await openSimulator(page)
  for (const name of ['First recording', 'Second recording']) {
    await startRun(page, '10', () => page.getByLabel('Run name').fill(name))
    await quickThrough(page, 1)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
  }

  const openCompare = async () => {
    await page.getByRole('button', { name: 'Run options' }).click()
    await page.getByRole('button', { name: 'Compare runs', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Day 1 results' })).toBeVisible()
  }
  const left = page.getByRole('combobox', { name: 'Left run', exact: true })
  const right = page.getByRole('combobox', { name: 'Right run', exact: true })
  await openCompare()
  await expect(left.locator('option:checked')).toContainText('Second recording')
  await expect(right.locator('option:checked')).toContainText('First recording')

  await page.getByRole('link', { name: 'World', exact: true }).click()
  await startRun(page, '10', () => page.getByLabel('Run name').fill('Fresh run'))
  await openCompare()
  await expect(left.locator('option:checked')).toContainText('Second recording')
  await expect(right.locator('option:checked')).toContainText('First recording')

  const progress = page.getByRole('slider', { name: 'Shared day progress' })
  const percentages = page.locator('.comparison-clock output')
  await expect(progress).toBeEnabled()
  for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 480 }]) {
    await page.setViewportSize(viewport)
    await progress.fill('0')
    await expect(percentages).toHaveText('0% / 0%')
    const startingSize = await percentages.evaluate(el => [el.offsetWidth, el.offsetHeight])
    await progress.fill('1')
    await expect(percentages).toHaveText('100% / 100%')
    expect(await percentages.evaluate(el => [el.offsetWidth, el.offsetHeight])).toEqual(startingSize)
    expect(await percentages.evaluate(el => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const text = range.getBoundingClientRect()
      const output = el.getBoundingClientRect()
      return range.getClientRects().length === 1 && text.left >= output.left && text.right <= output.right
    })).toBe(true)
  }
})

test('Compare keeps the working board visible and retries only the failed replay', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let failOnce = true
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (failOnce && data.type === 'replay' && data.setup.name === 'Right archive' && data.day === 2) {
          failOnce = false
          window.failComparisonReplay = () => this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'error', id: data.id, message: 'Replay unavailable' },
          }))
          return
        }
        return super.postMessage(data)
      }
    }
  })
  await openSimulator(page)
  for (const name of ['Right archive', 'Left archive']) {
    await startRun(page, '10', async () => {
      await fixedDay(page)
      await page.getByLabel('Run name').fill(name)
    })
    await quickThrough(page, 2)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
  }

  await dayTile(page, 1).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Replay')
  await openRunLibrary(page)
  const right = page.getByRole('dialog', { name: 'Run Library' }).locator('article').filter({ hasText: 'Right archive' })
  await right.getByRole('button', { name: 'Compare', exact: true }).click()
  const play = page.getByRole('button', { name: 'Play comparison' })
  const progress = page.getByRole('slider', { name: 'Shared day progress' })
  const leftBoard = page.getByRole('region', { name: 'Left run' })
  const rightBoard = page.getByRole('region', { name: 'Right run' })
  const leftCanvas = leftBoard.locator('canvas.world-canvas')
  const rightCanvas = rightBoard.locator('canvas.world-canvas')
  const leftProgress = page.getByRole('slider', { name: 'Left playback progress' })
  const leftCamera = page.getByRole('combobox', { name: 'Left camera angle' })
  const rightControls = page.getByRole('region', { name: 'Right board controls' })
  const rightDay = rightControls.getByRole('spinbutton', { name: 'Right day' })
  await expect(page.getByRole('heading', { name: 'Day 1 results' })).toBeVisible()
  await expect(play).toBeEnabled()
  await expect(leftCanvas).toBeVisible()
  await expect(rightCanvas).toBeVisible()
  await page.getByRole('button', { name: 'Side by side', exact: true }).click()
  await leftCamera.selectOption('overhead')
  await leftProgress.fill('0.4')
  await expect(leftBoard.getByRole('heading')).toHaveText(/Day 1.*4\.0 s/)

  await rightDay.fill('2')
  await rightDay.press('Tab')
  await expect(page.getByRole('heading', { name: 'Day 1 vs Day 2 results' })).toBeVisible()
  await expect(rightControls.getByRole('status')).toHaveText('Loading Day 2…')
  await expect.poll(() => page.evaluate(() => typeof window.failComparisonReplay)).toBe('function')
  await expect(leftCanvas).toBeVisible()
  await expect(rightCanvas).toBeHidden()
  await page.evaluate(() => window.failComparisonReplay())
  await expect(rightControls.getByRole('alert')).toContainText('Could not open Day 2 on the right.')
  await expect(leftCanvas).toBeVisible()
  await expect(leftBoard.getByRole('heading')).toHaveText(/Day 1.*4\.0 s/)
  await expect(rightCanvas).toBeHidden()
  await expect(rightControls.getByRole('button', { name: 'Play right board' })).toBeDisabled()
  await expect(play).toBeDisabled()
  await expect(progress).toBeDisabled()

  await page.getByRole('button', { name: 'Play left board' }).click()
  await expect.poll(async () => Number(await leftProgress.inputValue())).toBeGreaterThan(0.42)
  await page.getByRole('button', { name: 'Pause left board' }).click()
  await leftProgress.fill('0.4')

  await page.setViewportSize({ width: 390, height: 844 })
  await rightControls.getByRole('button', { name: 'Retry right replay' }).click()
  await expect(play).toBeEnabled()
  await expect(rightControls.getByRole('alert')).toHaveCount(0)
  await expect(rightDay).toHaveValue('2')
  await expect(leftCamera).toHaveValue('overhead')
  await expect(leftBoard.getByRole('heading')).toHaveText(/Day 1.*4\.0 s/)
  await expect(leftCanvas).toBeVisible()
  await expect(rightCanvas).toBeVisible()
  await progress.fill('0.5')
  await expect(leftBoard.getByRole('heading')).toHaveText(/Day 1.*5\.0 s/)
  await expect(rightBoard.getByRole('heading')).toHaveText(/Day 2.*5\.0 s/)
})

test('Compare keeps the shared day valid and Close view changes the board framing', async ({ page }) => {
  await page.setViewportSize({ width:1280, height:900 })
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.addInitScript(() => {
    localStorage.setItem('evolution.tour','1')
    const getContext=HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext=function(type,...args) {
      return type==='webgl2' ? null : getContext.call(this,type,...args)
    }
  })
  await openSimulator(page)
  for (const [name,day] of [['Long archive',5],['Short archive',2]]) {
    await startRun(page,'10',async()=>{
      await fixedDay(page,'1')
      await page.getByRole('spinbutton',{name:'Food',exact:true}).fill('500')
      await page.getByLabel('Run name').fill(name)
    })
    await quickThrough(page,day)
    await expect(batchStatus(page,'Saved through')).toHaveText('Day '+day)
    await page.getByRole('button',{name:'Close',exact:true}).click()
  }

  await openRunLibrary(page)
  const library=page.getByRole('dialog',{name:'Run Library'})
  await library.locator('article').filter({hasText:'Long archive'}).getByRole('button',{name:'Compare',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Compare runs',exact:true})).toBeVisible()

  const shared=page.getByRole('spinbutton',{name:'Set both days'})
  const leftDay=page.getByRole('spinbutton',{name:'Left day',exact:true})
  const rightDay=page.getByRole('spinbutton',{name:'Right day',exact:true})
  await expect(shared).toHaveAttribute('max','2')
  await expect(shared).toHaveValue('2')
  await page.getByRole('button',{name:'Previous comparison day'}).click()
  await expect(shared).toHaveValue('1')
  await page.getByRole('button',{name:'Next comparison day'}).click()
  await expect(shared).toHaveValue('2')
  await expect(leftDay).toHaveValue('2')
  await expect(rightDay).toHaveValue('2')
  await rightDay.fill('5')
  await rightDay.press('Tab')
  await expect(rightDay).toHaveValue('5')
  await expect(shared).toHaveValue('2')
  await page.reload()
  await expect(shared).toHaveValue('2')
  await expect(leftDay).toHaveValue('2')
  await expect(rightDay).toHaveValue('5')
  await page.getByRole('button',{name:'Previous comparison day'}).click()
  await expect(shared).toHaveValue('1')
  await expect(leftDay).toHaveValue('1')
  await expect(rightDay).toHaveValue('1')

  const camera=page.getByRole('combobox',{name:'Left camera angle'})
  const canvas=page.getByRole('region',{name:'Left run'}).locator('canvas.world-canvas')
  const pixels=()=>canvas.evaluate(element=>element.toDataURL())
  await page.waitForTimeout(100)
  const field=await pixels()
  await camera.selectOption('close')
  await expect.poll(pixels).not.toBe(field)
  await page.getByRole('button',{name:'Fit both boards'}).click()
  await expect(camera).toHaveValue('board')
  await expect.poll(pixels).toBe(field)
})

test('Age walkthrough keeps controls visible through failures, cancellation, and run changes', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({width:850,height:650})
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.addInitScript(() => {
    localStorage.setItem('evolution.tour','1')
    const NativeWorker=window.Worker
    window.ageDemoTest={mode:'fail',workers:[]}
    window.Worker=class extends NativeWorker {
      postMessage(data) {
        if(data.type==='init' && data.config.name.startsWith('Size mutation ·')) {
          if(window.ageDemoTest.mode==='fail') {
            window.ageDemoTest.mode='hold'
            queueMicrotask(()=>this.onmessage?.({data:{type:'error',message:'Forced age preparation failure'}}))
            return
          }
          if(window.ageDemoTest.mode==='hold') {
            window.ageDemoTest.workers.push(this)
            return
          }
        }
        return super.postMessage(data)
      }
    }
  })
  await openSimulator(page)
  await page.getByRole('link',{name:'Trends',exact:true}).click()
  await page.getByRole('button',{name:'Walk through age',exact:true}).click()

  const walkthrough=page.getByRole('region',{name:'Age walkthrough'})
  const alert=walkthrough.getByRole('alert')
  const cancel=walkthrough.getByRole('button',{name:'Cancel preparation'})
  const chartGrid=page.locator('.walkthrough-plots')
  await expect(alert).toContainText('Forced age preparation failure')
  await expect(page.getByText(/Age walkthrough · Reference preparation failed/)).toBeVisible()
  await expect(chartGrid).toHaveCount(0)
  await expect.poll(async()=>{
    const bounds=await walkthrough.boundingBox()
    return bounds && bounds.y>=0 && bounds.y+bounds.height<=650
  }).toBe(true)

  await walkthrough.getByRole('button',{name:'Retry'}).click()
  await expect(page.getByRole('progressbar',{name:'Age walkthrough preparation'})).toBeVisible()
  await expect(cancel).toBeVisible()
  await expect.poll(async()=>{
    const bounds=await cancel.boundingBox()
    return bounds && bounds.y>=0 && bounds.y+bounds.height<=650
  }).toBe(true)
  await cancel.click()
  await expect(alert).toContainText('Preparation canceled.')
  await expect(walkthrough.getByRole('button',{name:'Retry'})).toBeVisible()

  await page.evaluate(()=>{window.ageDemoTest.mode='run'})
  await walkthrough.getByRole('button',{name:'Retry'}).click()
  await expect(page.locator('.walkthrough-plots .spotlight-plot')).toBeVisible({timeout:60_000})
  await expect(page.getByText(/Age walkthrough · Size mutation · Wide.*Through Day 600/)).toBeVisible()
  const agePlot=page.locator('.walkthrough-plots .spotlight-plot')
  await expect.poll(async()=>{
    const bounds=await agePlot.boundingBox()
    return bounds && bounds.y>=0 && bounds.y+bounds.height<=650
  }).toBe(true)

  await page.evaluate(()=>{window.ageDemoTest.mode='hold'})
  await walkthrough.getByRole('button',{name:'Prepare short run · 100 days'}).click()
  await expect(page.getByRole('status').filter({hasText:'Preparing both 100-day runs'})).toBeVisible()
  await expect(walkthrough.getByText('LONG RUN · SEED 118')).toBeVisible()
  await expect(page.getByText(/Age walkthrough · Size mutation · Wide.*Through Day 600/)).toBeVisible()
  await expect(agePlot).toBeVisible()
  await cancel.click()
  await expect(alert).toContainText('Preparation canceled.')
  await expect(agePlot).toBeVisible()

  await page.evaluate(()=>{window.ageDemoTest.mode='run'})
  await walkthrough.getByRole('button',{name:'Retry'}).click()
  await expect(page.locator('.walkthrough-plots .spotlight-plot')).toBeVisible({timeout:60_000})
  await expect(walkthrough.getByText('SHORT RUN · SEED 118')).toBeVisible()
  await expect(page.getByText(/Age walkthrough · Size mutation · Wide.*Through Day 100/)).toBeVisible()
  await walkthrough.getByRole('button',{name:'Close age walkthrough'}).click()
  await expect(page.getByRole('button',{name:'Walk through age',exact:true})).toBeVisible()
  await expect(page.getByText(/Starter field · Seed .* Through Day/)).toBeVisible()
})

for (const failure of ['constructor', 'timeout']) {
  test(`retry recovers after a worker startup ${failure} failure`, async ({ page }) => {
    await page.addInitScript(failure => {
      const NativeWorker = window.Worker
      let failFirst = true
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          if (failure === 'constructor' && failFirst) {
            failFirst = false
            throw new Error('Worker unavailable')
          }
          super(...args)
        }
        postMessage(data) {
          if (failure === 'timeout' && failFirst && data.type === 'init') {
            failFirst = false
            window.workerWaiting = true
            return
          }
          return super.postMessage(data)
        }
      }
    }, failure)
    if (failure === 'timeout') await page.clock.install()
    await openSimulator(page)
    if (failure === 'timeout') {
      await page.waitForFunction(() => window.workerWaiting)
      await page.clock.fastForward(10001)
    }
    const retry = page.getByRole('button', { name: 'Retry simulation' })
    await expect(retry).toBeEnabled()
    await retry.click()
    await expect(retry).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Simulation Settings' })).toBeEnabled()
    await expect(dayTile(page, 1)).toBeVisible()
  })
}

test('retry after a crash in full screen keeps completed days and restarts uncheckpointed playback', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (data.type === 'init') window.simulationWriter = this
        if (data.type === 'checkpoint') return
        return super.postMessage(data)
      }
    }
  })
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const view = page.getByRole('button', { name: 'View options' })
  await view.click()
  await page.getByRole('button', { name: 'Full screen', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('world'))).toBe(true)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })
  await expect.poll(async () => Number(await elapsed.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  await page.evaluate(() => {
    window.failedWriter = window.simulationWriter
    window.failedWriter.dispatchEvent(new Event('error'))
  })
  await expect(page.getByRole('alert')).toContainText('The unfinished day will restart')
  const retry = page.getByRole('button', { name: 'Retry simulation' })
  await retry.click({ timeout: 5000 })
  await expect(retry).toHaveCount(0)
  await view.click()
  await page.getByRole('button', { name: 'Exit full screen' }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 4 / 10 · Ready')
  await expect(elapsed).toHaveAttribute('aria-valuenow', '0')
  await page.evaluate(() => window.failedWriter.dispatchEvent(new MessageEvent('message', {
    data: { type: 'frame', frame: { day: 9, time: 0, duration: 10, blobs: [], plants: [], events: [] } },
  })))
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 4 / 10 · Ready')
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.getByText(/Browser test run .* Through Day 3/)).toBeVisible()
})
