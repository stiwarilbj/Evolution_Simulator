// A keyed, stateless stream keeps replay, render rate, and batch order independent.
export function random(seed, ...keys) {
  let hash = seed ^ 0x9e3779b9
  for (const key of keys) {
    hash = Math.imul(hash ^ key, 0x85ebca6b)
    hash ^= hash >>> 13
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0xc2b2ae35)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
}

export function normal(seed, day, id, trait) {
  const u = Math.max(2 ** -32, random(seed, 41, day, id, trait, 0))
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random(seed, 41, day, id, trait, 1))
}

export function shuffle(values, seed, day, stream) {
  const shuffled = [...values]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random(seed, stream, day, i) * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}
