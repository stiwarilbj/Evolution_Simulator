<script setup>
import { computed, ref, watch } from 'vue'
import { Aperture, BatteryMedium, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Ellipsis,
  Eye, FastForward, Layers, Pause, Play, Rabbit, RotateCcw, StepForward, Utensils, Video, X } from 'lucide-vue-next'
import { useLab } from '../store.js'
import { STATES } from '../engine/simulation.js'
import { format } from '../engine/stats.js'
import { cost, homePoints, radius, travel } from '../engine/geometry.js'
import Board from './Board.vue'
import Flower from './Flower.vue'
import Ribbon from './Ribbon.vue'

const lab = useLab()
const emit = defineEmits(['reroll'])
const board = ref(), section = ref()
const tool = ref(null), camera = ref('board'), quality = ref('auto'), details = ref(false)
const eventFilter = ref('all')
const dim = ref(false), hud = ref(false), rateReadout = ref(false), wasPlaying = ref(false)
const layers = ref({ sense:false, speed:false, energy:false, credits:false, homes:false, selected:false, vision:false })
const fallback = ref(false)
const layerNames = [
  ['sense',Eye,'Sense range','Show each creature’s sensing radius'],
  ['speed',Rabbit,'Color by speed','Brown is slower · red is faster'],
  ['energy',BatteryMedium,'Energy','Gold is full · gray is spent'],
  ['credits',Utensils,'Food credits','Olive for plants · rust for prey'],
]
const visible = computed(() => lab.frame?.blobs.find(b => b.id===lab.selected))
const species = computed(() => lab.run.setup.species.find(s => s.id===visible.value?.species))
const cohort = computed(() => {
  const frame = lab.frame
  if (!frame || !visible.value) return {}
  const sampled = lab.scope === 'all' || visible.value.species !== lab.scope ? frame.blobs : frame.blobs.filter(b => b.species===lab.scope)
  const result = {}
  for (const key of ['age','speed','size','sense']) result[key] = sampled.reduce((a,b) =>
    ({ min:Math.min(a.min,b[key]), max:Math.max(a.max,b[key]) }), { min:Infinity,max:-Infinity })
  return result
})
const fraction = computed(() => Math.min(1,(lab.frame?.time ?? 0)/lab.displayDuration))
const transportLabel = computed(() => lab.playing ? 'Pause' : lab.replay && fraction.value >= 1 ? 'Replay day' : 'Play')
const rateText = computed(() => Number((2**((lab.rate-6)/2)).toFixed(3))+'×')
const events = computed(() => (lab.frame?.events ?? []).filter(e => e.time <= (lab.frame?.time ?? 0)))
const creatureEvents = computed(() => events.value.filter(e => e.id===lab.selected || e.target===lab.selected && e.type==='prey' ||
  e.type==='birth' && e.parent===lab.selected))
const visibleEvents = computed(() => creatureEvents.value.filter(e => eventFilter.value==='all' || e.type===eventFilter.value))
const living = computed(() => lab.frame?.blobs.filter(b => b.alive) ?? [])
const speedRange = computed(() => {
  if (!layers.value.speed) return undefined
  const range = { min:Infinity, max:-Infinity }
  for (const b of lab.frame?.blobs ?? []) if (b.state !== 7) {
    range.min = Math.min(range.min, b.speed)
    range.max = Math.max(range.max, b.speed)
  }
  return Number.isFinite(range.min) ? range : undefined
})
const quickLabel = computed(() => lab.batch && lab.batch.label !== 'Preparing' ? 'Progress' : 'Quick Sim')
const replayCanSeek = computed(() => lab.replay && !lab.loading)
function select(id) {
  lab.selected = id
  lab.following = id != null
  eventFilter.value='all'
  if (id != null && camera.value === 'overhead') camera.value = 'board'
}
function follow() {
  if (lab.following) { lab.following = false; return }
  const candidate = living.value.find(b => b.id===lab.selected) ?? living.value[0]
  if (candidate) select(candidate.id)
  else details.value = true
}
function toggle(name) { tool.value = tool.value === name ? null : name }
function startSeek() {
  if (!replayCanSeek.value) return
  wasPlaying.value = lab.playing
  lab.stopPlayback()
  rateReadout.value = true
}
function finishSeek() {
  rateReadout.value = false
  if (wasPlaying.value && lab.frame.time < lab.displayDuration) lab.play()
  wasPlaying.value = false
}
function fit() { camera.value='board'; lab.following=false; board.value?.fit(); tool.value=null }
function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else section.value.requestFullscreen?.()
  tool.value=null
}
function shortcuts(event) {
  if (lab.settings || lab.modal || /INPUT|BUTTON|SELECT|TEXTAREA|A/.test(event.target.tagName)) return
  if (event.code === 'Space') { event.preventDefault(); lab.play() }
  if (event.key === 'Escape') { tool.value=null; details.value=false }
}
function endDay() {
  if (lab.replay) { lab.stopPlayback(); lab.seek(lab.displayDuration) }
  else lab.simulate(lab.liveDay,'Finish Day')
  tool.value=null
}
function eventName(e) {
  if (e.type === 'death') return e.cause
  if (e.type === 'plant') return 'Ate a plant'
  if (e.type === 'prey') return 'Hunted #'+e.target
  if (e.type === 'home') return 'Reached refuge'
  return e.id===lab.selected ? 'Born to #'+e.parent : 'Offspring #'+e.id
}
watch(() => lab.run.id, () => { details.value=false; tool.value=null; fit() })
watch(() => visible.value?.alive, alive => { if (alive===false) lab.following=false })
defineExpose({ overhead:()=>{ lab.following=false; camera.value='overhead'; layers.value.sense=true } })
</script>
<template>
  <main class="world" :class="{ 'is-following':lab.following, 'is-overhead':camera==='overhead' }" tabindex="-1" @keydown="shortcuts">
    <section ref="section" class="stage" aria-label="Simulation field">
      <Board ref="board" :frame="lab.frame" :species="lab.run.setup.species" :layers="layers" :selected="lab.selected"
        :follow="lab.following" :camera="camera" :scope="lab.scope" :dim="dim" :quality="quality" :speed-range="speedRange"
        @select="select" @fallback="fallback=true"/>
      <div class="view-tools">
        <button class="icon" aria-label="Layers" title="Layers" :aria-expanded="tool==='layers'" @click="toggle('layers')"><Layers :size="23"/></button>
        <button class="icon" aria-label="Follow creature" title="Follow creature" :aria-pressed="lab.following" :disabled="lab.loading || !lab.frame" @click="follow"><Video :size="23"/></button>
        <button class="icon view-menu-button" aria-label="View options" title="View options" :aria-expanded="tool==='view'" @click="toggle('view')"><Ellipsis :size="21"/></button>
      </div>
      <div v-if="tool==='layers'" class="layer-panel pop">
        <button class="icon" aria-label="Close layers" @click="tool=null"><ChevronUp :size="20"/></button>
        <button v-for="[key,Icon,label,tip] in layerNames" :key="key" class="icon layer" :aria-label="label" :aria-pressed="layers[key]" @click="layers[key]=!layers[key]">
          <component :is="Icon" :size="22"/><span class="layer-name">{{ label }}</span><span class="layer-tip">{{ label }}<small>{{ tip }}</small></span>
        </button>
        <button class="icon" aria-label="More layer options" @click="toggle('layer-options')"><ChevronDown :size="17"/></button>
      </div>
      <div v-if="tool==='view' || tool==='layer-options'" class="pop view-menu">
        <template v-if="tool==='view'">
          <button @click="fit">Fit board</button>
          <button @click="camera='overhead'; lab.following=false; tool=null">Overhead <span v-if="camera==='overhead'">✓</span></button>
          <button @click="fullscreen">Full screen</button>
          <button @click="details=!details; tool=null">Creatures</button>
          <label>Graphics <select v-model="quality"><option value="auto">Auto</option><option value="full">Full</option><option value="efficient">Efficient</option></select></label>
          <label><input v-model="dim" type="checkbox"> Dim other species</label>
          <label><input v-model="hud" type="checkbox"> HUD</label>
        </template>
        <template v-else>
          <button @click="tool='layers'">Back to layers</button>
          <label><input v-model="layers.selected" type="checkbox" :disabled="lab.selected==null"> Selected creature only</label>
          <label><input v-model="layers.homes" type="checkbox"> Show refuges</label>
        </template>
      </div>
      <div v-if="hud" class="world-hud">
        <span>Alive <b>{{ living.length }}</b></span><span>Home <b>{{ living.filter(b=>b.home).length }}</b></span>
        <span>Plants left <b>{{ lab.frame?.plants.length ?? 0 }}</b></span><span>Hunts <b>{{ events.filter(e=>e.type==='prey').length }}</b></span>
        <span>Deaths <b>{{ events.filter(e=>e.type==='death').length }}</b></span>
      </div>
      <div v-if="lab.following && visible" class="creature-flower"
        :class="{ 'layers-open':tool==='layers', 'rate-open':tool==='rate' }">
        <Flower :values="visible" :bounds="cohort" individual/>
        <button class="creature-caption" @click="details=true">CURRENT CREATURE<small><i :style="{background:species?.color}"></i>{{ species?.name }} · #{{ visible.id }}</small></button>
        <button class="vision-toggle" type="button" :aria-pressed="layers.vision" @click="layers.vision=!layers.vision"
          title="Dim the area beyond this creature’s sense range"><Aperture :size="14"/> Sense focus</button>
      </div>
      <div v-if="speedRange && !['rate','player'].includes(tool)" class="speed-key" aria-label="Body color by speed">
        <span>Speed · points</span>
        <i v-if="speedRange.min !== speedRange.max" aria-hidden="true"></i>
        <div v-if="speedRange.min === speedRange.max">All {{ format(speedRange.min) }}</div>
        <div v-else><span>{{ format(speedRange.min) }}</span><span>{{ format(speedRange.max) }}</span></div>
      </div>
      <div v-if="lab.loading" class="stage-note" role="status">Building replay for Day {{ lab.replayDay }}…</div>
      <div v-else-if="lab.frame && !living.length" class="stage-note"><strong>Extinction</strong><span>Day {{ lab.viewing }} · No living creatures</span></div>
      <span v-if="fallback" class="render-note" title="Canvas rendering is active">Canvas view</span>
      <div class="player">
        <button class="icon through" title="Play through generations" aria-label="Play through generations" :aria-pressed="lab.through" @click="lab.through=!lab.through"><StepForward :size="20"/></button>
        <div class="transport" role="group" aria-label="Day playback">
          <button class="icon" title="Previous day" aria-label="Previous day" :disabled="lab.viewing<=1 || lab.loading" @click="lab.moveDay(-1)"><ChevronLeft :size="27"/></button>
          <button class="icon play" :title="transportLabel" :aria-label="transportLabel"
            :disabled="!lab.frame || lab.loading || !lab.replay && (!lab.workerReady || !!lab.batch)" @click="lab.play">
            <Pause v-if="lab.playing" :size="24" fill="currentColor"/>
            <RotateCcw v-else-if="transportLabel==='Replay day'" :size="23"/>
            <Play v-else :size="24" fill="currentColor"/>
          </button>
          <button class="icon" title="Next day" aria-label="Next day" :disabled="!lab.canMoveNext || lab.loading" @click="lab.moveDay(1)"><ChevronRight :size="27"/></button>
        </div>
      </div>
      <div class="player-actions">
        <button class="secondary quick" @click="lab.modal=lab.batch ? 'quick-progress' : 'quick'"><FastForward :size="17" fill="currentColor"/>{{ quickLabel }}</button>
        <button class="icon" aria-label="Playback actions" title="Playback actions" @click="toggle('player')"><Ellipsis :size="20"/></button>
        <button class="icon" aria-label="Viewing speed" :title="'Viewing speed · '+rateText" :aria-expanded="tool==='rate'" @click="toggle('rate')"><Clock :size="21"/></button>
      </div>
      <div v-if="tool==='rate'" class="pop rate-panel">
        <label for="play-rate">Viewing speed</label>
        <div class="rate-scale">
          <input id="play-rate" v-model.number="lab.rate" type="range" min="0" max="12" aria-label="Viewing speed multiplier" :aria-valuetext="rateText" orient="vertical">
          <div class="rate-ticks" aria-hidden="true"><span>8×</span><span :class="{ normal:lab.rate===6 }">1×</span><span>⅛×</span></div>
        </div>
        <button class="rate-value" title="Reset to 1×" :aria-label="'Reset to 1×; viewing speed '+rateText" @click="lab.rate=6">{{ rateText }}</button>
        <button class="icon compact" aria-label="Close speed controls" @click="tool=null"><ChevronDown :size="16"/></button>
      </div>
      <div v-if="tool==='player'" class="pop player-menu">
        <button :disabled="lab.loading || !lab.replay && (!lab.workerReady || !!lab.batch)" @click="endDay">{{ lab.replay ? 'Go to end' : 'Finish Day' }}</button>
        <button :disabled="lab.loading || !lab.replay && (!lab.workerReady || !!lab.batch)" @click="lab.stepOnce(); tool=null">Step one tick</button>
        <button v-if="lab.completed" @click="lab.openDay(lab.completed); tool=null">Go to frontier</button>
        <button v-if="lab.replay && lab.canEnterLive" @click="lab.goLive(); tool=null">Back to Live</button>
      </div>
      <aside v-if="details" class="details" aria-label="Creature details">
        <header><strong>{{ visible ? (species?.name+' · #'+visible.id) : 'Creatures' }}</strong><button class="icon" aria-label="Close creature details" @click="details=false"><X :size="19"/></button></header>
        <label>Creature <select :value="lab.selected ?? ''" @change="select(Number($event.target.value) || null)">
          <option value="">Choose a creature</option>
          <option v-if="visible && !visible.alive" :value="visible.id">#{{ visible.id }} · Deceased</option>
          <option v-for="b in living" :key="b.id" :value="b.id">#{{ b.id }} · {{ lab.run.setup.species.find(s=>s.id===b.species)?.name }}</option>
        </select></label>
        <template v-if="visible">
          <p>{{ STATES[visible.state] }} <span v-if="!visible.alive">· {{ creatureEvents.find(e=>e.type==='death')?.cause }}</span></p>
          <p v-if="visible.returning && !visible.home" class="quiet">{{ format(homePoints(visible)[0].distance,1) }} units from the nearest refuge</p>
          <progress :value="visible.energy" :max="visible.capacity" aria-label="Remaining energy"></progress>
          <small>{{ format(visible.energy,1) }} / {{ visible.capacity }} energy</small>
          <dl><template v-for="[name,value] in [
            ['Age',visible.age+' days'],['Food credits',visible.credits],['Speed',format(visible.speed)],['Size',format(visible.size)],
            ['Sense range',format(visible.sense)],['Travel rate',format(travel(visible,lab.run.setup),1)+' units/s'],
            ['Body radius',format(radius(visible.size),2)],['Energy cost',format(cost(visible,lab.run.setup),1)+'/s'],
            ['Born', 'Day '+visible.born],['Parent',visible.parent ? '#'+visible.parent : 'Founder']
          ]" :key="name"><dt>{{ name }}</dt><dd>{{ value }}</dd></template></dl>
          <h3>Events</h3>
          <select v-model="eventFilter" aria-label="Filter creature events">
            <option v-for="[type,label] in [['all','All events'],['plant','Plants'],['prey','Hunts'],['home','Refuge'],['death','Deaths'],['birth','Births']]" :key="type" :value="type">{{ label }}</option>
          </select>
          <p v-if="!visibleEvents.length" class="quiet">No matching events at this point in the day.</p>
          <button v-for="(event,index) in visibleEvents" :key="index" class="event-row" :disabled="!lab.replay" @click="lab.seek(event.time)">
            <time>{{ format(event.time) }} s</time>{{ eventName(event) }}
          </button>
        </template>
      </aside>
    </section>
    <div class="time-rail" :class="{ seekable:replayCanSeek }" :style="{ '--elapsed':fraction*100+'%' }"
      @mouseenter="rateReadout=true" @mouseleave="rateReadout=false">
      <div v-if="rateReadout" class="time-label">{{ format(lab.frame?.time ?? 0) }} s / {{ format(lab.displayDuration) }} s</div>
      <div class="time-fill"></div><div class="time-thumb"></div>
      <input v-if="replayCanSeek" :value="lab.frame?.time ?? 0" type="range" min="0" :max="lab.displayDuration" step=".05"
        aria-label="Replay time" :aria-valuetext="format(lab.frame?.time ?? 0)+' seconds of '+lab.displayDuration"
        @pointerdown="startSeek" @pointerup="finishSeek" @pointercancel="finishSeek" @input="lab.seek(Number($event.target.value))" @focus="rateReadout=true" @blur="rateReadout=false">
      <span v-else role="progressbar" aria-label="Current day elapsed" :aria-valuenow="lab.frame?.time ?? 0" :aria-valuemax="lab.displayDuration"></span>
    </div>
    <Ribbon @reroll="emit('reroll')" @table="lab.modal='table'"/>
  </main>
</template>
