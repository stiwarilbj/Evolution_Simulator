import { DT } from './engine/geometry.js'

export function prepareTrack(track) {
  track.eaten = new Map(track.events.filter(e => e.type === 'plant').map(e => [e.target, e.time]))
  track.changes = new Map()
  for (const event of track.events) {
    if (!track.changes.has(event.id)) track.changes.set(event.id, [])
    track.changes.get(event.id).push(event)
  }
  return track
}

export function trackFrame(track, time) {
  if (time >= track.duration - 1e-8) return track.final
  const { stride, opening, frames, changes, eaten } = track
  const index = Math.floor(time / (DT * stride))
  const aTime = index * DT * stride, bTime = Math.min(track.duration, aTime + DT * stride)
  const row = opening.length * 7
  const blobs = opening.map((blob, i) => {
    const p = index * row + i * 7, q = p + row
    const events = changes.get(blob.id)
    let credits = 0, preyCredits = 0, state = frames[p + 5]
    let from = { time:aTime, x:frames[p], y:frames[p+1], energy:frames[p+3] }
    let to = { time:bTime, x:frames[q], y:frames[q+1], energy:frames[q+3] }
    let terminal
    if (events) for (const event of events) {
      if (event.time > time) {
        if (event.time <= bTime && event.type!=='birth') to = { ...event, energy:event.beforeEnergy ?? event.energy }
        break
      }
      if (event.type === 'plant' || event.type === 'prey') credits++
      if (event.type === 'prey') preyCredits++
      if (event.type === 'death' || event.type === 'home') terminal = event
      if (event.time >= aTime && event.type!=='birth') from = event
    }
    const u = (time-from.time)/(to.time-from.time || 1)
    const blend = key => terminal ? terminal[key] : from[key]+(to[key]-from[key])*u
    if (terminal) state = terminal.type === 'death' ? 6 : 5
    const delta = frames[q + 2] - frames[p + 2]
    const angle = frames[p + 2] + Math.atan2(Math.sin(delta), Math.cos(delta)) * (time-aTime)/(bTime-aTime || 1)
    return { ...blob, x:blend('x'), y:blend('y'), angle, energy:Math.max(0,blend('energy')),
      credits, preyCredits, state, alive: state !== 6, home: state === 5 }
  })
  return { day: track.day, time, duration: track.duration, blobs,
    plants: track.plants.filter(p => (eaten.get(p.id) ?? Infinity) > time), events: track.events }
}
