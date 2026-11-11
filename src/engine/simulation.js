import { endsWhenSettled, plantsForDay, TRAITS } from './config.js'
import { random, normal, shuffle } from './random.js'
import { summaries } from './stats.js'
import { FIELD, DT, WALKTHROUGH_STEP, Grid, clamp, radius, travel, cost, walkthroughStepCost,
  canHunt, turn, homePoints, pathOf, contact } from './geometry.js'

export const STATES = ['Searching', 'Foraging', 'Chasing', 'Fleeing', 'Returning', 'Home', 'Dead', 'Born']

export function founders(config) {
  let id = 1
  const roster = config.species.filter(s => s.enabled).flatMap(s => Array.from({ length: s.count }, () => ({
    id: id++, species: s.id, parent: null, age: 0, born: 1, speed: s.speed, size: s.size, sense: s.sense,
  })))
  return { roster, nextId: id }
}

export function dawn(config, day, checkpoint) {
  const { roster, nextId } = checkpoint
  const walkthrough = config.metabolism === 'walkthrough'
  const stepSeconds = walkthrough ? WALKTHROUGH_STEP : DT
  const species = new Map(config.species.map(s => [s.id, s]))
  const edges = shuffle([0, 1, 2, 3], config.seed, day, 2)
  const blobs = shuffle(roster, config.seed, day, 1).map((original, i) => {
    const edge = edges[i % 4], slot = Math.floor(i / 4), count = Math.ceil((roster.length - i % 4) / 4)
    const r = radius(original.size)
    const along = clamp(25 + 450 * (slot + 0.1 + random(config.seed, 3, day, original.id) * 0.8) / count,
      r + 6, FIELD - r - 6)
    const inset = r + 2
    const [x, y, inward] = [[inset, along, 0], [FIELD - inset, along, Math.PI],
      [along, inset, Math.PI / 2], [along, FIELD - inset, -Math.PI / 2]][edge]
    const angle = inward + (random(config.seed, 4, day, original.id) - 0.5) * Math.PI / 6
    const energy = species.get(original.species).energy
    const moveCost = walkthrough ? walkthroughStepCost(original, config) : null
    return { ...original, r, x, y, angle, energy, capacity: energy, credits: 0, preyCredits: 0,
      state: 0, alive: true, home: false, returning: false, target: null,
      velocityX: 0, velocityY: 0, rate: walkthrough ? moveCost / stepSeconds : cost(original, config),
      speedWorld: travel(original, config), moveCost }
  })
  blobs.sort((a, b) => a.id - b.id)
  const plants = Array.from({ length: plantsForDay(config, day) }, (_, id) => ({
    id, x: 12 + 476 * random(config.seed, 5, day, id, 0), y: 12 + 476 * random(config.seed, 5, day, id, 1), eaten: false,
  }))
  const limit = endsWhenSettled(config) ? null : Math.round(config.duration / 10 / stepSeconds)
  return { day, tick: 0, stepSeconds, limit,
    nextId, opening: roster, blobs, plants, events: [], settled: false }
}

function record(ctx, blob, time, type, extra = {}) {
  ctx.events.push({ day: ctx.day, time, type, id: blob.id, species: blob.species, age: blob.age,
    x: blob.x, y: blob.y, energy: blob.energy, ...extra })
}

function kill(ctx, blob, time, cause, extra) {
  blob.alive = false
  blob.state = 6
  record(ctx, blob, time, 'death', { cause, ...extra })
}

function nearest(blob, candidates, eligible) {
  let best = null, closest = blob.sense ** 2
  for (const target of candidates) {
    const d = (target.x - blob.x) ** 2 + (target.y - blob.y) ** 2
    if (d <= closest && eligible(target) && (d < closest || best === null || target.id < best.id)) {
      closest = d
      best = target
    }
  }
  return best
}

function intent(blob, ctx, config, plantGrid, blobGrid) {
  const nearby = [...blobGrid.near(blob.x, blob.y, blob.sense)]
  const threat = nearest(blob, nearby, other => canHunt(other, blob, config) && other.credits < 2)
  const timeLeft = ctx.limit == null ? Infinity : (ctx.limit - ctx.tick) * (ctx.stepSeconds ?? DT)
  const left = Math.min(timeLeft, blob.energy / blob.rate)
  const homes = homePoints(blob)
  const base = homes[0]
  const towards = target => Math.atan2(target.y - blob.y, target.x - blob.x)
  const required = target => target.distance / blob.speedWorld +
    (target.distance ? Math.abs(turn(blob.angle, towards(target))) / (2 * Math.PI) : 0) + 0.25
  if (blob.credits >= 2 || (blob.credits === 1 && left <= required(base))) blob.returning = true
  if (blob.returning) {
    if (threat) {
      const away = homes.find(point => required(point) <= left &&
        point.dx * (blob.x - threat.x) + point.dy * (blob.y - threat.y) > 0)
      if (away) blob.target = away
    }
    blob.target ??= base
    blob.state = 4
    return towards(blob.target)
  }
  if (threat) {
    blob.state = 3
    return Math.atan2(blob.y - threat.y, blob.x - threat.x)
  }
  const food = nearest(blob, plantGrid.near(blob.x, blob.y, blob.sense), plant => !plant.eaten)
  const foodTime = food ? Math.hypot(food.x - blob.x, food.y - blob.y) / blob.speedWorld : Infinity
  let prey = null
  for (const other of nearby) {
    if (!canHunt(blob, other, config)) continue
    const dx = other.x - blob.x, dy = other.y - blob.y
    if (dx * dx + dy * dy > blob.sense ** 2) continue
    const reach = contact({ x: 0, y: 0, dx: blob.speedWorld * left, dy: 0 },
      { x: Math.hypot(dx, dy), y: 0, dx: (other.velocityX * dx + other.velocityY * dy) * left / (Math.hypot(dx, dy) || 1), dy: 0 },
      blob.r + other.r)
    if (reach === null || reach * left >= foodTime) continue
    if (!prey || other.speedWorld < prey.blob.speedWorld ||
        (other.speedWorld === prey.blob.speedWorld && (reach < prey.reach ||
          (reach === prey.reach && other.id < prey.blob.id)))) prey = { blob: other, reach }
  }
  if (prey) {
    blob.state = 2
    return towards({ x: prey.blob.x + prey.blob.velocityX * prey.reach * left,
      y: prey.blob.y + prey.blob.velocityY * prey.reach * left })
  }
  if (food) {
    blob.state = 1
    return towards(food)
  }
  blob.state = 0
  const margin = blob.r + 0.5
  if (Math.min(blob.x, blob.y, FIELD - blob.x, FIELD - blob.y) < margin) return towards({ x: 250, y: 250 })
  return blob.angle + (ctx.tick % 5 === 0 ? (random(config.seed, 6, ctx.day, ctx.tick, blob.id) - 0.5) * 70 * Math.PI / 180 : 0)
}

function refugeContact(blob, path) {
  const edge = blob.r + 6
  const x2 = path.x + path.dx, y2 = path.y + path.dy
  const distances = [[path.x, x2], [path.y, y2], [FIELD - path.x, FIELD - x2], [FIELD - path.y, FIELD - y2]]
  let time = Infinity
  for (const [start, end] of distances) {
    if (start <= edge) time = 0
    else if (end <= edge) time = Math.min(time, (start - edge) / (start - end))
  }
  return time
}

function tick(ctx, config) {
  const seconds = ctx.stepSeconds ?? DT
  const discreteCost = config.metabolism === 'walkthrough'
  const active = ctx.blobs.filter(b => b.alive && !b.home)
  if (!active.length) {
    ctx.tick++
    return
  }
  const plantGrid = new Grid(), blobGrid = new Grid(), pathGrid = new Grid()
  for (const plant of ctx.plants) if (!plant.eaten) plantGrid.insert(plant)
  for (const blob of active) blobGrid.insert(blob)
  const paths = new Map()
  // All intent queries read positions and velocities from the opening tick.
  for (const blob of active) {
    const wanted = intent(blob, ctx, config, plantGrid, blobGrid)
    blob.angle += clamp(turn(blob.angle, wanted), -2 * Math.PI * seconds, 2 * Math.PI * seconds)
    const path = { ...pathOf(blob, blob.angle, blob.speedWorld, seconds), spent: 0, blob }
    paths.set(blob.id, path)
    pathGrid.insert(path, path.x, path.y, path.x + path.dx, path.y + path.dy)
  }

  const move = (path, t) => {
    const b = path.blob
    b.x = path.x + path.dx * t
    b.y = path.y + path.dy * t
  }
  // The walkthrough pays for the entire move before a blob can collect food or hunt.
  if (discreteCost) {
    for (const path of paths.values()) {
      const b = path.blob
      if (b.energy > 0 && b.returning && refugeContact(b, path) === 0) continue
      const moved = b.energy > 0
      b.energy = Math.max(0, b.energy - b.moveCost)
      if (b.energy > 0) continue
      if (moved) move(path, 1)
      kill(ctx, b, (ctx.tick + Number(moved)) * seconds, 'Energy depletion')
    }
  }

  const candidates = []
  const push = (t, kind, path, target = null) => {
    if (t == null || t > 1) return
    candidates.push({ t, kind, path, target, tie: random(config.seed, 7, ctx.day, ctx.tick, path.blob.id, target?.id ?? target?.blob?.id ?? 0) })
  }
  for (const path of paths.values()) {
    const b = path.blob
    if (!b.alive) continue
    if (b.returning) push(refugeContact(b, path), 0, path)
    if (b.credits >= 2) continue
    const endX = path.x + path.dx, endY = path.y + path.dy
    for (const plant of plantGrid.near(path.x, path.y, b.r + 2, endX, endY)) {
      push(contact(path, plant, b.r + 2), 1, path, plant)
    }
    if (!config.predation) continue
    for (const other of new Set(pathGrid.near(path.x, path.y, b.r + 50, endX, endY))) {
      if (canHunt(b, other.blob, config)) push(contact(path, other, b.r + other.blob.r), 2, path, other)
    }
  }
  candidates.sort((a, b) => a.t - b.t || Number(a.kind !== 0) - Number(b.kind !== 0) || a.tie - b.tie ||
    a.path.blob.id - b.path.blob.id || a.kind - b.kind)
  const charge = (path, t) => {
    const b = path.blob
    if (!b.alive || b.home) return false
    if (discreteCost) {
      move(path, t)
      return true
    }
    const debit = b.rate * seconds * (t - path.spent)
    if (b.energy <= debit) {
      const fraction = path.spent + b.energy / (b.rate * seconds)
      move(path, fraction)
      b.energy = 0
      kill(ctx, b, (ctx.tick + fraction) * seconds, 'Energy depletion')
      return false
    }
    b.energy -= debit
    path.spent = t
    move(path, t)
    return true
  }
  for (const { t, kind, path, target } of candidates) {
    const b = path.blob
    if ((kind !== 0 && b.credits >= 2) || !charge(path, t)) continue
    const time = (ctx.tick + t) * seconds
    if (kind === 0) {
      b.home = true
      b.state = 5
      record(ctx, b, time, 'home')
    } else if (kind === 1 && !target.eaten) {
      target.eaten = true
      b.credits++
      const beforeEnergy = b.energy
      b.energy = Math.min(b.capacity, b.energy + config.plantReward)
      record(ctx, b, time, 'plant', { target: target.id, beforeEnergy })
    } else if (kind === 2 && charge(target, t)) {
      const victim = target.blob
      kill(ctx, victim, time, 'Predation', { target: b.id })
      b.credits++
      b.preyCredits++
      const beforeEnergy = b.energy
      b.energy = Math.min(b.capacity, b.energy + config.preyReward)
      record(ctx, b, time, 'prey', { target: victim.id, targetSpecies: victim.species, beforeEnergy })
    }
  }
  for (const path of paths.values()) {
    charge(path, 1)
    const b = path.blob
    b.velocityX = b.home ? 0 : path.dx / seconds
    b.velocityY = b.home ? 0 : path.dy / seconds
  }
  ctx.tick++
}

export function step(ctx, config, count = 1, skipIdle = false) {
  if (ctx.settled) return ctx.settled
  const stop = Math.min(ctx.limit ?? Infinity, ctx.tick + count)
  const hasActive = () => ctx.blobs.some(b => b.alive && !b.home)
  while (ctx.tick < stop) {
    if ((ctx.limit == null || skipIdle) && !hasActive()) {
      if (ctx.limit == null) break
      ctx.tick = stop
      break
    }
    tick(ctx, config)
  }
  return ctx.tick === ctx.limit || (ctx.limit == null && !hasActive()) ? dusk(ctx, config) : null
}

export function dusk(ctx, config) {
  if (ctx.settled) return ctx.settled
  const closing = []
  const time = (ctx.limit ?? ctx.tick) * (ctx.stepSeconds ?? DT)
  const species = new Map(config.species.map(s => [s.id, s]))
  for (const b of ctx.blobs) {
    if (!b.alive) continue
    if (!b.credits || !b.home) {
      kill(ctx, b, time, b.credits ? 'Missed home' : 'Starvation')
      continue
    }
    const survivor = { id: b.id, species: b.species, parent: b.parent, born: b.born,
      age: ++b.age, speed: b.speed, size: b.size, sense: b.sense }
    closing.push(survivor)
    if (b.credits < 2) continue
    const settings = species.get(b.species)
    const child = { ...survivor, age: 0, id: ctx.nextId++, parent: b.id, born: ctx.day }
    for (const [index, trait] of TRAITS.entries()) {
      if (settings.mutation[trait]) child[trait] = Math.max(1, b[trait] + Math.sqrt(settings.variance[trait]) *
        normal(config.seed, ctx.day, child.id, index))
    }
    closing.push(child)
    const newborn = { ...child, x: b.x, y: b.y, angle: b.angle, r: radius(child.size),
      capacity: settings.energy, energy: settings.energy, credits: 0, preyCredits: 0, state: 7, alive: true }
    record(ctx, newborn, time, 'birth', { parent: b.id })
    ctx.newborns ??= []
    ctx.newborns.push(newborn)
  }
  ctx.events.sort((a, b) => a.time - b.time)
  ctx.settled = { summary: summaries(ctx.day, config, ctx.opening, closing, ctx.events, ctx.plants.length,
    ctx.plants.filter(p => !p.eaten).length), checkpoint: { roster: closing, nextId: ctx.nextId } }
  return ctx.settled
}

export function snapshot(ctx) {
  const stepSeconds = ctx.stepSeconds ?? DT
  const time = ctx.tick * stepSeconds
  const duration = ctx.settled ? time : ctx.limit == null ? null : ctx.limit * stepSeconds
  return { day: ctx.day, time, duration, stepSeconds,
    blobs: [...ctx.blobs, ...(ctx.newborns ?? [])], plants: ctx.plants.filter(p => !p.eaten), events: ctx.events }
}
