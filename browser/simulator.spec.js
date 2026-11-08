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
        const receive = event => received.push(event.data.day ?? data.day)
        jobs.set(data.day, {
          release: () => {
            this.addEventListener('message', receive, { once: true })
            super.postMessage(data)
          },
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
