import { canHunt, clamp, contact, edgePoint, FIELD, Grid } from './geometry.js'
import { random } from './random.js'

const active = blob => blob.alive && !blob.home
const distance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2
const towards = (a, b) => Math.atan2(b.y - a.y, b.x - a.x)
const reach = blob => Math.max(1, blob.size / 4)

function nearestPlant(blob, plants, range) {
  let closest, best = range ** 2
  for (const plant of plants.near(blob.x, blob.y, range)) {
    if (plant.eaten) continue
    const d = distance(blob, plant)
    if (d <= best && (d < best || !closest || plant.id < closest.id)) {
      best = d
      closest = plant
    }
  }
  return closest
}

function canReach(blob, target) {
  const r = reach(blob)
  return distance(blob, target) <= r ** 2 || (blob.lastMove && contact(blob.lastMove, target, r) !== null)
}

function orient(blob, nearby, plants, ctx, config) {
  let threat, prey
  const sight = blob.sense ** 2
  for (const other of nearby.near(blob.x, blob.y, blob.sense)) {
    const d = distance(blob, other)
    if (d > sight) continue
    if (canHunt(other, blob, config) && (!threat || d < distance(blob, threat))) threat = other
    if (canHunt(blob, other, config) && (!prey || other.speedWorld < prey.speedWorld)) prey = other
  }
  const jitter = (stream, id = 0) => (random(config.seed, stream, ctx.day, ctx.tick, blob.id, id) - 0.5) * Math.PI / 2
  const food = blob.credits < 2 ? nearestPlant(blob, plants, blob.sense) : null
  const stepsLeft = Math.min(blob.energy / (blob.rate * ctx.stepSeconds), (ctx.limit ?? Infinity) - ctx.tick)
  const reserve = stepsLeft - Math.sqrt(distance(blob, blob.target)) / (blob.speedWorld * ctx.stepSeconds)
  const wantsHome = blob.credits >= 2 || (blob.credits === 1 && reserve <= 10)
  if (wantsHome && canReach(blob, blob.target)) return { state: 5 }
  if (threat) return { state: 3, angle: towards(threat, blob) + jitter(9, threat.id) }
  if (wantsHome && (blob.credits >= 2 || reserve <= 5)) return { state: 4, angle: towards(blob, blob.target) }
  if (prey && (!food || distance(blob, prey) <= distance(blob, food))) return { state: 2, angle: towards(blob, prey) }
  if (food) return { state: 1, angle: towards(blob, food) }
  if (wantsHome) return { state: 4, angle: towards(blob, blob.target) }
  const angle = blob.angle + jitter(8)
  const x = blob.x + Math.cos(angle), y = blob.y + Math.sin(angle)
  return { state: 0, angle: x >= 0 && x <= FIELD && y >= 0 && y <= FIELD ? angle : towards(blob, { x: FIELD / 2, y: FIELD / 2 }) }
}

export function forage(ctx, config, record, kill, eat) {
  const { stepSeconds: seconds } = ctx
  const start = ctx.tick * seconds, end = (ctx.tick + 1) * seconds
  const plants = new Grid(), nearby = new Grid(), moved = new Grid()
  let remaining = 0
  for (const plant of ctx.plants) {
    if (plant.eaten) continue
    plants.insert(plant)
    remaining++
  }
  const blobs = ctx.blobs.filter(active)
  for (const blob of blobs) {
    blob.target = edgePoint(blob.x, blob.y)
    nearby.insert(blob)
  }
  // Choose directions from the same positions. Meals and hunts happen after everyone moves.
  const intentions = blobs.map(blob => orient(blob, nearby, plants, ctx, config))
  for (const [index, blob] of blobs.entries()) {
    const { state, angle } = intentions[index]
    const stride = blob.speedWorld * seconds
    blob.state = state
    if (state === 5) {
      blob.home = true
      blob.velocityX = blob.velocityY = 0
      record(ctx, blob, start, 'home')
      continue
    }
    if (stride < Number.EPSILON) {
      kill(ctx, blob, start, blob.credits ? 'Missed home' : 'Starvation')
      continue
    }
    const x = clamp(blob.x + stride * Math.cos(angle), 0, FIELD)
    const y = clamp(blob.y + stride * Math.sin(angle), 0, FIELD)
    const dx = x - blob.x, dy = y - blob.y
    blob.lastMove = { x: blob.x, y: blob.y, dx, dy }
    blob.angle = dx || dy ? Math.atan2(dy, dx) : angle
    blob.x = x
    blob.y = y
    blob.velocityX = dx / seconds
    blob.velocityY = dy / seconds
    blob.energy = Math.max(0, blob.energy - (blob.moveCost ?? blob.rate * seconds))
    if (blob.energy === 0) kill(ctx, blob, end, 'Energy depletion')
    else moved.insert(blob)
  }
  if (config.predation) {
    for (const hunter of blobs) {
      if (!active(hunter)) continue
      for (const prey of moved.near(hunter.x, hunter.y, reach(hunter) + hunter.speedWorld * seconds)) {
        if (active(prey) && canHunt(hunter, prey, config) && canReach(hunter, prey)) {
          kill(ctx, prey, end, 'Predation', { target: hunter.id })
          eat(ctx, config, hunter, prey, end, 'prey')
        }
      }
    }
  }
  for (const blob of blobs) {
    if (!active(blob) || blob.credits >= 2 || !remaining) continue
    const plant = nearestPlant(blob, plants, reach(blob) + blob.speedWorld * seconds)
    if (plant && canReach(blob, plant)) {
      remaining--
      eat(ctx, config, blob, plant, end, 'plant')
    }
  }
  if (!remaining) {
    for (const blob of blobs) if (active(blob) && !blob.credits) kill(ctx, blob, end, 'Starvation')
  }
  ctx.tick++
}
