import { dawn, founders, step, snapshot } from './simulation.js'
import { rulesFor } from './config.js'

const pause = () => new Promise(resolve => setTimeout(resolve, 0))
let config, checkpoint, partial, records, committed = 0, stopped = false, busy = false
const emit = (type, data = {}) => postMessage({ type, ...data })

function current() {
  partial ??= dawn(rulesFor(config, records, committed + 1), committed + 1, checkpoint)
  return partial
}

function settle(result) {
  const day = current().day
  checkpoint = result.checkpoint
  committed = day
  const final = snapshot(partial)
  partial = null
  emit('commit', { day, ...result, final: busy ? null : final })
}

function show() {
  if (canAdvance()) emit('frame', { frame: snapshot(current()) })
}

const canAdvance = () => committed < config.days && checkpoint.roster.length > 0

async function batch(target) {
  busy = true
  stopped = false
  while (committed < target && canAdvance()) {
    const state = current()
    const rules = rulesFor(config, records, state.day)
    let result
    do {
      const started = performance.now()
      do {
        result = step(state, rules, 1, true)
        if (!result && state.limit != null && !state.blobs.some(b => b.alive && !b.home)) {
          result = step(state, rules, state.limit, true)
        }
      } while (!result && performance.now() - started < 12)
      if (!result) await pause()
    } while (!result)
    settle(result)
    await pause()
    if (stopped) break
  }
  busy = false
  show()
  emit('done', { day: committed, stopped })
}

async function replay(message) {
  const { setup, start, day, records, id } = message
  let lastProgress = performance.now()
  function advanceReplay(state, rules, end) {
    while (!state.settled && state.tick < end) {
      step(state, rules, Math.min(20, end - state.tick), true)
      const now = performance.now()
      if (now - lastProgress >= 1000) {
        emit('replay-progress', { id })
        lastProgress = now
      }
    }
  }
  let at = message.checkpoint
  for (let i = start; i < day; i++) {
    const rules = rulesFor(setup, records, i)
    const ctx = dawn(rules, i, at)
    advanceReplay(ctx, rules, Infinity)
    at = ctx.settled.checkpoint
    await pause()
  }
  const rules = rulesFor(setup, records, day), state = dawn(rules, day, at)
  const startFrame = snapshot(state)
  const opening = structuredClone(startFrame.blobs)
  const plants = state.plants.map(p => ({ id: p.id, x: p.x, y: p.y }))
  const width = opening.length * 7
  const maxSamples = Math.max(3, Math.floor(16 * 1024 * 1024 / (Math.max(1, width) * 4)))
  let stride = state.limit == null ? 1 : Math.max(1, Math.ceil(state.limit / (maxSamples - 1)))
  let capacity = Math.min(16, maxSamples)
  let frames = new Float32Array(capacity * width)
  let index = 0
  let samples = 0
  function sample() {
    for (const b of state.blobs) {
      frames[index++] = b.x
      frames[index++] = b.y
      frames[index++] = b.angle
      frames[index++] = b.energy
      frames[index++] = b.credits
      frames[index++] = b.state
      frames[index++] = b.preyCredits
    }
    samples++
  }
  sample()
  while (!state.settled) {
    if (samples === capacity) {
      if (capacity < maxSamples) {
        capacity = Math.min(capacity * 2, maxSamples)
        const expanded = new Float32Array(capacity * width)
        expanded.set(frames)
        frames = expanded
      } else {
        // Keep the replay evenly spaced when a generation outgrows the buffer.
        for (let i = 2; i < samples; i += 2) frames.copyWithin(i / 2 * width, i * width, (i + 1) * width)
        stride *= 2
        samples = Math.ceil(samples / 2)
        index = samples * width
      }
    }
    advanceReplay(state, rules, (Math.floor(state.tick / stride) + 1) * stride)
    sample()
  }
  const final = snapshot(state)
  const used = frames.slice(0, index)
  postMessage({ type: 'track', id, track: { day, duration: final.duration,
    stepSeconds: state.stepSeconds, ticks: state.tick, stride,
    opening, plants, frames: used, events: state.events, checkpoint: state.settled.checkpoint, final } }, [used.buffer])
}

self.onmessage = async ({ data }) => {
  try {
    switch (data.type) {
      case 'replay': await replay(data); break
      case 'init':
        config = data.config
        records = data.records ?? []
        checkpoint = data.checkpoint ?? founders(config)
        partial = data.partial ?? null
        committed = data.committed ?? 0
        show()
        emit('ready')
        break
      case 'advance': {
        if (busy || !canAdvance()) return
        const state = current()
        const result = step(state, rulesFor(config, records, state.day), data.ticks)
        if (result) settle(result)
        else emit('frame', { frame: snapshot(state) })
        emit('advanced')
        break
      }
      case 'dawn':
        if (!busy) {
          if (data.restart && partial?.tick > 0) {
            partial = null
            emit('partial', { partial })
          }
          show()
        }
        break
      case 'batch': if (!busy) await batch(data.target); break
      case 'stop': stopped = true; break
      case 'extend': config.days = data.days; break
      case 'checkpoint': if (!busy) emit('partial', { partial }); break
    }
  } catch (error) {
    busy = false
    emit('error', { id: data.id, message: error.message })
  }
}
