import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LEGACY_RULE_VERSION, starter, plantsForDay, rulesFor, validate, validateRevisions } from '../src/engine/config.js'
import { canHunt, cost, radius, walkthroughStepCost } from '../src/engine/geometry.js'
import { normal } from '../src/engine/random.js'
import { dawn, dusk, founders, snapshot, step } from '../src/engine/simulation.js'
import { distribution } from '../src/engine/stats.js'
import { prepareTrack, trackFrame } from '../src/track.js'
import { csv } from '../src/export.js'

test('live, partially saved, headless, and replay execution agree for every completed day', () => {
  const config = starter()
  config.species[1].enabled = true
  config.scheduleMode = 'ramp'
  config.schedule = [{ day: 9, food: 75 }, { day: 12, food: 35 }]
  let checkpoint = founders(config)
  for (let day = 1; day <= 15; day++) {
    const live = dawn(config, day, checkpoint)
    const batch = structuredClone(live)
    for (let i = 0; i < 71; i++) step(live, config)
    const resumed = structuredClone(live)
    let result
    while (!result) result = step(live, config)
    assert.deepEqual(result, step(resumed, config, resumed.limit, true))
    assert.deepEqual(result, step(batch, config, batch.limit, true))
    assert.deepEqual(snapshot(live), snapshot(batch))
    const { rows } = result.summary
    const row = rows.all
    assert.equal(row.population, row.opening + row.births - row.deaths)
    assert.equal(row.food, row.plants + row.plantsLeft)
    assert.equal(row.hunts, row.causes.Predation)
    assert.equal(row.population, rows.blue.population + rows.orange.population)
    checkpoint = result.checkpoint
  }
})

test('dawn balances all four edges, resets credits and capacity, and keys food by day', () => {
  const config = starter()
  const opening = founders(config)
  const field = dawn(config, 1, opening)
  const sides = [0, 0, 0, 0]
  for (const b of field.blobs) {
    const edge = [b.x, b.y, 500 - b.x, 500 - b.y]
    sides[edge.indexOf(Math.min(...edge))]++
    assert.equal(b.energy, 500)
    assert.equal(b.credits, 0)
  }
  assert.deepEqual(sides.sort(), [12, 12, 13, 13])
  assert.equal(field.plants.length, 50)
  assert.deepEqual(field.plants, dawn(config, 1, opening).plants)
  assert.notDeepEqual(field.plants, dawn(config, 2, opening).plants)
  assert.notDeepEqual(field.plants, dawn({ ...config, seed: 99 }, 1, opening).plants)
})

test('the hunt threshold is inclusive, same-species configurable, and hunting counts as food', () => {
  const defaults = starter()
  assert.equal(defaults.preyReward, 0)
  for (const [config, size, eligible] of [
    [defaults, 12, false],
    [defaults, 12.499, false],
    [defaults, 12.5, true],
    [{ ...defaults, preyReward: 30 }, 12.5, true],
    [{ ...defaults, version: LEGACY_RULE_VERSION }, 12, true],
  ]) {
    const field = dawn(config, 1, founders(config))
    const [hunter, prey] = field.blobs
    field.blobs = [hunter, prey]
    field.plants = []
    Object.assign(hunter, { x: 100, y: 100, size, r: radius(size), energy: 400 })
    Object.assign(prey, { x: 100, y: 100, size: 10 })
    assert.equal(canHunt(hunter, prey, config), eligible)
    assert.equal(canHunt(hunter, prey, { ...config, sameSpecies: false }), false)
    assert.equal(canHunt(hunter, { ...prey, species: 'orange' }, { ...config, sameSpecies: false }), eligible)
    assert.equal(canHunt(hunter, prey, { ...config, predation: false }), false)
    step(field, config)
    assert.equal(prey.alive, !eligible)
    assert.equal(hunter.credits, Number(eligible))
    assert.equal(hunter.preyCredits, Number(eligible))
    const [hunt] = field.events.filter(e => e.type === 'prey')
    assert.equal(Boolean(hunt), eligible)
    if (hunt) assert.equal(hunt.energy, hunt.beforeEnergy + config.preyReward)
    assert.equal(field.events.filter(e => e.cause === 'Predation').length, Number(eligible))
  }
})

test('plants give one credit and only refill energy when configured', () => {
  const defaults = starter()
  assert.equal(defaults.plantReward, 0)
  for (const config of [defaults, { ...defaults, plantReward: 30 }]) {
    const field = dawn(config, 1, founders(config))
    const [blob] = field.blobs
    field.blobs = [blob]
    field.plants = [{ id:0, x:100, y:100, eaten:false }]
    Object.assign(blob, { x:100, y:100 })
    step(field, config)
    assert.equal(field.plants[0].eaten, true)
    assert.equal(blob.credits, 1)
    const bite = field.events[0]
    assert.equal(bite.type, 'plant')
    assert.equal(bite.beforeEnergy, 489.998)
    assert.equal(bite.energy, Math.min(blob.capacity, bite.beforeEnergy + config.plantReward))
    assert.equal(blob.energy, bite.energy)
  }
})

test('energy depletes immediately and a zero-energy collision cannot feed or reproduce', () => {
  const config = starter()
  const field = dawn(config, 1, founders(config))
  const [blob] = field.blobs
  field.blobs = [blob]
  field.plants = [{ id:0, x:100, y:100, eaten:false }]
  Object.assign(blob, { x:100, y:100, energy:0 })
  step(field, config)
  assert.equal(blob.alive, false)
  assert.equal(field.plants[0].eaten, false)
  assert.equal(field.events[0].cause, 'Energy depletion')
  assert.equal(field.events[0].time, 0)
  assert.equal(step(field, config, field.limit, true).summary.rows.all.births, 0)
})

test('dusk uses the survival thresholds and true Gaussian variance once per newborn', () => {
  const config = starter()
  config.species[0].mutation.size = false
  config.species[0].variance.speed = 4
  const field = dawn(config, 1, founders(config))
  const [unfed, one, two, far] = field.blobs
  field.blobs = [unfed, one, two, far]
  field.opening = field.opening.slice(0,4)
  Object.assign(one, { credits:1, home:true })
  Object.assign(two, { credits:3, home:true, speed:120 })
  Object.assign(far, { credits:2, home:false })
  const result = dusk(field, config)
  const child = result.checkpoint.roster.find(b => b.parent === two.id)
  const row = result.summary.rows.all
  assert.equal(row.population, 3)
  assert.equal(row.births, 1)
  assert.equal(row.causes.Starvation, 1)
  assert.equal(row.causes['Missed home'], 1)
  assert.equal(child.speed, 120 + 2 * normal(config.seed, 1, child.id, 0))
  assert.equal(child.size, two.size)
  assert.equal(child.age, 0)
  assert.equal(dusk(field, config), result)
})

test('product cost scales cubically in size, quadratically in speed, and linearly in sense', () => {
  const config = { ...starter(), metabolism:'product' }, b = config.species[0], baseline = cost(b, config)
  assert.equal(cost({ ...b, size:b.size*2 }, config), baseline*8)
  assert.equal(cost({ ...b, speed:b.speed*2 }, config), baseline*4)
  assert.equal(cost({ ...b, sense:b.sense*2 }, config), baseline*2)
  assert.equal(radius(100), 25)
  assert.ok(radius(200) - radius(100) < radius(100) - radius(1))
  assert.ok(radius(1e7) > radius(200))
})

test('the default charges the full video movement cost before a blob can eat', () => {
  const config = starter()
  const founder = config.species[0]
  assert.equal(config.metabolism, 'walkthrough')
  assert.equal(walkthroughStepCost(founder, config), 10.002)
  assert.equal(walkthroughStepCost({ ...founder, size:20 }, config), 320.002)
  assert.equal(walkthroughStepCost({ ...founder, size:20 }, { ...config, stride:'speed' }), 80.002)
  assert.equal(walkthroughStepCost({ ...founder, sense:40 }, config), 10.004)

  const field = dawn(config, 1, founders(config))
  const [blob, exhausted] = field.blobs
  field.blobs = [blob, exhausted]
  field.plants = [{ id:0, x:200, y:200, eaten:false }]
  Object.assign(blob, { x:100, y:100, angle:0 })
  Object.assign(exhausted, { x:200, y:200, angle:0, energy:10.002 })
  step(field, config)
  assert.equal(snapshot(field).time, 0.1)
  assert.equal(snapshot(field).duration, 10)
  assert.ok(Math.abs(Math.hypot(blob.x - 100, blob.y - 100) - 10) < 1e-10)
  assert.equal(blob.energy, 489.998)
  assert.equal(exhausted.alive, false)
  assert.equal(field.events[0].time, 0.1)
  assert.equal(field.events[0].cause, 'Energy depletion')
  assert.equal(field.plants[0].eaten, false)
})

test('an extinct run still records food and null trait statistics', () => {
  const config = starter()
  const field = dawn(config, 50, { roster:[], nextId:51 })
  const { summary } = step(field, config, field.limit, true)
  assert.equal(summary.day, 50)
  assert.equal(summary.rows.all.population, 0)
  assert.equal(summary.rows.all.food, 50)
  assert.equal(summary.rows.all.plantsLeft, 50)
  assert.equal(summary.rows.all.age.mean, null)
  assert.equal(summary.rows.all.deathAge.mean, null)
})

test('configuration bounds, food schedules, and quantiles use the documented definitions', () => {
  const config = starter()
  assert.deepEqual(validate(config), {})
  assert.ok(validate({ ...config, days:9, duration:601, food:1001, seed:0 }).days)
  assert.ok(validate({ ...config, species:[{ ...config.species[0], variance:{ speed:0, size:.25, sense:.25 } }] })['blue.variance.speed'])
  config.scheduleMode = 'ramp'
  config.schedule = [{ day: 5, food: 100 }]
  assert.equal(plantsForDay(config, 3), 75)
  config.scheduleMode = 'step'
  assert.equal(plantsForDay(config, 3), 50)
  assert.equal(plantsForDay(config, 5), 100)
  assert.deepEqual(distribution([1, 5, 9]), { n:3, mean:5, p25:3, p75:7, min:1, max:9, sd:4 })
})

test('replay seeks across a bite and an exact death without smearing energy or plants', () => {
  const opening = [{ id:1, age:0 }]
  const track = prepareTrack({
    opening, day:1, duration:.05, stride:1, final:{time:.05},
    plants:[{ id:4, x:2, y:0 }],
    frames:new Float32Array([0,0,0,10,0,1,0,4,0,0,0,1,6,0]),
    events:[
      { id:1, type:'plant', time:.02, target:4, x:2, y:0, energy:15, beforeEnergy:5 },
      { id:1, type:'death', time:.04, x:4, y:0, energy:0 }
    ]
  })
  const before = trackFrame(track,.01)
  const bite = trackFrame(track,.02)
  const death = trackFrame(track,.04)
  assert.equal(before.blobs[0].energy,7.5)
  assert.equal(before.plants.length,1)
  assert.equal(bite.blobs[0].energy,15)
  assert.equal(bite.blobs[0].credits,1)
  assert.equal(bite.plants.length,0)
  assert.equal(death.blobs[0].alive,false)
  assert.equal(death.blobs[0].energy,0)
})

test('CSV exports per-scope rows and distinguishes missing measurements from zero', () => {
  const setup = starter()
  const day = dawn(setup, 1, { roster:[], nextId:1 })
  const { summary } = step(day, setup, day.limit, true)
  const result = csv({ id:'demo', setup, revisions:[], summaries:[summary] },'*',1,1).split('\r\n')
  assert.equal(result.length,3)
  assert.match(result[0],/"rule_start_day"/)
  assert.match(result[1],/"all","1",,"0","0"/)
  assert.match(result[1],/,"0",,,,,,$/)
})

test('branch histories keep founding traits and apply new food and duration only after the fork', () => {
  const original = { ...starter(), version: LEGACY_RULE_VERSION, metabolism:'product' }
  const branch = { ...original, version: starter().version, food:80, duration:200, metabolism:'walkthrough' }
  const revisions = [{ day:1, setup:original }, { day:3, setup:branch }]
  assert.deepEqual(validate(original), {})
  assert.equal(validateRevisions(branch,revisions),true)
  const summaries = []
  let result = { checkpoint:founders(original) }
  for (let day=1; day<=3; day++) {
    const rules = rulesFor(branch,revisions,day)
    const state = dawn(rules,day,result.checkpoint)
    assert.equal(state.stepSeconds, day < 3 ? .05 : .1)
    assert.equal(snapshot(state).duration, day < 3 ? 10 : 20)
    result = step(state,rules,state.limit,true)
    assert.equal(result.summary.rows.all.food,day<3?50:80)
    summaries.push(result.summary)
  }
  const rows = csv({ id:'branch', setup:branch, revisions, summaries }, 'all').split('\r\n').slice(1)
  assert.deepEqual(rows.map(row => row.split(',')[2]), ['"1"', '"1"', '"2"'])
  assert.equal(validateRevisions({ ...branch, seed:2 },revisions),false)
})
