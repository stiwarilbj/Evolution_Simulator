<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Pause, Play, Scan } from 'lucide-vue-next'
import Board from './Board.vue'
import TrendPlot from './TrendPlot.vue'
import { useLab } from '../store.js'
import { trackFrame } from '../track.js'
import { format, METRICS, metricValue } from '../engine/stats.js'

const props=defineProps({ initial:Object })
const emit=defineEmits(['library','change'])
const lab=useLab()
const available=computed(()=>[lab.run,...lab.library.filter(r=>r.id!==lab.run.id)])
const leftId=ref(props.initial?.left || lab.run.id)
const rightId=ref(props.initial?.right || available.value.find(r=>r.id!==leftId.value)?.id || '')
const left=computed(()=>available.value.find(r=>r.id===leftId.value))
const right=computed(()=>available.value.find(r=>r.id===rightId.value))
const horizon=computed(()=>Math.min(left.value?.summaries.length ?? 0,right.value?.summaries.length ?? 0))
const initialDay = Number.isInteger(props.initial?.day) ? props.initial.day : lab.viewing
const day=ref(Math.max(1,Math.min(initialDay,horizon.value))), fraction=ref(0), playing=ref(false)
const replayAvailable=computed(()=>leftId.value!==rightId.value && day.value<=horizon.value)
const tracks=ref([]), pending=ref(false), error=ref(''), replayAttempt=ref(0)
const cam=ref('board'), scope=ref('all'), layers=ref({sense:false}), focus=ref('')
const reveal=ref(false), divider=ref(50), emphasis=ref('both')
const selections=ref([null,null]), boards=[]
let job=0, animation, previous=0
const names=['Left run','Right run']
const runs=computed(()=>[left.value,right.value])
const frames=computed(()=>tracks.value.map(track=>trackFrame(track,track.duration*fraction.value)))
const commonSpecies=computed(()=>left.value?.setup.species.filter(s=>s.enabled&&right.value?.setup.species.some(b=>b.enabled&&b.id===s.id)) ?? [])
const rows=computed(()=>Array.from({length:horizon.value},(_,i)=>({day:i+1,
  a:left.value.summaries[i].rows[scope.value],b:right.value.summaries[i].rows[scope.value]})))
const summary=computed(()=>rows.value[day.value-1])
const firstHunts=computed(()=>tracks.value.map(track=>track.events.find(event=>
  event.type==='prey' && (scope.value==='all' || event.species===scope.value))))
const largestHuntGap=computed(()=>{
  let largest=null
  for (const row of rows.value) {
    const gap=Math.abs((row.a?.hunts ?? 0)-(row.b?.hunts ?? 0))
    if (gap>(largest?.gap ?? 0)) largest={day:row.day,gap}
  }
  return largest
})
const huntMetric={ key:'hunts', label:'Successful hunts', color:'#D38C80', count:true }
const comparisonMetrics=[
  ...METRICS,
  { key:'births', label:'Births', color:'#A1BD67', count:true },
  { key:'deaths', label:'Deaths', color:'#BD5558', count:true },
  huntMetric,
  { key:'plants', label:'Plants eaten', color:'#B7D65A', count:true },
]
function valueFor(row, metric) {
  return metric.count ? row?.[metric.key] : metricValue(row,metric.key)
}
function measure(metric, side) {
  const digits=metric.count || metric.key==='population' ? 0 : 2
  const a=valueFor(summary.value?.a,metric), b=valueFor(summary.value?.b,metric)
  return format(side==='delta' ? (a!=null && b!=null ? b-a : null) : side==='a' ? a : b,digits)
}
const series=metric=>[
  { label:left.value.setup.name+' · Left', color:'#83B3CE', value:r=>valueFor(r.a,metric), zero:metric.count || metric.key==='population' },
  { label:right.value.setup.name+' · Right', color:'#F6AD73', value:r=>valueFor(r.b,metric), zero:metric.count || metric.key==='population' },
]
function stop() { playing.value=false; cancelAnimationFrame(animation) }
function animate(time) {
  if (!playing.value) return
  if (previous) fraction.value=Math.min(1,fraction.value+Math.min(.1,(time-previous)/1000)/Math.max(...tracks.value.map(t=>t.duration)))
  previous=time
  if (fraction.value<1) animation=requestAnimationFrame(animate)
  else stop()
}
function play() {
  if (playing.value) { stop(); return }
  if (tracks.value.length!==2) return
  if (fraction.value>=1) fraction.value=0
  playing.value=true
  previous=0
  animation=requestAnimationFrame(animate)
}
function seekDay(value) {
  if (!Number.isInteger(value) || value<1 || value>horizon.value) return
  day.value=value
}
function changeDay(event) {
  seekDay(event.target.valueAsNumber)
  event.target.value=day.value
}
function goToHunt(index) {
  const event=firstHunts.value[index]
  if (!event) return
  stop()
  fraction.value=event.time/tracks.value[index].duration
  cam.value='board'
  selections.value[index]=event.id
}
function fit() {
  cam.value='board'
  selections.value=[null,null]
  boards.forEach(board=>board?.fit())
}
watch([leftId,rightId],()=>{ scope.value='all' })
watch(horizon, limit=>{ if (day.value>limit) day.value=Math.max(1,limit) })
watch([leftId,rightId,day],()=>emit('change',{ left:leftId.value,right:rightId.value,day:day.value }),{immediate:true})
watch([leftId,rightId,day,replayAvailable,replayAttempt],async ()=>{
  const token=++job
  stop()
  fraction.value=0
  selections.value=[null,null]
  tracks.value=[]
  error.value=''
  pending.value=false
  if (!replayAvailable.value) return
  pending.value=true
  try {
    const found=await Promise.all([lab.getTrack(left.value,day.value),lab.getTrack(right.value,day.value)])
    if(token===job) tracks.value=found
  } catch(e) { if(token===job) error.value=e.message }
  finally { if(token===job) pending.value=false }
},{immediate:true})
onBeforeUnmount(()=>{ ++job; stop() })
</script>

<template>
  <main class="compare-page" @keydown.esc="focus=''">
    <header><h1>Compare runs</h1><button class="secondary" @click="emit('library')">Run Library</button></header>
    <div class="compare-selects">
      <label v-for="(name,index) in names" :key="name" :class="index===0 ? 'run-left' : 'run-right'">{{ name }}
        <select :value="index===0 ? leftId : rightId" @change="index===0 ? leftId=$event.target.value : rightId=$event.target.value">
          <option value="">Choose a run</option><option v-for="r in available" :key="r.id" :value="r.id">{{ r.setup.name }} · Seed {{ r.setup.seed }}</option>
        </select>
      </label>
    </div>
    <p v-if="!left||!right||leftId===rightId" class="notice">Choose two different saved experiments.</p>
    <p v-else-if="!horizon" class="notice">Complete a generation in each run to compare them.</p>
    <template v-else>
      <div class="comparison-controls">
        <button class="icon" aria-label="Previous comparison day" :disabled="day<=1" @click="seekDay(day-1)"><ChevronLeft :size="21"/></button>
        <label>Day <input :value="day" type="number" min="1" :max="horizon" @change="changeDay"> of {{ horizon }}</label>
        <button class="icon" aria-label="Next comparison day" :disabled="day>=horizon" @click="seekDay(day+1)"><ChevronRight :size="21"/></button>
        <label>Species <select v-model="scope"><option value="all">All species</option><option v-for="s in commonSpecies" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
        <button class="secondary" :aria-pressed="layers.sense" @click="layers.sense=!layers.sense">Sense circles</button>
        <button class="secondary" :aria-pressed="cam==='overhead'" @click="cam=cam==='overhead'?'board':'overhead';selections=[null,null]">Overhead</button>
        <button class="secondary" :aria-pressed="reveal" @click="reveal=!reveal;fit()">{{ reveal ? 'Reveal mode' : 'Side by side' }}</button>
        <label>Emphasis <select v-model="emphasis"><option value="both">Both boards</option><option value="left">Left board</option><option value="right">Right board</option></select></label>
        <button class="icon" aria-label="Fit both boards" @click="fit"><Scan :size="20"/></button>
      </div>
      <div class="paired-boards" :class="{ 'reveal-boards':reveal }" :style="{ '--divider':divider+'%' }">
        <section v-for="(run,index) in runs" :key="index" :aria-label="names[index]"
          :class="[index===0 ? 'run-left' : 'run-right', { 'quiet-board':emphasis!=='both' && emphasis!==(index===0 ? 'left' : 'right') }]">
          <Board :ref="element=>boards[index]=element" :frame="frames[index]" :species="run.setup.species" :layers="layers"
            :camera="cam" :scope="scope" :dim="scope!=='all'" :selected="selections[index]" :follow="selections[index]!=null" @select="selections[index]=$event"/>
          <h2>{{ run.setup.name }} <small>Seed {{ run.setup.seed }} · {{ format(frames[index]?.time,1) }} s</small></h2>
        </section>
        <div v-if="pending||error" class="stage-note">
          <p role="status">{{ error || 'Building paired replays…' }}</p>
          <button v-if="error" class="secondary" @click="replayAttempt++">Retry replays</button>
        </div>
      </div>
      <label v-if="reveal" class="compare-reveal">Reveal left and right <input v-model.number="divider" type="range" min="0" max="100"></label>
      <div class="comparison-clock">
        <button class="icon" :aria-label="playing?'Pause comparison':'Play comparison'" :disabled="tracks.length!==2" @click="play">
          <Pause v-if="playing" :size="21"/><Play v-else :size="21"/>
        </button>
        <input v-model.number="fraction" type="range" min="0" max="1" step=".005" aria-label="Shared day progress" :disabled="tracks.length!==2" @input="stop">
        <output>{{ Math.round(fraction*100) }}%</output>
      </div>
      <div class="comparison-events">
        <button v-if="largestHuntGap" class="secondary" @click="seekDay(largestHuntGap.day)">
          Largest hunt gap · Day {{ largestHuntGap.day }} ({{ largestHuntGap.gap }})
        </button>
        <button v-for="(name,index) in names" :key="name" class="secondary" :disabled="!firstHunts[index]" @click="goToHunt(index)">
          {{ index===0?'Left':'Right' }} first hunt<span v-if="firstHunts[index]">· {{ format(firstHunts[index].time) }} s</span>
        </button>
        <span v-if="tracks.length===2 && !firstHunts.some(Boolean)" class="quiet">No successful hunts on this day for this scope.</span>
      </div>
      <section class="compare-metrics"><h2>Day {{ day }} results</h2>
        <table><thead><tr><th>Metric</th><th>Left</th><th>Right</th><th>Right − Left</th></tr></thead><tbody>
          <tr v-for="m in comparisonMetrics" :key="m.key">
            <th scope="row" :style="{color:m.heading ?? m.color}">{{ m.label }}</th>
            <td>{{ measure(m,'a') }}</td>
            <td>{{ measure(m,'b') }}</td>
            <td>{{ measure(m,'delta') }}</td>
          </tr>
        </tbody></table>
      </section>
      <div class="compact-plots">
        <TrendPlot v-for="m in [...METRICS,huntMetric]" :key="m.key" :title="m.label" :unit="m.unit ?? 'hunts per day'" :color="m.heading ?? m.color" :rows="rows"
          :pin="day" :series="series(m)" :focus="focus===m.key" legend @watch="seekDay" @pin="seekDay" @focus="focus=focus===m.key?'':m.key"/>
      </div>
    </template>
  </main>
</template>
