<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronDown, X } from 'lucide-vue-next'
import { useLab } from './store.js'
import { randomSeed, validate } from './engine/config.js'
import { setupFromLink } from './export.js'
import { guidedExamples, lessons } from './guide.js'
import World from './components/World.vue'
const Trends=defineAsyncComponent(()=>import('./components/Trends.vue'))
const Settings=defineAsyncComponent(()=>import('./components/Settings.vue'))
const About=defineAsyncComponent(()=>import('./components/About.vue'))
const RunDialog=defineAsyncComponent(()=>import('./components/RunDialog.vue'))
const Compare=defineAsyncComponent(()=>import('./components/Compare.vue'))
const Tour=defineAsyncComponent(()=>import('./components/Tour.vue'))
const GuidedWorld=defineAsyncComponent(()=>import('./components/GuidedWorld.vue'))

const lab = useLab()
const pages = { viewer:'World', stats:'Trends', about:'About', compare:'Compare' }
const runAddress = /^#\/r\/([^/]+)\/s\/(\d+)\/(viewer|stats|about|compare)(\?.*)?$/
const initialAddress = location.hash.match(runAddress)
const initialPage = initialAddress?.[3] ?? 'viewer'
const initialQuery = new URLSearchParams(initialAddress?.[4])
const page = ref(initialPage), ready = ref(false), menu = ref(false), world = ref(), menuButton = ref(), mainSurface = ref()
const fullscreenSurface = ref(null)
const comparison = ref(readComparison(initialQuery))
const example = ref(initialPage==='viewer' ? knownExample(initialQuery.get('example')) : null)
const lesson = ref(readLesson(initialQuery))
const comparisonVersion = ref(0), visited = ref({ viewer:true,[initialPage]:true })
const scrolls = new Map()
let navigating = false, routeRequest = 0, retryNavigation, sharedSetupHash

function readComparison(query) {
  return { left:query.get('left'), right:query.get('right'), day:Number(query.get('pairDay')) || null }
}
function knownExample(id) { return Object.hasOwn(guidedExamples,id) ? id : null }
function readLesson(query) { return lessons.find(item=>item.id===query.get('lesson'))?.id ?? 'opening' }
function address(view = page.value, day = lab.viewing, settings = lab.settings, guided = example.value) {
  if (!lab.run) return '#/'
  const query = new URLSearchParams()
  if (view==='compare') {
    const { left, right, day:pairDay } = comparison.value
    if (left != null) query.set('left',left)
    if (right != null) query.set('right',right)
    if (pairDay) query.set('pairDay',pairDay)
  }
  if (view==='viewer' && guided) query.set('example',guided)
  if ((view==='about' || view==='viewer' && guided) && lesson.value!=='opening') query.set('lesson',lesson.value)
  if (settings) query.set('cfg','1')
  return '#/r/'+lab.run.id+'/s/'+day+'/'+view+(query.size ? '?'+query : '')
}
function syncAddress() {
  if (lab.settings && location.hash === sharedSetupHash) return
  history.replaceState(null,'',address())
}
const canLive = computed(() => lab.replay && (lab.canEnterLive ||
  lab.batch?.label==='Preparing' && !lab.batch.stopping && lab.completed < lab.run.setup.days))
const statusText = computed(() => 'Day '+lab.viewing+' / '+lab.run.setup.days+' · '+lab.status)
function skipToContent() { document.getElementById("main-surface")?.focus() }
function dismissMenu(event) {
  if (!event.target.closest('.run-center')) menu.value = false
}
function escapeMenu(event) {
  if (event.key==='Escape' && menu.value) { menu.value=false; menuButton.value?.focus() }
}
function show(view) {
  if (page.value===view) return
  if (page.value==='viewer' && view!=='viewer') lab.stopPlayback()
  scrolls.set(page.value, mainSurface.value?.scrollTop ?? 0)
  page.value = view
  visited.value[view] = true
  menu.value = false
  nextTick(() => {
    if (page.value === view) mainSurface.value?.scrollTo(0, scrolls.get(view) ?? 0)
  })
}
function beginNavigation() {
  lab.cancelReplay()
  retryNavigation = null
  sharedSetupHash = null
  navigating = false
  return ++routeRequest
}
function go(view, guided = null) {
  const changed = view !== page.value || guided !== example.value
  beginNavigation()
  if (guided) lab.stopPlayback()
  example.value = guided
  show(view)
  menu.value = false
  if (changed) history.pushState(null,'',address())
  else if (lab.run) history.replaceState(null,'',address())
}
function changeLesson(id) {
  lesson.value = id
  if (page.value==='about') syncAddress()
}
async function applyAddress(hash = location.hash) {
  const token = beginNavigation()
  const current = () => token === routeRequest
  if (hash.startsWith('#/setup/')) {
    try {
      const setup=setupFromLink(hash)
      if (Object.keys(validate(setup)).length) throw new Error()
      lab.openSettings(setup)
      sharedSetupHash = hash
    } catch { lab.error='This experiment link contains an invalid setup.' }
    return
  }
  const match = hash.match(runAddress)
  if (!match || !lab.run) return
  const query = new URLSearchParams(match[4])
  navigating = true
  try {
    if (match[1]!==lab.run.id) {
      const saved = lab.library.find(run => run.id===match[1])
      if (saved && !await lab.switchRun(saved, current, +match[2])) {
        if (current() && lab.replayFailure) retryNavigation = { failure: lab.replayFailure, retry: () => applyAddress(hash) }
        return
      }
    }
    if (!current()) return
    const day = +match[2]
    if (day >= 1 && day <= lab.completed && (day !== lab.viewing || !lab.replay)) {
      const opened = lab.replayFailure?.day !== day && await lab.openDay(day)
      if (!opened) {
        if (current() && lab.replayFailure) retryNavigation = { failure: lab.replayFailure, retry: () => applyAddress(hash) }
        return
      }
    }
    else if (day>lab.completed && lab.replay) lab.goLive()
    if (!current()) return
    if (match[3]==='compare') {
      comparison.value = readComparison(query)
      comparisonVersion.value++
    }
    example.value = match[3]==='viewer' ? knownExample(query.get('example')) : null
    if (example.value) lab.stopPlayback()
    if (match[3]==='about' || example.value) lesson.value = readLesson(query)
    show(match[3])
    if (query.get('cfg')==='1' && !lab.settings) lab.openSettings()
    else if (query.get('cfg')!=='1' && lab.settings) lab.closeSettings()
    await nextTick()
  } finally {
    if (current()) {
      navigating = false
      history.replaceState(null,'',address())
    }
  }
}
function handlePopState() { void applyAddress() }
async function watchDay(day, id, { sense = false, atEnd = false } = {}) {
  const token = beginNavigation()
  const current = () => token === routeRequest
  navigating = true
  lab.modal = null
  try {
    if (day <= lab.completed && !await lab.openDay(day, atEnd ? Infinity : 0)) {
      if (current() && lab.replayFailure) retryNavigation = { failure: lab.replayFailure, retry: () => watchDay(day, id, { sense, atEnd }) }
      return
    }
    if (!current()) return
    if (day > lab.completed && lab.replay) lab.goLive()
    if (id != null && lab.frame?.blobs.some(blob => blob.alive && blob.id === id)) world.value?.select(id)
    const changed = page.value !== 'viewer' || example.value !== null
    example.value = null
    show('viewer')
    if (changed) history.pushState(null,'',address())
    else history.replaceState(null,'',address())
    if (sense) {
      await nextTick()
      if (current()) world.value?.overhead(sense==='cohort')
    }
  } finally {
    if (current()) navigating = false
  }
}
function retryReplay() {
  if (retryNavigation?.failure === lab.replayFailure) void retryNavigation.retry()
  else void lab.retryReplay()
}
function compare(id) {
  openComparison({ left:lab.run.id, right:id ?? null, day:lab.viewing })
}
function openComparison(pair) {
  comparison.value = pair
  comparisonVersion.value++
  lab.modal = null
  go('compare')
}
function comparisonChanged(pair) {
  comparison.value = pair
  if (ready.value && !navigating && page.value==='compare') syncAddress()
}
function settings(setup) {
  beginNavigation()
  menu.value=false
  lab.openSettings(setup)
}
function reroll() {
  settings({ ...lab.run.setup, seed:randomSeed(lab.run.setup.seed) })
}
function task(key) {
  menu.value=false
  lab.modal=key
}
async function openRun(value, view) {
  if (view === 'stats' && value.id === lab.run.id) {
    lab.modal = null
    go(view)
    return
  }
  const token = beginNavigation()
  const current = () => token === routeRequest
  navigating = true
  try {
    if (await lab.switchRun(value, current) && current()) {
      example.value = null
      show(view)
      history.pushState(null,'',address())
    }
  } finally {
    if (current()) navigating = false
  }
}
watch(() => [lab.run?.id,lab.viewing,lab.settings], ([id], [previousId]) => {
  if (!ready.value || navigating || !id) return
  if (id!==previousId) {
    example.value = null
    show('viewer')
    history.pushState(null,'',address())
  } else syncAddress()
})
onMounted(async () => {
  let firstVisit=false
  try { firstVisit=!location.hash && !localStorage.getItem('evolution.active') && !localStorage.getItem('evolution.tour') } catch {}
  await lab.init()
  ready.value = true
  window.addEventListener('popstate',handlePopState)
  document.addEventListener('pointerdown',dismissMenu)
  document.addEventListener('keydown',escapeMenu)
  if (location.hash) {
    await applyAddress()
  } else {
    if (firstVisit && lab.workerReady) lab.modal = 'tour'
    history.replaceState(null,'',address())
  }
})
onUnmounted(() => {
  window.removeEventListener('popstate',handlePopState)
  document.removeEventListener('pointerdown',dismissMenu)
  document.removeEventListener('keydown',escapeMenu)
})
</script>

<template>
  <a class="skip-link" href="#main-surface" @click.prevent="skipToContent">Skip to content</a>
  <header class="app-header">
    <nav aria-label="Main navigation" :inert="!ready">
      <a class="brand" :href="address('viewer',lab.viewing,lab.settings,null)" aria-label="Evolution Simulator home" @click.prevent="go('viewer')">
        <svg viewBox="0 0 30 30" width="30" height="30" fill="none" aria-hidden="true">
          <path d="M8.1 11.1C9.3 5.5 12.1 2.9 16.3 3.8c3 .6 4.5 2.8 4.8 5.2.2 1.4 1 2.5 2.7 4.7 4.6 6.1.6 12.4-7.4 12.6C7.3 26.5 3.9 22.4 5.6 17.1c.6-1.8 1.9-4.2 2.5-6Z" stroke="currentColor" stroke-width="1.6"/>
          <circle cx="16" cy="11.2" r="1.05" fill="currentColor"/><circle cx="20" cy="13.2" r=".85" fill="currentColor"/>
        </svg>
      </a>
      <a v-for="view in ['about','viewer','stats']" :key="view" :href="address(view,lab.viewing,lab.settings,null)" :aria-current="page===view?'page':undefined"
        @click.prevent="go(view)">{{ pages[view] }}</a>
      <a v-if="page==='compare'" :href="address('compare')" aria-current="page" @click.prevent>Compare</a>
    </nav>
    <div v-if="lab.run" class="run-center" :inert="!ready">
      <button class="primary settings-pill" aria-label="Simulation Settings" @click="settings()">settings</button>
      <button ref="menuButton" class="run-status" aria-label="Run options" :aria-expanded="menu" :title="lab.run.setup.name" @click="menu=!menu">
        {{ statusText }} <ChevronDown :size="12"/>
      </button>
      <div v-if="menu" class="pop run-menu">
        <strong>{{ lab.run.setup.name }}</strong>
        <small>Seed {{ lab.run.setup.seed }} · Saved through Day {{ lab.saved }}</small>
        <button @click="task('library')">Run Library</button>
        <button @click="compare()">Compare runs</button>
        <button :disabled="!lab.latestBranchDay" @click="task('branch')">Branch here</button>
        <button v-if="canLive" @click="go('viewer'); lab.prepareOrLive()">Back to Live</button>
        <button @click="task('tour')">Show tour</button>
      </div>
    </div>
  </header>
  <Teleport :to="fullscreenSurface || 'body'" :disabled="!fullscreenSurface">
    <div v-if="lab.workerError || lab.replayFailure || lab.error" class="error-banner" role="alert">
      <span>{{ lab.workerError || (lab.replayFailure ? 'Could not open the replay for Day '+lab.replayFailure.day+'.' : lab.error) }}</span>
      <button v-if="lab.workerError" class="secondary" :disabled="lab.connecting" @click="lab.retrySimulation">
        {{ lab.connecting ? 'Retrying…' : 'Retry simulation' }}
      </button>
      <button v-else-if="lab.replayFailure" class="secondary" @click="retryReplay">Retry replay</button>
      <button v-else class="icon" aria-label="Dismiss error" @click="lab.error=''"><X :size="17"/></button>
    </div>
  </Teleport>
  <div id="main-surface" ref="mainSurface" :class="{ 'reading-surface':page!=='viewer' || example }" tabindex="-1" :inert="!ready">
    <template v-if="lab.run">
      <World v-show="page==='viewer' && !example" ref="world" @reroll="reroll" @fullscreen-change="fullscreenSurface=$event"/>
      <GuidedWorld v-if="page==='viewer' && example" :example="example" @exit="go(example==='sight-comparison'?'stats':'about')"/>
      <Trends v-if="visited.stats" v-show="page==='stats'" :active="page==='stats'"
        @watch="watchDay" @example="go('viewer',$event)" @restart="settings(lab.run.setup)" @reroll="reroll"/>
      <About v-if="page==='about'" :lesson="lesson" @lesson="changeLesson" @example="go('viewer',$event)"
        @world="go('viewer')" @trends="go('stats')" @compare="openComparison"/>
      <Compare v-if="page==='compare'" :key="comparisonVersion" :initial="comparison" @change="comparisonChanged" @library="task('library')"/>
      <Settings v-if="lab.settings"/>
      <Tour v-if="lab.modal==='tour'" @close="lab.modal=null" @world="lab.modal=null; go('viewer')"
        @walkthrough="lab.modal=null; lesson='opening'; go('about')"/>
      <RunDialog v-else-if="lab.modal && !lab.settings" @compare="compare" @watch="watchDay" @world="go('viewer')"
        @resume="openRun($event, 'viewer')" @results="openRun($event, 'stats')"/>
    </template>
    <p v-else class="startup" role="status">Opening the lab…</p>
  </div>
</template>
