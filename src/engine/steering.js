import { FIELD, canHunt, clamp, contact, pathOf, refugeContact, turn } from './geometry.js'
import { random } from './random.js'

const TURN_RATE = 2 * Math.PI
const THREAT_TIME = .6
const MEMORY_TIME = .6
const SIDES = [0, 1, 2, 3]
const bearing = (from, to) => Math.atan2(to.y - from.y, to.x - from.x)

export function steer(blob, wanted, seconds) {
  const angle = blob.angle + clamp(turn(blob.angle, wanted), -TURN_RATE * seconds, TURN_RATE * seconds)
  const speed = blob.speedWorld * Math.max(0, Math.cos(turn(angle, wanted)))
  return { ...pathOf(blob, angle, speed, seconds), angle }
}

function homePoint(side, x, y, width) {
  if (side === 0) return { x: Math.min(x, width), y }
  if (side === 1) return { x: Math.max(x, FIELD - width), y }
  if (side === 2) return { x, y: Math.min(y, width) }
  return { x, y: Math.max(y, FIELD - width) }
}

function homeTime(x, y, angle, speed, home) {
  const dx = home.x - x, dy = home.y - y
  if (!dx && !dy) return 0
  return Math.hypot(dx, dy) / speed + Math.abs(turn(angle, Math.atan2(dy, dx))) / TURN_RATE
}

// Find the first time the target meets the hunter's expanding reach circle.
function intercept(dx, dy, vx, vy, speed, reach) {
  const c = dx * dx + dy * dy - reach * reach
  if (c <= 0) return 0
  const a = vx * vx + vy * vy - speed * speed
  const b = dx * vx + dy * vy - speed * reach
  const discriminant = b * b - a * c
  if (discriminant < 0 || (a >= 0 && b >= 0)) return Infinity
  const divisor = -b + Math.sqrt(discriminant)
  return divisor > 0 ? c / divisor : Infinity
}

function wallRoom(x, y, blob) {
  return Math.min(x, y, FIELD - x, FIELD - y) - blob.r
}

function projectRoute(blob, heading, seconds, width, threats = [], enterHome = false) {
  let pose = blob
  let clearance = Infinity, wall = Infinity
  for (let tick = 0; tick < 3; tick++) {
    const path = steer(pose, heading, seconds)
    const end = enterHome ? refugeContact(path, width) : Infinity
    const fraction = Math.min(1, end)
    const x = path.x + path.dx * fraction, y = path.y + path.dy * fraction
    wall = Math.min(wall, wallRoom(x, y, blob))
    for (const { hunter, vx, vy } of threats) {
      const start = tick * seconds
      const dx = path.x - hunter.x - vx * start, dy = path.y - hunter.y - vy * start
      const rx = (path.dx - vx * seconds) * fraction, ry = (path.dy - vy * seconds) * fraction
      const near = clamp(-(dx * rx + dy * ry) / (rx * rx + ry * ry || 1), 0, 1)
      clearance = Math.min(clearance, Math.hypot(dx + rx * near, dy + ry * near) - blob.r - hunter.r)
    }
    pose = { x, y, r: blob.r, angle: path.angle, speedWorld: blob.speedWorld }
    if (end <= 1) return { wall, clearance, arrived: true, x, y }
  }
  return { wall, clearance, arrived: false, x: pose.x, y: pose.y }
}

function findThreats(blob, nearby, config) {
  const threats = []
  for (const hunter of nearby) {
    if (hunter.credits >= 2 || !canHunt(hunter, blob, config)) continue
    const moving = hunter.velocityX || hunter.velocityY
    const vx = moving ? hunter.velocityX : Math.cos(hunter.angle) * hunter.speedWorld
    const vy = moving ? hunter.velocityY : Math.sin(hunter.angle) * hunter.speedWorld
    const hit = contact({ x: hunter.x, y: hunter.y, dx: vx * THREAT_TIME, dy: vy * THREAT_TIME },
      { x: blob.x, y: blob.y, dx: blob.velocityX * THREAT_TIME, dy: blob.velocityY * THREAT_TIME }, hunter.r + blob.r)
    threats.push({ hunter, vx, vy, hit })
  }
  return threats.sort((a, b) => (a.hit ?? Infinity) - (b.hit ?? Infinity) || a.hunter.id - b.hunter.id)
}

function routeHome(blob, memory, width, left, seconds, threats) {
  const homes = SIDES.map(side => {
    const point = homePoint(side, blob.x, blob.y, width)
    const time = homeTime(blob.x, blob.y, blob.angle, blob.speedWorld, point)
    const heading = time ? bearing(blob, point) : blob.angle
    const route = threats.length && time ? projectRoute(blob, heading, seconds, width, threats, true) : null
    return { side, time, heading, safe: !route || route.clearance > 0, reachable: time <= left }
  })
  homes.sort((a, b) => Number(b.safe && b.reachable) - Number(a.safe && a.reachable) || a.time - b.time || a.side - b.side)
  const best = homes[0]
  const current = homes.find(home => home.side === memory.home)
  return current?.safe && current.reachable && (!best.safe || best.time > current.time - .2) ? current : best
}

function escapeHeading(blob, threat, threats, home, seconds, width) {
  const away = bearing(threat.hunter, blob)
  const headings = [away, away - Math.PI / 4, away + Math.PI / 4, away - Math.PI / 2, away + Math.PI / 2]
  if (blob.credits && home.reachable && home.safe) headings.push(home.heading)
  let bestHeading, bestScore
  for (const heading of headings) {
    const route = projectRoute(blob, heading, seconds, width, threats)
    const wallClear = route.wall > .01
    const separation = Math.min(...threats.map(({ hunter, vx, vy }) =>
      Math.hypot(route.x - hunter.x - vx * seconds * 3, route.y - hunter.y - vy * seconds * 3) - blob.r - hunter.r))
    const change = Math.abs(turn(blob.angle, heading))
    const score = [Number(wallClear), route.clearance, separation, -change]
    const difference = bestScore && score.map((value, i) => value - bestScore[i]).find(delta => Math.abs(delta) > 1e-8)
    if (!bestScore || difference > 0) {
      bestHeading = heading
      bestScore = score
    }
  }
  return bestHeading
}

function findMeal(blob, memory, visiblePlants, nearby, config, now, width, budget) {
  let best, current
  function score(kind, id, x, y, travelTime, reach, turning) {
    const dx = x - blob.x, dy = y - blob.y
    const dist = Math.hypot(dx, dy)
    const heading = dist ? Math.atan2(dy, dx) : blob.angle
    const time = travelTime + (turning ?? (travelTime > 0 ? Math.abs(turn(blob.angle, heading)) / TURN_RATE : 0))
    if (time > budget) return
    const fraction = dist ? Math.max(0, 1 - reach / dist) : 0
    const mealX = blob.x + dx * fraction, mealY = blob.y + dy * fraction
    const back = Math.min(...SIDES.map(side => homeTime(mealX, mealY, heading, blob.speedWorld,
      homePoint(side, mealX, mealY, width))))
    if (time + back > budget) return
    const meal = { kind, id, x, y, heading, time }
    if (memory.kind === kind && memory.id === id) current = meal
    if (!best || time < best.time || (time === best.time &&
        (kind === best.kind ? id < best.id : kind === 'plant'))) best = meal
  }

  for (const plant of visiblePlants) {
    const reach = blob.r + 2
    score('plant', plant.id, plant.x, plant.y,
      Math.max(0, Math.hypot(plant.x - blob.x, plant.y - blob.y) - reach) / blob.speedWorld, reach)
  }
  const known = memory.plant
  if (known) {
    if ((known.x - blob.x) ** 2 + (known.y - blob.y) ** 2 <= blob.sense ** 2) {
      memory.plant = visiblePlants.some(plant => plant.id === known.id) ? { ...known, time: now } : null
    } else if (now - known.time > MEMORY_TIME + 1e-9) {
      memory.plant = null
    } else {
      const reach = blob.r + 2
      score('plant', known.id, known.x, known.y,
        Math.max(0, Math.hypot(known.x - blob.x, known.y - blob.y) - reach) / blob.speedWorld, reach)
    }
  }
  for (const prey of nearby) {
    if (!canHunt(blob, prey, config)) continue
    const reach = blob.r + prey.r
    const vx = prey.velocityX, vy = prey.velocityY
    const dx = prey.x - blob.x, dy = prey.y - blob.y
    const direct = intercept(dx, dy, vx, vy, blob.speedWorld, reach)
    if (direct > 1 || direct > budget) continue
    const turning = direct ? Math.abs(turn(blob.angle, Math.atan2(dy + vy * direct, dx + vx * direct))) / TURN_RATE : 0
    const travelTime = turning ? intercept(dx + vx * turning, dy + vy * turning, vx, vy, blob.speedWorld, reach) : direct
    const arrival = travelTime + turning
    if (arrival > 1 || arrival > budget) continue
    const x = clamp(prey.x + vx * arrival, prey.r, FIELD - prey.r)
    const y = clamp(prey.y + vy * arrival, prey.r, FIELD - prey.r)
    score('prey', prey.id, x, y, travelTime, reach, turning)
  }
  const meal = current && best.time >= current.time * .8 ? current : best
  if (meal?.kind === 'plant' && visiblePlants.some(plant => plant.id === meal.id)) {
    memory.plant = { id: meal.id, x: meal.x, y: meal.y, time: now }
  }
  return meal
}

function searchHeading(blob, memory, ctx, config, seconds) {
  const window = Math.round(.5 / seconds)
  if (memory.searchUntil == null) {
    memory.heading = blob.angle
    memory.searchUntil = ctx.tick + window
  } else if (ctx.tick >= memory.searchUntil) {
    const change = (2 * random(config.seed, 6, ctx.day, ctx.tick, blob.id) - 1) * 25 * Math.PI / 180
    memory.heading = blob.angle + change
    memory.searchUntil = ctx.tick + window
  }
  if (wallRoom(blob.x, blob.y, blob) > 3 * blob.speedWorld * seconds + .5 ||
      projectRoute(blob, memory.heading, seconds, ctx.refugeWidth).wall > .5) return memory.heading
  const inset = blob.r + 3 * blob.speedWorld * seconds + .5
  const x = Number(blob.x < inset) - Number(FIELD - blob.x < inset)
  const y = Number(blob.y < inset) - Number(FIELD - blob.y < inset)
  const inward = x || y ? Math.atan2(y, x) : Math.atan2(FIELD / 2 - blob.y, FIELD / 2 - blob.x)
  memory.heading = inward + clamp(turn(inward, memory.heading), -Math.PI / 3, Math.PI / 3)
  return memory.heading
}

export function improvedIntent(blob, ctx, config, plantGrid, blobGrid, timeLeft) {
  const memory = blob.steering ??= {}
  const seconds = ctx.stepSeconds
  const now = ctx.tick * seconds
  const left = Math.min(timeLeft, blob.energy / blob.rate)
  const reserve = 2 * seconds
  const visible = ({ x, y }) => (x - blob.x) ** 2 + (y - blob.y) ** 2 <= blob.sense ** 2
  const nearby = config.predation ? [...blobGrid.near(blob.x, blob.y, blob.sense)].filter(visible) : []
  const threats = findThreats(blob, nearby, config)
  const urgent = threats.find(threat => threat.hit !== null)
  const home = routeHome(blob, memory, ctx.refugeWidth, left, seconds, threats)

  if (blob.credits >= 2 || (blob.credits && (left <= home.time + reserve ||
      (urgent && home.safe && home.reachable &&
        projectRoute(blob, home.heading, seconds, ctx.refugeWidth, threats, true).arrived)))) blob.returning = true
  if (urgent && !(blob.credits && home.time === 0) && !(blob.returning && home.safe && home.reachable)) {
    memory.searchUntil = null
    blob.state = 3
    return escapeHeading(blob, urgent, threats, home, seconds, ctx.refugeWidth)
  }
  if (!blob.returning) {
    const plants = [...plantGrid.near(blob.x, blob.y, blob.sense)].filter(visible)
    const meal = findMeal(blob, memory, plants, nearby, config, now, ctx.refugeWidth, left - reserve)
    if (meal) {
      memory.kind = meal.kind
      memory.id = meal.id
      memory.searchUntil = null
      blob.state = meal.kind === 'plant' ? 1 : 2
      return meal.heading
    }
    memory.kind = null
    if (blob.credits && left <= home.time + reserve + .75) blob.returning = true
  }
  if (blob.returning) {
    memory.home = home.side
    blob.state = 4
    return home.heading
  }
  blob.state = 0
  return searchHeading(blob, memory, ctx, config, seconds)
}
