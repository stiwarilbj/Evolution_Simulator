export const FIELD = 500
export const DT = 0.05
export const WALKTHROUGH_STEP = 0.1
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
export const radius = size => size <= 100 ? 0.25 * size : 25 + 25 * (size - 100) / size
export const travel = (blob, config) => 10 * blob.speed * (config.stride === 'linked' ? blob.size / 10 : 1)
export const walkthroughStepCost = (blob, config) =>
  (blob.size ** 3 * (travel(blob, config) * WALKTHROUGH_STEP) ** 2 + blob.sense) / 10000

export function cost(blob, config) {
  if (config.metabolism === 'walkthrough') return walkthroughStepCost(blob, config) / WALKTHROUGH_STEP
  if (config.metabolism === 'product') return blob.size ** 3 * blob.speed ** 2 * blob.sense / 20000
  return 0.001 * (blob.size ** 3 * (travel(blob, config) / 10) ** 2 + blob.sense)
}
export const canHunt = (hunter, prey, config) => config.predation && hunter.id !== prey.id &&
  hunter.size >= 1.2 * prey.size && (config.sameSpecies || hunter.species !== prey.species)

export function turn(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

export function homePoints(blob) {
  const edge = blob.r + 6
  return [
    { x: edge, y: blob.y }, { x: FIELD - edge, y: blob.y },
    { x: blob.x, y: edge }, { x: blob.x, y: FIELD - edge }
  ].map(point => {
    const dx = point.x - blob.x, dy = point.y - blob.y
    const distance = Math.hypot(dx, dy)
    return { ...point, dx, dy, distance: distance <= 6 && (
      blob.x <= edge || blob.x >= FIELD - edge || blob.y <= edge || blob.y >= FIELD - edge
    ) ? 0 : distance }
  }).sort((a, b) => a.distance - b.distance)
}

export function pathOf(blob, direction, speed, stepSeconds) {
  const dx = Math.cos(direction) * speed * stepSeconds, dy = Math.sin(direction) * speed * stepSeconds
  const tx = dx > 0 ? (FIELD - blob.r - blob.x) / dx : dx < 0 ? (blob.r - blob.x) / dx : 1
  const ty = dy > 0 ? (FIELD - blob.r - blob.y) / dy : dy < 0 ? (blob.r - blob.y) / dy : 1
  const stop = clamp(Math.min(tx, ty), 0, 1)
  return { x: blob.x, y: blob.y, dx: dx * stop, dy: dy * stop }
}

// Fraction along two simultaneous line segments at the first circle contact.
export function contact(a, b, r) {
  const x = a.x - b.x, y = a.y - b.y, dx = a.dx - (b.dx || 0), dy = a.dy - (b.dy || 0)
  const c = x * x + y * y - r * r
  if (c <= 0) return 0
  const aa = dx * dx + dy * dy, halfB = x * dx + y * dy
  if (aa === 0 || halfB >= 0) return null
  const discriminant = halfB * halfB - aa * c
  if (discriminant < 0) return null
  const t = (-halfB - Math.sqrt(discriminant)) / aa
  return t >= 0 && t <= 1 ? t : null
}

const CELL = 25
const SIDE = Math.ceil(FIELD / CELL)
const cell = value => clamp(Math.floor(value / CELL), 0, SIDE - 1)

export class Grid {
  constructor() { this.cells = new Map() }

  insert(item, x = item.x, y = item.y, x2 = x, y2 = y) {
    for (let i = cell(Math.min(x, x2)); i <= cell(Math.max(x, x2)); i++) {
      for (let j = cell(Math.min(y, y2)); j <= cell(Math.max(y, y2)); j++) {
        const key = i * SIDE + j
        if (!this.cells.has(key)) this.cells.set(key, [])
        this.cells.get(key).push(item)
      }
    }
  }

  *near(x, y, range, x2 = x, y2 = y) {
    for (let i = cell(Math.min(x, x2) - range); i <= cell(Math.max(x, x2) + range); i++) {
      for (let j = cell(Math.min(y, y2) - range); j <= cell(Math.max(y, y2) + range); j++) {
        yield* this.cells.get(i * SIDE + j) ?? []
      }
    }
  }
}
