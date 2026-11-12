<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Dices, Layers, Ellipsis, Info } from 'lucide-vue-next'
import { useLab } from '../store.js'
import { METRICS, format, metricValue } from '../engine/stats.js'
import Flower from './Flower.vue'
import ExtinctionIcon from './ExtinctionIcon.vue'

const emit = defineEmits(['reroll', 'table'])
const lab = useLab()
const scroll = ref(null), fold = ref(false), legend = ref(false), options = ref(false), inspection = ref(null)
const mode = ref('classic'), rotation = ref(0), dayInput = ref(1)
const focusDay = ref(lab.viewing), detail = ref(null), detailX = ref(null)
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
let observer
legend.value = innerWidth >= 620
const order = computed(() => mode.value === 'classic' ? [1,3,4,5,0] : [1,2,3,4,5,0])
const rows = computed(() => lab.run.summaries.map(record => record.rows[lab.scope]))
const bounds = computed(() => {
  const b = {}
  for (const metric of METRICS) {
    const row = rows.value.filter(r => r && metricValue(r,metric.key) != null)
    b[metric.key] = { min:metric.key === 'population' ? 0 : row.reduce((v,r) => Math.min(v,r[metric.key].min),Infinity),
      max:row.reduce((v,r) => Math.max(v,metric.key === 'population' ? r.population : r[metric.key].max),0) }
  }
  return b
})
const tiles = computed(() => {
  const limit = lab.run.setup.days
  const visible = lab.extinctDay ? lab.completed : Math.min(limit,Math.max(lab.completed+8, lab.viewing+2))
  return Array.from({length:visible},(_,i) => {
    const row = rows.value[i]
    return { day:i+1,row,values: row ? Object.fromEntries(METRICS.map(m => [m.key,metricValue(row,m.key)])) : null }
  })
})
const visibleFrame = computed(() => {
  const frame = lab.frame
  if (!frame) return {}
  if (lab.dayEnded && lab.run.summaries[frame.day-1]) {
    const row = lab.run.summaries[frame.day-1].rows[lab.scope]
    return Object.fromEntries(METRICS.map(m => [m.key,metricValue(row,m.key)]))
  }
  const inScope = b => lab.scope === 'all' || b.species === lab.scope
  const living = frame.blobs.filter(b => b.alive && inScope(b))
  const deaths = frame.events.filter(e => e.type === 'death' && e.time <= frame.time && inScope(e))
  const average = (arr,key) => arr.length ? arr.reduce((sum,b) => sum+b[key],0)/arr.length : null
  return { population:living.length, age:average(living,'age'), deathAge:average(deaths,'age'),
    speed:average(living,'speed'),size:average(living,'size'),sense:average(living,'sense') }
})
const miniKey = computed(() => METRICS[order.value[rotation.value] ?? 1])
const miniSeries = computed(() => {
  const { key } = miniKey.value
  const scale = bounds.value[key].max || 1
  const points = []
  let path = ''
  for (const tile of tiles.value) {
    const value = tile.values?.[key]
    if (value == null) continue
    const x = (tile.day - .5) * 100
    const y = 58 - value / scale * 50
    const command = points.at(-1)?.day === tile.day - 1 ? 'L' : 'M'
    path += ` ${command}${x} ${y}`
    points.push({ day: tile.day, x, y })
  }
  return { path, points }
})
const firstExtinct = computed(() => rows.value.find(row => row?.population === 0)?.day)
function center(smooth, day = lab.viewing) {
  const sc = scroll.value, selected = sc?.querySelector('[data-day="'+day+'"]')
  if (!selected) return
  const centerX = Math.max(selected.offsetWidth/2,innerWidth/2 - sc.getBoundingClientRect().left)
  sc.scrollTo({ left:selected.offsetLeft + selected.offsetWidth/2 - centerX, behavior:smooth && !reducedMotion.matches ? 'smooth' : 'instant' })
}
watch(() => [lab.viewing, fold.value], () => nextTick(() => center(true)))
watch(() => tiles.value.length, (size, previous) => { if (previous < lab.viewing && size >= lab.viewing) nextTick(() => center(false)) })
watch(scroll, element => {
  observer?.disconnect()
  if (element) {
    observer = new ResizeObserver(() => { center(false); anchorDetail() })
    observer.observe(element)
    nextTick(() => center(false))
  }
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => lab.viewing, day => { focusDay.value = day })
watch(() => [lab.viewing, lab.scope, lab.run.id, fold.value, mode.value], () => { inspection.value = null })
function select(day) {
  if (day <= lab.completed) lab.openDay(day)
  else if (day === lab.liveDay && !lab.batch) lab.goLive()
  else lab.quickForDay(day)
}
function wheel(event) {
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
  event.preventDefault()
  scroll.value.scrollLeft += event.deltaY
}
function keys(event,day) {
  if (event.key.toLowerCase() === 'i' || event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
    if (!rows.value[day-1]) return
    event.preventDefault()
    inspect(day,true)
    return
  }
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 1 : event.key === 'End' ? Math.max(lab.completed,1) :
    Math.max(1,Math.min(tiles.value.length,day+(event.key === 'ArrowLeft' ? -1 : 1)))
  scroll.value.querySelector('[data-day="'+next+'"]')?.focus({ preventScroll:true })
  center(false,next)
}
function clickTile(event, tile) {
  const key = event.target.closest('[data-metric]')?.dataset.metric
  if (key && tile.row && tile.day === lab.viewing) {
    if (key === 'population') inspect(tile.day)
    else rotation.value = order.value.findIndex(idx => METRICS[idx].key === key)
    return
  }
  select(tile.day)
}
function chooseLegendMetric(metricIndex, position) {
  if (metricIndex === 0 && mode.value !== 'line') emit('table')
  else rotation.value = position
}
function anchorDetail() {
  if (!inspection.value || !scroll.value) return
  const tile = scroll.value.querySelector('[data-day="'+inspection.value+'"]')
  if (!tile) return
  const ribbon = scroll.value.parentElement.getBoundingClientRect(), target = tile.getBoundingClientRect()
  const x = (target.left+target.right)/2 - ribbon.left
  const safe = (detail.value?.offsetWidth ?? 214)/2 + 8
  detailX.value = Math.max(safe,Math.min(ribbon.width-safe,x))
}
function closeDetail(restore = false) {
  const trigger = scroll.value?.querySelector('[data-day="'+inspection.value+'"]')
  inspection.value = null
  if (restore) trigger?.focus({ preventScroll:true })
}
function inspect(day, keyboard = false) {
  if (!rows.value[day-1]) return
  if (inspection.value === day) { closeDetail(keyboard); return }
  inspection.value = day
  anchorDetail()
  nextTick(() => {
    anchorDetail()
    if (keyboard) detail.value?.querySelector('button').focus({ preventScroll:true })
  })
}
function escapeDetail(event) {
  if (!inspection.value) return
  event.stopPropagation()
  closeDetail(detail.value?.contains(document.activeElement))
}
</script>
<template>
  <section class="dock" aria-label="Current generation and timeline">
    <div class="stats">
      <div class="stats-heading">
        <h2>Current Generation Stats</h2>
        <span class="quiet stats-state">Day {{ lab.viewing }} · {{ lab.dayEnded ? 'Final' : lab.status }}</span>
        <button class="icon compact stat-info" title="View generation table" aria-label="View generation table" @click="emit('table')"><Info :size="15"/></button>
        <select v-model="lab.scope" aria-label="Generation statistics species">
          <option value="all">All species</option>
          <option v-for="s in lab.run.setup.species.filter(s=>s.enabled)" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <button v-if="fold" class="icon" aria-label="Expand generations" @click="fold=false"><ChevronUp :size="18"/></button>
      </div>
      <div class="stat-grid">
        <div v-for="m in METRICS" :key="m.key" class="stat" :style="{ '--metric': m.heading ?? m.color }" :title="m.label+' · '+m.unit">
          <span><i></i><span class="stat-long">{{ m.label }}</span><span class="stat-short">{{ m.short }}</span></span>
          <strong>{{ format(visibleFrame[m.key],m.key === 'population' ? 0 : 2) }}</strong>
        </div>
      </div>
    </div>
    <div v-if="!fold" class="ribbon" @keydown.esc="escapeDetail">
      <div ref="scroll" class="ribbon-scroll" @wheel="wheel" @scroll.passive="anchorDetail">
        <div class="tile-track">
          <button v-for="tile in tiles" :key="tile.day" type="button" class="day-tile"
            :class="{ current:lab.viewing===tile.day, pending:!tile.row, 'line-tile':mode==='line' }" :data-day="tile.day"
            :aria-current="lab.viewing===tile.day ? 'true' : undefined" :aria-label="'Day '+tile.day+(tile.row ? ', population '+tile.row.population : ', '+(tile.day===lab.liveDay && !lab.batch ? 'live' : 'pending'))"
            :tabindex="tile.day===focusDay ? 0 : -1" :aria-keyshortcuts="tile.row ? 'I Shift+F10' : undefined"
            @focus="focusDay=tile.day" @click="clickTile($event,tile)" @keydown="keys($event,tile.day)"
            @contextmenu="tile.row && ($event.preventDefault(),inspect(tile.day))">
            <Flower v-if="mode!=='line'" :values="tile.values" :bounds="bounds" :rotation="rotation"
              :six="mode==='six'" :interactive="!!tile.row"/>
            <span class="day-number">{{ tile.day }}</span>
            <small v-if="!tile.row">{{ tile.day===lab.liveDay && !lab.batch ? 'Live' : 'Pending' }}</small>
            <small v-else-if="!lab.extinctDay && tile.day===firstExtinct">Extinct</small>
          </button>
          <button v-if="lab.extinctDay" class="day-tile extinction-tile" :aria-label="'Extinct on Day '+lab.extinctDay+' · Watch final scene'" @click="lab.openDay(lab.extinctDay, Infinity)">
            <ExtinctionIcon/>
            <span>Extinct</span><small>Day {{ lab.extinctDay }}</small>
          </button>
          <button v-else class="day-tile more-tile" aria-label="More Generations" @click="lab.modal='extend'"><Layers :size="25"/><span>More</span></button>
          <svg v-if="mode==='line'" class="ribbon-line" :viewBox="'0 0 '+tiles.length*100+' 65'"
            :style="{width:tiles.length*100+'px'}" preserveAspectRatio="none" aria-hidden="true">
            <path :d="miniSeries.path" :stroke="miniKey.color" fill="none" stroke-width="2"/>
            <circle v-for="point in miniSeries.points" :key="point.day" :cx="point.x" :cy="point.y" r="3" :fill="miniKey.color"/>
          </svg>
        </div>
      </div>
      <div v-if="legend" class="flower-legend" :class="{ 'mini-line-legend':mode==='line' }">
        <button v-for="(idx,i) in order" :key="idx" class="legend-key" :aria-pressed="idx===0 && mode!=='line' ? undefined : i===rotation"
          @click="chooseLegendMetric(idx,i)" :style="{ '--metric':METRICS[idx].petal }">
          <i></i>{{ METRICS[idx].short }}<b v-if="i===rotation" aria-hidden="true">•</b>
        </button>
        <button class="legend-help" @click="emit('table')"><Info :size="13"/> {{ mode==='line' ? 'Exact values' : 'Scale and exact values' }}</button>
        <button class="legend-toggle" aria-label="Hide generation legend" @click="legend=false"><ChevronLeft :size="16"/></button>
      </div>
      <button v-else class="icon legend-open" aria-label="Show generation legend" @click="legend=true"><ChevronRight :size="16"/></button>
      <div class="ribbon-actions">
        <button class="icon compact" title="Reroll seed" aria-label="Reroll seed" @click="emit('reroll')"><Dices :size="16"/></button>
        <button v-if="!lab.extinctDay" class="icon compact" title="More Generations" aria-label="More Generations" @click="lab.modal='extend'"><Layers :size="16"/></button>
        <button class="icon compact" title="Generation options" aria-label="Generation options" @click="options=!options"><Ellipsis :size="16"/></button>
        <button class="icon compact" title="Collapse generations" aria-label="Collapse generations" @click="fold=true"><ChevronDown :size="16"/></button>
      </div>
      <div v-if="options" class="pop ribbon-menu">
        <button v-for="[id,label] in [['classic','Walkthrough flower'],['six','All six metrics'],['line','Mini line']]" :key="id" @click="mode=id; rotation=0; options=false">{{ label }} <span v-if="mode===id">✓</span></button>
        <button @click="emit('table'); options=false">Numeric table</button>
        <form @submit.prevent="select(dayInput); options=false"><label>Go to day <input v-model.number="dayInput" type="number" min="1" :max="lab.extinctDay ? lab.completed : lab.run.setup.days" required></label><button class="secondary">Go</button></form>
      </div>
      <div v-if="inspection && rows[inspection-1]" ref="detail" class="pop ribbon-detail" role="region"
        :aria-label="'Day '+inspection+' readings'" :style="{ left: detailX == null ? undefined : detailX+'px' }">
        <strong>Day {{ inspection }} <small>· Final</small></strong>
        <dl><template v-for="m in METRICS" :key="m.key"><dt :style="{ color:m.heading ?? m.petal }">{{ m.short }}</dt><dd>{{ format(metricValue(rows[inspection-1],m.key),m.key==='population'?0:2) }}</dd></template></dl>
        <button @click="closeDetail(true)">Close</button>
      </div>
      <div class="ribbon-label">GENERATIONS</div>
    </div>
  </section>
</template>
