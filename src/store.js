import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { rulesFor, starter, validate, validateRevisions } from './engine/config.js'
import { dawn, founders, snapshot } from './engine/simulation.js'
import { DT, clamp } from './engine/geometry.js'
import { listRuns, saveRun, saveRunPair, deleteRun } from './archive.js'
import { prepareTrack, trackFrame } from './track.js'

const createWorker = () => new Worker(new URL('./engine/worker.js', import.meta.url), { type: 'module' })
const copy = value => JSON.parse(JSON.stringify(value))
const makeRun = setup => {
  const initial = founders(setup)
  return { id: crypto.randomUUID(), setup: copy(setup), revisions: [], created: Date.now(),
    summaries: [], checkpoints: [{ day: 0, ...initial }], latest: initial, partial: null }
}
const last = run => run.summaries.at(-1)?.day ?? 0
function recordDay(run, { day, checkpoint, summary }) {
  const checkpoints = day % 10 === 0 ? [...run.checkpoints, { day, ...checkpoint }] : run.checkpoints
  return { ...run, summaries: [...run.summaries, summary], latest: checkpoint, partial: null, checkpoints }
}

function prepareExperiment(setup, signal, progress) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = createWorker()
    let experiment = makeRun(setup)
    function cleanup() {
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    function fail(error) {
      cleanup()
      reject(error)
    }
    function abort() { fail(signal.reason) }
    signal.addEventListener('abort', abort, { once:true })
    worker.onerror = () => fail(new Error('The experiment worker stopped. Try again.'))
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') worker.postMessage({ type:'batch', target:setup.days })
      if (data.type === 'error') fail(new Error(data.message))
      if (data.type === 'commit') {
        experiment = recordDay(experiment, data)
        progress(data.day)
      }
      if (data.type === 'done') {
        cleanup()
        if (last(experiment) !== setup.days) reject(new Error('The experiment ended before the requested day.'))
        else resolve(experiment)
      }
    }
    worker.postMessage({ type:'init', config:setup, checkpoint:experiment.latest })
  })
}

export const useLab = defineStore('lab', () => {
  const run = shallowRef(null), library = shallowRef([])
  const frame = shallowRef(null), liveFrame = shallowRef(null)
  const viewing = ref(1), replay = ref(false), playing = ref(false)
  const rate = ref(6), through = ref(false), scope = ref('all')
  const replayDay = ref(null), replayFailure = shallowRef(null)
  const loading = computed(() => replayDay.value != null)
  const batch = shallowRef(null), saved = ref(0), error = ref('')
  const workerReady = ref(false), connecting = ref(false), workerError = ref('')
  const selected = ref(null), following = ref(false)
  const settings = ref(false), draft = ref(null), modal = ref(null), targetDay = ref(null), branchFrom = ref(null)
  const downloadRange = shallowRef(null)
  const completed = computed(() => run.value ? last(run.value) : 0)
  const displayDuration = computed(() => frame.value?.duration ?? (run.value?.setup.duration ?? 100) / 10)
  const liveDay = computed(() => liveFrame.value?.day ?? completed.value + 1)
  const canEnterLive = computed(() => workerReady.value && !batch.value && completed.value < (run.value?.setup.days ?? 0))
  const canMoveNext = computed(() => viewing.value < completed.value ||
    (viewing.value === completed.value && canEnterLive.value))
  const status = computed(() => {
    if (loading.value) return 'Building replay'
    if (!replay.value && batch.value) return 'Simulating'
    if (!replay.value && completed.value >= (run.value?.setup.days ?? Infinity)) return 'Finished'
    if (replay.value) return 'Replay'
    if (workerError.value) return 'Simulation unavailable'
    if (playing.value) return 'Live'
    return frame.value?.time ? 'Paused' : 'Ready'
  })
  let writer, ticket = 0, cache = new Map(), track, epoch = 0, finishConnection
  let runRequest = 0, request = 0, batchViewRequest = 0
  let pending = false, requestedDawn = false, autoPrepare = false, restorePlay = false
  let cursor = 0, previous = 0, remainder = 0, renderAt = 0
  let raf, initialised = false, waiting = null
  let persistQueue = Promise.resolve()

  function persist(value = run.value) {
    if (!value) return
    const count = last(value)
    persistQueue = persistQueue.then(() => saveRun(value)).then(() => {
      library.value = [...library.value.filter(r => r.id !== value.id), value]
      if (run.value?.id === value.id) saved.value = count
    }).catch(() => { error.value = 'Local saving is unavailable. You can still export this run.' })
  }

  function disconnect() {
    ++epoch
    writer?.terminate()
    writer = undefined
    finishConnection?.(false)
    workerReady.value = false
  }

  function reportFailure(message) {
    const unfinished = batch.value || (liveFrame.value?.day > completed.value && liveFrame.value?.time > 0)
    const recovery = !unfinished ? '' : run.value.partial
      ? ' Retry to resume the unfinished day from its last checkpoint.'
      : ' The unfinished day will restart when you retry.'
    workerError.value = message + recovery
    disconnect()
    pending = false
    requestedDawn = false
    autoPrepare = false
    waiting = null
    batch.value = null
    playing.value = false
    if (modal.value === 'quick-progress') modal.value = null
  }

  function connect(value) {
    disconnect()
    const token = epoch
    connecting.value = true
    return new Promise(resolve => {
      const timeout = setTimeout(() => fail('The simulation took too long to start.'), 10000)
      finishConnection = success => {
        clearTimeout(timeout)
        finishConnection = null
        connecting.value = false
        resolve(success)
      }
      function fail(message) {
        if (token === epoch) reportFailure(message)
      }
      function workerFailed() {
        fail(workerReady.value ? 'The simulation stopped unexpectedly.' : 'The simulation could not start.')
      }
      try {
        writer = createWorker()
        writer.onerror = writer.onmessageerror = workerFailed
        writer.onmessage = ({ data }) => {
          if (token !== epoch) return
          if (data.type === 'error') return workerFailed()
          if (data.type === 'ready') {
            workerReady.value = true
            workerError.value = ''
            finishConnection?.(true)
          } else {
            receive(data)
          }
        }
        writer.postMessage({ type: 'init', config: value.setup, checkpoint: value.latest,
          committed: last(value), partial: value.partial, records: value.revisions })
      } catch {
        fail('The simulation could not start.')
      }
    })
  }

  function receive(data) {
    if (data.type === 'advanced') pending = false
    if (data.type === 'frame') {
      liveFrame.value = data.frame
      if (!replay.value && !batch.value && !loading.value) {
        frame.value = data.frame
        viewing.value = data.frame.day
      }
    }
    if (data.type === 'partial') {
      run.value = { ...run.value, partial: data.partial }
      persist()
    }
    if (data.type === 'commit') {
      const { day, final } = data
      run.value = recordDay(run.value, data)
      persist()
      if (final) {
        liveFrame.value = final
        if (!replay.value && !loading.value) {
          frame.value = final
          if (playing.value && through.value && day < run.value.setup.days) {
            requestedDawn = true
            writer.postMessage({ type: 'dawn' })
          } else playing.value = false
        }
      }
      if (waiting?.day === day) {
        const { resume } = waiting
        waiting = null
        void openDay(day, 0, resume)
      }
    }
    if (data.type === 'done') {
      const finished = batch.value
      const stopped = data.stopped && data.day < finished?.target
      const prepare = autoPrepare && data.day === 1 && !data.stopped
      const mayShowReplay = batchViewRequest === request && !loading.value && !replay.value
      batch.value = null
      autoPrepare = false
      if (prepare) {
        if (mayShowReplay) void openDay(1)
        if (run.value.setup.days > 1) simulate(run.value.setup.days, 'Preparing')
      } else if (!replay.value && !loading.value) {
        if (mayShowReplay && (finished?.label === 'Finish Day' || data.day >= run.value.setup.days)) {
          void openDay(data.day, Infinity)
        } else if (liveFrame.value) {
          frame.value = liveFrame.value
          viewing.value = liveFrame.value.day
        }
      }
      if (modal.value === 'quick-progress' && finished) {
        modal.value = stopped ? 'quick-stopped' : 'quick-done'
      }
    }
  }

  async function useRun(value, newRun = false, restoreDay = null, isCurrent = () => true) {
    const switchId = ++runRequest
    cancelReplay()
    const viewRequest = request
    stopPlayback()
    if (run.value && writer && !batch.value) {
      const oldWriter = writer
      if (!replay.value && liveFrame.value?.time > 0 && liveFrame.value.time < liveFrame.value.duration) {
        await new Promise(resolve => {
          const timeout = setTimeout(finish, 150)
          function finish() { clearTimeout(timeout); oldWriter.removeEventListener('message', onPartial); resolve() }
          function onPartial(event) { if (event.data.type === 'partial') finish() }
          oldWriter.addEventListener('message', onPartial)
          oldWriter.postMessage({ type: 'checkpoint' })
        })
      }
    }
    const canSwitch = () => switchId === runRequest && viewRequest === request && isCurrent()
    if (!canSwitch()) return false
    const sameRun = run.value?.id === value.id
    if (sameRun) value = run.value
    let restoredTrack
    if (run.value && !sameRun && restoreDay >= 1 && restoreDay <= last(value)) {
      replayDay.value = restoreDay
      try {
        restoredTrack = await getTrack(value, restoreDay)
      } catch {
        if (canSwitch()) replayFailure.value = { day: restoreDay, time: 0, resume: false }
        return false
      } finally {
        if (canSwitch()) replayDay.value = null
      }
      if (!canSwitch()) return false
    }
    cache = new Map()
    track = null
    replay.value = false
    pending = false
    requestedDawn = false
    waiting = null
    batch.value = null
    autoPrepare = false
    if (!sameRun) saved.value = last(value)
    selected.value = null
    following.value = false
    scope.value = 'all'
    through.value = value.setup.mode === 'live'
    run.value = value
    error.value = ''
    workerError.value = ''
    try { localStorage.setItem('evolution.active', value.id) } catch {}
    const day = Math.min(last(value) + 1, value.setup.days)
    viewing.value = day
    frame.value = value.partial ? snapshot(value.partial) :
      day > last(value) ? snapshot(dawn(rulesFor(value.setup,value.revisions,day), day, value.latest)) : null
    liveFrame.value = frame.value
    if (restoredTrack) {
      cache.set(value.id + ':' + restoreDay, restoredTrack)
      showReplay(restoredTrack, 0, false)
    }
    if (newRun) persist()
    const connected = await connect(value)
    if (switchId !== runRequest || !isCurrent()) return false
    if (connected && value.setup.mode === 'prepare' && !last(value)) {
      autoPrepare = true
      simulate(1, 'Preparing')
    } else if (viewRequest === request && !restoredTrack) {
      if (restoreDay >= 1 && restoreDay <= last(value)) await openDay(restoreDay)
      else if (restoreDay == null && (value.setup.mode === 'prepare' || last(value) >= value.setup.days)) {
        await openDay(last(value))
      }
    }
    return switchId === runRequest && isCurrent()
  }

  async function retrySimulation() {
    if (!run.value || !workerError.value || connecting.value) return
    const value = run.value
    const viewRequest = request
    if (!await connect(value) || run.value?.id !== value.id) return
    if (value.setup.mode === 'prepare' && !last(value)) {
      autoPrepare = true
      simulate(1, 'Preparing')
    } else if (viewRequest === request && !frame.value && completed.value) {
      await openDay(replayFailure.value?.day ?? completed.value)
    }
  }

  async function init() {
    if (initialised) return
    initialised = true
    try { library.value = await listRuns() } catch {}
    const address = location.hash.match(/^#\/r\/([^/]+)\/s\/(\d+)\//)
    let activeId
    try { activeId = localStorage.getItem('evolution.active') } catch {}
    const found = library.value.find(r => r.id === address?.[1]) ?? library.value.find(r => r.id === activeId)
    await useRun(found ?? makeRun(starter()), !found, found?.id===address?.[1] && address ? +address[2] : null)
    raf = requestAnimationFrame(animate)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopPlayback()
    })
    setInterval(() => {
      if (playing.value && !replay.value && !batch.value) writer?.postMessage({ type: 'checkpoint' })
    }, 5000)
  }

  async function preparePair(setups, signal, progress, onSaving) {
    for (const setup of setups) {
      const issue = Object.values(validate(setup))[0]
      if (issue) throw new Error(issue)
    }
    const left = await prepareExperiment(setups[0], signal, day => progress(0, day))
    const right = await prepareExperiment(setups[1], signal, day => progress(1, day))
    signal.throwIfAborted()
    onSaving()
    try { await saveRunPair(left, right) }
    catch { throw new Error('Could not save the experiment pair in this browser. Try again when local storage is available.') }
    library.value = [...library.value, left, right]
    return { left:left.id, right:right.id, day:1 }
  }

  function getTrack(value, day) {
    const key = value.id + ':' + day
    if (cache.has(key)) {
      const result = cache.get(key)
      cache.delete(key)
      cache.set(key, result)
      return Promise.resolve(result)
    }
    const runCache = cache
    return new Promise((resolve, reject) => {
      const start = [...value.checkpoints].reverse().find(c => c.day < day)
      if (!start) throw new Error('This day has no opening checkpoint.')
      const job = createWorker()
      const id = ++ticket
      function fail() {
        job.terminate()
        reject(new Error('Replay reconstruction stopped.'))
      }
      job.onerror = job.onmessageerror = fail
      job.onmessage = ({ data }) => {
        if (data.id !== id) return
        job.terminate()
        if (data.type === 'error') { reject(new Error(data.message)); return }
        try {
          const result = prepareTrack(data.track)
          runCache.set(key, result)
          while (runCache.size > 3) runCache.delete(runCache.keys().next().value)
          resolve(result)
        } catch (error) { reject(error) }
      }
      try {
        job.postMessage({ type: 'replay', id, setup: value.setup, records: value.revisions,
          start: start.day + 1, checkpoint: start, day })
      } catch { fail() }
    })
  }

  function cancelReplay() {
    ++request
    waiting = null
    replayDay.value = null
    replayFailure.value = null
  }

  function showReplay(result, time, resume) {
    const nextCursor = clamp(time, 0, result.duration)
    const nextFrame = trackFrame(result, nextCursor)
    if (!replay.value) through.value = false
    track = result
    cursor = nextCursor
    replay.value = true
    viewing.value = result.day
    frame.value = nextFrame
    if (following.value && !nextFrame.blobs.some(b => b.alive && b.id === selected.value)) following.value = false
    playing.value = resume
  }

  async function openDay(day, time = 0, resume = false) {
    if (!run.value || !Number.isInteger(day) || day < 1 || day > completed.value) return false
    const value = run.value
    const token = ++request
    stopPlayback()
    replayFailure.value = null
    replayDay.value = day
    try {
      const result = await getTrack(value, day)
      if (run.value?.id !== value.id || token !== request) return false
      showReplay(result, time, resume)
      return true
    } catch {
      if (token === request) replayFailure.value = { day, time, resume }
      return false
    } finally {
      if (token === request) replayDay.value = null
    }
  }

  function retryReplay() {
    const failure = replayFailure.value
    if (failure) return openDay(failure.day, failure.time, failure.resume)
  }

  function stopPlayback() {
    waiting = null
    if (playing.value && !replay.value && writer && !batch.value) writer.postMessage({ type: 'checkpoint' })
    playing.value = false
    remainder = 0
  }

  function goLive(restart = false) {
    if (!canEnterLive.value) return
    cancelReplay()
    stopPlayback()
    replay.value = false
    through.value = true
    if (restart && liveFrame.value?.day > completed.value && liveFrame.value.time > 0) {
      const day = completed.value + 1
      const { setup, revisions, latest } = run.value
      liveFrame.value = snapshot(dawn(rulesFor(setup, revisions, day), day, latest))
    }
    if (liveFrame.value?.day > completed.value) {
      frame.value = liveFrame.value
      viewing.value = liveFrame.value.day
    }
    writer.postMessage({ type: 'dawn', restart })
  }

  function prepareOrLive() {
    if (batch.value?.label === 'Preparing') {
      const activeWriter = writer
      const viewRequest = request
      const stopThenGo = ({data}) => {
        if (data.type !== 'done') return
        activeWriter.removeEventListener('message', stopThenGo)
        if (writer === activeWriter && viewRequest === request) goLive()
      }
      writer.addEventListener('message', stopThenGo)
      stopBatch()
    } else goLive()
  }

  function seek(time) {
    if (!replay.value || loading.value || !track) return
    cursor = clamp(time, 0, track.duration)
    frame.value = trackFrame(track, cursor)
  }

  function play() {
    if (playing.value || waiting) { stopPlayback(); return }
    if (loading.value || !frame.value || (!replay.value && (!workerReady.value || batch.value))) return
    if (replay.value && cursor >= displayDuration.value) seek(0)
    else if (!replay.value && frame.value.time >= frame.value.duration) {
      if (completed.value >= run.value.setup.days) { void openDay(completed.value, 0, true); return }
      requestedDawn = true
      writer.postMessage({ type: 'dawn' })
    }
    playing.value = true
  }

  function stepOnce() {
    stopPlayback()
    if (replay.value) seek(cursor + DT)
    else if (workerReady.value && !loading.value && !pending && !batch.value && frame.value?.time < displayDuration.value) {
      pending = true
      writer.postMessage({ type: 'advance', ticks: 1 })
    }
  }

  function moveDay(delta) {
    const day = viewing.value + delta
    if (day >= 1 && day <= completed.value) void openDay(day)
    else if (delta === 1 && viewing.value === completed.value) goLive(true)
  }

  function animate(now) {
    const elapsed = Math.min((now - previous) / 1000, 0.12)
    previous = now
    if (requestedDawn && liveFrame.value?.time === 0) requestedDawn = false
    if (playing.value && !loading.value && !requestedDawn) {
      const delta = elapsed * 2 ** ((rate.value - 6) / 2)
      if (replay.value && track) {
        cursor = Math.min(track.duration, cursor + delta)
        if (now - renderAt >= 16 || cursor === track.duration) {
          frame.value = trackFrame(track, cursor)
          renderAt = now
        }
        if (cursor >= track.duration) {
          playing.value = false
          if (through.value && track.day < completed.value) void openDay(track.day + 1, 0, true)
          else if (through.value && batch.value && track.day < run.value.setup.days) waiting = { day: track.day + 1, resume: true }
        }
      } else if (!batch.value) {
        remainder = Math.min(0.4, remainder + delta)
        if (remainder >= DT && !pending) {
          const ticks = Math.floor(remainder / DT)
          remainder -= ticks * DT
          pending = true
          writer.postMessage({ type: 'advance', ticks })
        }
      }
    }
    raf = requestAnimationFrame(animate)
  }

  function simulate(target, label = 'Quick Sim') {
    if (!canEnterLive.value || !Number.isInteger(target) || target <= completed.value || target > run.value.setup.days) return false
    if (!replay.value) stopPlayback()
    batchViewRequest = request
    batch.value = { target, start: completed.value, label, stopping: false }
    writer.postMessage({ type: 'batch', target })
    return true
  }

  function stopBatch() {
    if (!batch.value || batch.value.stopping) return
    batch.value = { ...batch.value, stopping: true }
    writer.postMessage({ type: 'stop' })
  }

  function quickForDay(day) {
    targetDay.value = batch.value ? null : day
    modal.value = batch.value ? 'quick-progress' : 'quick'
  }

  function openDownload(range = null) {
    downloadRange.value = range
    modal.value = 'download'
  }

  function extend(days) {
    if (!workerReady.value || batch.value || days <= run.value.setup.days || days > 1000) return
    run.value = { ...run.value, setup: { ...run.value.setup, days } }
    writer.postMessage({ type: 'extend', days })
    persist()
    modal.value = null
    if (run.value.setup.mode === 'prepare') simulate(days, 'Preparing')
  }

  function openSettings(setup, from = null) {
    if (!settings.value) restorePlay = playing.value
    stopPlayback()
    if (setup || !draft.value || branchFrom.value != null) draft.value = copy(setup ?? run.value?.setup ?? starter())
    branchFrom.value = from
    settings.value = true
    modal.value = null
  }

  function closeSettings() {
    settings.value = false
    if (restorePlay && !playing.value) play()
    restorePlay = false
  }

  async function evolve(setup) {
    const issues = validate(setup)
    const fork = branchFrom.value
    if (fork != null && setup.days <= fork) issues.days = 'The run must continue beyond Day '+fork+'.'
    if (Object.keys(issues).length) return issues
    if (fork != null) {
      try { await branch(fork,copy(setup)) }
      catch (e) { return { branch:e.message } }
    }
    settings.value = false
    draft.value = null
    branchFrom.value = null
    restorePlay = false
    if (fork == null) await useRun(makeRun(setup), true)
    return {}
  }

  async function switchRun(value, isCurrent, restoreDay) {
    modal.value = null
    draft.value = null
    return useRun(value, false, restoreDay, isCurrent)
  }

  async function importBranch(setup,revisions) {
    if (Object.keys(validate(setup)).length || !validateRevisions(setup,revisions)) return false
    const value=makeRun(setup)
    value.revisions=copy(revisions)
    value.forkDay=revisions.at(-1).day-1
    modal.value=null
    draft.value=null
    await useRun(value,true)
    return true
  }

  function rename(value, name) {
    const updated = { ...value, setup: { ...value.setup, name } }
    if (run.value?.id === value.id) run.value = updated
    persist(updated)
  }

  async function remove(id) {
    if (run.value?.id === id) return
    try {
      await persistQueue
      await deleteRun(id)
      library.value = library.value.filter(r => r.id !== id)
    } catch { error.value = 'Could not remove that saved run.' }
  }

  async function branch(day, setup) {
    if (!run.value || day < 1 || day > completed.value || Object.keys(validate(setup)).length) return
    const base = run.value
    const opening = [...base.checkpoints].reverse().find(c => c.day <= day)
    const after = opening.day === day ? opening : (await getTrack(base, day)).checkpoint
    const value = { ...makeRun(setup), source: base.id, forkDay: day, latest: after,
      summaries: base.summaries.filter(r => r.day <= day),
      checkpoints: [...base.checkpoints.filter(c => c.day < day), { day, ...after }],
      revisions: [...(base.revisions.length ? base.revisions.filter(r => r.day <= day) : [{ day: 1, setup: base.setup }]),
        { day: day + 1, setup }],
    }
    modal.value = null
    await useRun(value, true)
    if (setup.mode === 'prepare' && day < setup.days) simulate(setup.days, 'Preparing')
  }

  return { run, library, frame, viewing, liveFrame, liveDay, replay, playing, rate, through, scope, loading, batch, saved,
    error, workerReady, connecting, workerError, retrySimulation, replayDay, replayFailure, cancelReplay, retryReplay,
    canEnterLive, canMoveNext, selected, following, settings, draft, modal, completed, displayDuration, status, init, openDay, goLive, seek, play,
    stopPlayback, stepOnce, moveDay, simulate, stopBatch, extend, openSettings, closeSettings, evolve, switchRun, rename,
    remove, getTrack, branch, prepareOrLive, targetDay, quickForDay, branchFrom, importBranch, preparePair, openDownload, downloadRange }
})
