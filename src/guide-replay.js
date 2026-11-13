import { starter } from './engine/config.js'
import { founders } from './engine/simulation.js'

export const SIGHT_EXAMPLE_DAYS = 1000
export const SIGHT_EXAMPLE_LATER_DAY = 648

export function guideSource(name) {
  const setup = starter()
  if (name === 'hunt') {
    Object.assign(setup, { seed:3, foraging:'walkthrough' })
    Object.assign(setup.species[0], { sense:28 })
    Object.assign(setup.species[1], { enabled:true, size:13, sense:50, energy:650 })
  }
  if (name === 'speed') {
    Object.assign(setup.species[0], { speed:9 })
    Object.assign(setup.species[1], { enabled:true, speed:12 })
  }
  if (name === 'scarcity') Object.assign(setup, { seed:3, food:10 })
  if (name === 'sight-comparison') Object.assign(setup, {
    seed:118, days:SIGHT_EXAMPLE_DAYS, foraging:'walkthrough', name:'Sight comparison',
  })
  if (name === 'offspring') {
    Object.assign(setup, { seed:1, food:60 })
    setup.species[0].sense = 16
    setup.species[0].standardDeviation.sense = 10
  }
  return { id:'guide-' + name, setup, revisions:[], checkpoints:[{ day:0, ...founders(setup) }] }
}

export function lessonMoments(id, track, next) {
  if (id === 'sight-comparison') {
    return [track, next].map((part, index) => ({
      track:part, from:0, to:Math.min(part.duration, 4),
      preview:Math.min(part.duration, 1.6),
      label:'Day '+part.day+(index ? ' · Later sight' : ' · Early sight'),
    }))
  }
  const event = (type, predicate = () => true) => track.events.find(item => item.type === type && predicate(item))
  const birth = event('birth')
  const home = event('home', item => item.id === birth?.parent)
  const bite = event('plant', item => item.id === birth?.parent)
  const hunt = event('prey', item => item.time >= 0.75)
  const clip = (point, before, after) => ({
    blob:point?.id, from:Math.max(0, (point?.time ?? 0) - before),
    to:Math.min(track.duration, (point?.time ?? 0) + after), track,
  })
  if (id === 'offspring') {
    const child = track.final.blobs.find(blob => blob.state === 7 && blob.sense > 0 && blob.sense < 5)
    const parentHome = event('home', item => item.id === child?.parent)
    if (!child || !parentHome || !next.opening.some(blob => blob.id === child.id)) throw new Error('The family replay is unavailable.')
    return [
      { ...clip(parentHome, 1.3, .35), vision:false, label:'Parent returns to refuge' },
      { track, blob:child.id, from:track.duration, to:track.duration, hold:1.4, vision:false, label:'A newborn at dusk' },
      { track:next, blob:child.id, from:0, to:Math.min(next.duration, 4), label:'The offspring searches on Day 2' },
    ]
  }
  if (id === 'food') return [clip(bite, .9, 1.1)]
  if (id === 'sight') return [clip(bite, 1.6, 1.3)]
  if (id === 'energy') return [clip(bite, 1.1, 2)]
  if (id === 'home') return [clip(home, 1.35, .9)]
  if (id === 'hunt') return [clip(hunt, .85, .35)]
  if (id === 'speed') return [{ track, blob:track.opening.find(blob => blob.speed === 12)?.id, from:0, to:Math.min(track.duration, 3) }]
  if (id === 'stride') return [{ ...clip(hunt, 2, 1), to:Math.min(track.duration, 1.8) }]
  return [{ track, from:0, to:track.duration }]
}
