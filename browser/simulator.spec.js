import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

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
  await startRun(page)
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

test('a copied setup link keeps the shared settings after reload', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('321')
    await page.getByRole('spinbutton', { name: 'Random seed' }).fill('37')
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
    await expect(settings.getByRole('spinbutton', { name: 'Random seed' })).toHaveValue('37')
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
  const current = page.getByRole('button', { name: /CURRENT CREATURE.*#51/ })
  await watchCreature.click()
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  await expect(replayTime).toHaveValue('10')
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

test('creature details use the movement and energy rules for the day being watched', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    for (const [name, value] of [['Food', '400'], ['Size', '12'], ['Sense Range', '30'], ['Energy', '1000']]) {
      await page.getByRole('spinbutton', { name, exact: true }).fill(value)
    }
  })
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const runOptions = page.getByRole('button', { name: 'Run options' })
  const details = page.getByRole('complementary', { name: 'Creature details' })
  const travel = details.getByText('Travel rate', { exact: true }).locator('xpath=following-sibling::dd[1]')
  const energy = details.getByText('Energy cost', { exact: true }).locator('xpath=following-sibling::dd[1]')
  const follow = page.getByRole('button', { name: 'Follow creature' })
  const founder = page.getByRole('button', { name: /CURRENT CREATURE.*#1$/ })
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
  await startRun(page)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => Number(await page.getByRole('progressbar', { name: 'Current day elapsed' }).getAttribute('aria-valuenow')))
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Additional generations' }).fill('2')
  await expect(page.getByText('Finish Day 1, then complete Days 2–3')).toBeVisible()
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

test('Compare can retry a failed replay for the same runs and day', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let failOnce = true
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (failOnce && data.type === 'replay' && data.setup.name === 'Right archive' && data.day === 2) {
          failOnce = false
          queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'error', id: data.id, message: 'Replay unavailable' },
          })))
          return
        }
        return super.postMessage(data)
      }
    }
  })
  await openSimulator(page)
  for (const name of ['Right archive', 'Left archive']) {
    await startRun(page, '10', () => page.getByLabel('Run name').fill(name))
    await quickThrough(page, 2)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
  }

  await page.getByRole('button', { name: 'Run options' }).click()
  await page.getByRole('button', { name: 'Run Library' }).click()
  const right = page.getByRole('dialog', { name: 'Run Library' }).locator('article').filter({ hasText: 'Right archive' })
  await right.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Day 2 results' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Replay unavailable' })).toBeVisible()
  const play = page.getByRole('button', { name: 'Play comparison' })
  const progress = page.getByRole('slider', { name: 'Shared day progress' })
  await expect(play).toBeDisabled()
  await expect(progress).toBeDisabled()

  await page.getByRole('button', { name: 'Retry replays' }).click()
  await expect(play).toBeEnabled()
  await expect(page.getByRole('status').filter({ hasText: 'Replay unavailable' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Day 2 results' })).toBeVisible()
  await progress.fill('0.5')
  await expect(page.getByRole('region', { name: 'Left run' }).getByRole('heading')).toHaveText(/Left archive.*5\.0 s/)
  await expect(page.getByRole('region', { name: 'Right run' }).getByRole('heading')).toHaveText(/Right archive.*5\.0 s/)
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

test('retry after a crash keeps completed days and discards only uncheckpointed playback', async ({ page }) => {
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
  await startRun(page)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })
  await expect.poll(async () => Number(await elapsed.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  await page.evaluate(() => {
    window.failedWriter = window.simulationWriter
    window.failedWriter.dispatchEvent(new Event('error'))
  })
  await expect(page.getByRole('alert')).toContainText('The unfinished day will restart')
  await page.getByRole('button', { name: 'Retry simulation' }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 4 / 10 · Ready')
  await expect(elapsed).toHaveAttribute('aria-valuenow', '0')
  await page.evaluate(() => window.failedWriter.dispatchEvent(new MessageEvent('message', {
    data: { type: 'frame', frame: { day: 9, time: 0, duration: 10, blobs: [], plants: [], events: [] } },
  })))
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 4 / 10 · Ready')
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.getByText(/Browser test run .* Through Day 3/)).toBeVisible()
})
