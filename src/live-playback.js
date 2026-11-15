import { clamp, turn } from './engine/geometry.js'

function segment(from, to) {
  const events = new Map(), eaten = new Map()
  for (const event of to.events.slice(from.events.length)) {
    if (event.type === 'birth') continue
    if (event.type === 'plant') eaten.set(event.target, event.time)
    if (!events.has(event.id)) events.set(event.id, [])
    events.get(event.id).push(event)
  }
  for (const changes of events.values()) changes.sort((a, b) => a.time - b.time)
  return { from, to, events, eaten }
}

function sampleSegment({ from, to, events, eaten }, time) {
  const progress = (time - from.time) / (to.time - from.time)
  const blobs = from.blobs.map((old, index) => {
    // Live snapshots keep opening creatures in order and append any newborns.
    const blob = to.blobs[index]
    if (!old.alive || old.home) return old
    const changes = events.get(blob.id)
    const stop = changes?.find(event => event.type === 'home' || event.type === 'death')
    let start = old, end = blob, startTime = from.time, endTime = to.time
    let credits = old.credits, preyCredits = old.preyCredits
    let terminal
    for (const event of changes ?? []) {
      if (event.time > time) {
        end = { ...event, energy: event.beforeEnergy ?? event.energy }
        endTime = event.time
        break
      }
      start = event
      startTime = event.time
      if (event.type === 'plant' || event.type === 'prey') credits++
      if (event.type === 'prey') preyCredits++
      if (event.type === 'home' || event.type === 'death') terminal = event
    }
    const fraction = clamp((time - startTime) / (endTime - startTime || 1), 0, 1)
    const mix = key => terminal ? terminal[key] : start[key] + (end[key] - start[key]) * fraction
    const headingProgress = stop ? (terminal ? 1 : clamp((time - from.time) / (stop.time - from.time || 1), 0, 1)) : progress
    return { ...old, x: mix('x'), y: mix('y'), energy: Math.max(0, mix('energy')),
      angle: old.angle + turn(old.angle, blob.angle) * headingProgress, credits, preyCredits,
      state: terminal?.type === 'home' ? 5 : terminal?.type === 'death' ? 6 : old.state,
      alive: terminal?.type !== 'death', home: terminal?.type === 'home' }
  })
  const plants = eaten.size ? from.plants.filter(plant => (eaten.get(plant.id) ?? Infinity) > time) : from.plants
  return { ...to, time, blobs, plants }
}

// Buffer the confirmed live snapshots only. Replays already provide a pose for each cursor.
export function createLivePlayback() {
  let latest, shown, identity, lastRate = null, finishing = false
  let queue = [], time = 0, lastDraw = 0
  return (frame, now, { run, rate, finished = false } = {}) => {
    const span = frame && latest ? frame.time - latest.time : 0
    const next = frame !== latest
    const endOfPlayback = next && finished && lastRate != null && rate == null
    const nextRate = endOfPlayback || (finishing && !next) ? lastRate : rate
    const reset = !frame || run !== identity || nextRate == null || nextRate !== lastRate ||
      (next && (frame.day !== latest?.day || span <= 0 || span > .400000001 || frame.time - time > .500000001))
    identity = run
    if (reset) {
      queue = []
      latest = shown = frame
      time = frame?.time ?? 0
      lastRate = rate
      finishing = false
    } else {
      // Advance along queued segments. An empty queue holds at the newest confirmed pose.
      if (queue.length) time = Math.min(latest.time, time + (now - lastDraw) * nextRate / 1000)
      if (next) {
        queue.push(segment(latest, frame))
        latest = frame
        finishing = endOfPlayback
      }
      while (queue.length && time >= queue[0].to.time - 1e-9) {
        shown = queue.shift().to
      }
      if (queue.length) shown = sampleSegment(queue[0], time)
      else if (finishing) {
        finishing = false
        lastRate = null
      }
    }
    lastDraw = now
    return shown
  }
}
