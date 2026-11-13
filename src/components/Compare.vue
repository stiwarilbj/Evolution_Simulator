<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Pause, Play, Scan } from 'lucide-vue-next'
import Board from './Board.vue'
import TrendPlot from './TrendPlot.vue'
import { useLab } from '../store.js'
import { trackFrame } from '../track.js'
import { usesWalkthroughForaging } from '../engine/config.js'
import { format, METRICS, metricValue } from '../engine/stats.js'
import { SIZE_MUTATION_SEED, sizeMutationPair } from '../experiments.js'

const props=defineProps({ initial:Object })
const emit=defineEmits(['library','change'])
const lab=useLab()
const available=computed(()=>[lab.run,...lab.library.filter(r=>r.id!==lab.run.id)])
const leftId=ref(props.initial?.left ?? lab.run.id)
const rightId=ref(props.initial?.right ?? available.value.find(r=>r.id!==leftId.value)?.id ?? '')
const left=computed(()=>available.value.find(r=>r.id===leftId.value))
const right=computed(()=>available.value.find(r=>r.id===rightId.value))
const runs=computed(()=>[left.value,right.value])
const runDays=computed(()=>runs.value.map(run=>run?.summaries.length ?? 0))
const horizon=computed(()=>Math.min(...runDays.value))
const initialDay=Number.isInteger(props.initial?.day) ? props.initial.day : lab.viewing
const days=ref([
  Number.isInteger(props.initial?.leftDay) ? props.initial.leftDay : initialDay,
  Number.isInteger(props.initial?.rightDay) ? props.initial.rightDay : initialDay,
])
const day=ref(initialDay), fractions=ref([0,0]), playing=ref([false,false])
const replayAvailable=computed(()=>leftId.value!==rightId.value && runs.value.every((run,index)=>run && days.value[index]>=1 && days.value[index]<=runDays.value[index]))
const tracks=ref([null,null]), pending=ref([false,false]), errors=ref(['','']), replayAttempt=ref([0,0])
const cameras=ref([props.initial?.leftCamera ?? 'board',props.initial?.rightCamera ?? 'board']), scope=ref('all'), layers=ref({sense:false}), focus=ref('')
const reveal=ref(false), divider=ref(50), emphasis=ref('both')
const sequence=ref(false), sequenceStep=ref(0), videoPairProgress=ref(null), videoPairError=ref('')
const sequenceButton=ref(null), sequenceStopButton=ref(null)
const selections=ref([null,null]), boards=[]
let jobs=[0,0], animations=[null,null], previous=[0,0], sequenceTimer, sequenceController
let videoPairController
const names=['Left run','Right run']
const experimentSizes=computed(()=>{
  if (!horizon.value || leftId.value===rightId.value || !runs.value.every(run=>usesWalkthroughForaging(run.setup))) return null
  return runs.value.map(run=>{
    const species=run.setup.species.filter(s=>s.enabled && (scope.value==='all' || s.id===scope.value))
    const count=species.reduce((total,s)=>total+s.count,0)
    const start=count ? species.reduce((total,s)=>total+s.size*s.count,0)/count : null
    const finish=run.summaries[horizon.value-1].rows[scope.value]?.size.mean ?? null
    return { start, finish, change:start!=null && finish!=null ? finish-start : null }
  })
})
const frames=computed(()=>tracks.value.map((track,index)=>track && !errors.value.some(Boolean)
  ? trackFrame(track,track.duration*fractions.value[index]) : null))
const commonSpecies=computed(()=>left.value?.setup.species.filter(s=>s.enabled&&right.value?.setup.species.some(b=>b.enabled&&b.id===s.id)) ?? [])
const rows=computed(()=>Array.from({length:horizon.value},(_,i)=>({day:i+1,
  a:left.value.summaries[i].rows[scope.value],b:right.value.summaries[i].rows[scope.value]})))
const summary=computed(()=>runs.value.map((run,index)=>run?.summaries[days.value[index]-1]?.rows[scope.value]))
const resultTitle=computed(()=>days.value[0]===days.value[1] ? `Day ${days.value[0]} results` : `Day ${days.value[0]} vs Day ${days.value[1]} results`)
const firstHunts=computed(()=>tracks.value.map(track=>track?.events.find(event=>
  event.type==='prey' && (scope.value==='all' || event.species===scope.value))))
const largestHuntGap=computed(()=>{
  let largest=null
  for (const row of rows.value) {
    const gap=Math.abs((row.a?.hunts ?? 0)-(row.b?.hunts ?? 0))
    if (gap>(largest?.gap ?? 0)) largest={day:row.day,gap}
  }
  return largest
})
const videoPair=computed(()=>{
  const match=(run,size)=>run.setup.seed===SIZE_MUTATION_SEED && run.setup.name.startsWith('Size mutation · '+(size===1?'Wide':'Narrow')) &&
    run.setup.food===50 && run.setup.foraging==='walkthrough' && run.setup.species.some(s=>s.enabled && s.standardDeviation?.size===size) && run.summaries.length>=77
  const wide=available.value.find(run=>match(run,1))
  const narrow=available.value.find(run=>match(run,.5))
  return wide && narrow && wide.id!==narrow.id ? { wide,narrow } : null
})
const sequenceReady=computed(()=>days.value[0]===6 && days.value[1]===77 && tracks.value.every(Boolean))
const sequenceButtonText=computed(()=>sequence.value ? 'Stop video sequence' : 'Play video sequence')
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
  const a=valueFor(summary.value[0],metric), b=valueFor(summary.value[1],metric)
  return format(side==='delta' ? (a!=null && b!=null ? b-a : null) : side==='a' ? a : b,digits)
}
const series=metric=>[
  { label:left.value.setup.name+' · Left', color:'#83B3CE', value:r=>valueFor(r.a,metric), zero:metric.count || metric.key==='population' },
  { label:right.value.setup.name+' · Right', color:'#F6AD73', value:r=>valueFor(r.b,metric), zero:metric.count || metric.key==='population' },
]
function stop(index=null) {
  const sides=index==null ? [0,1] : [index]
  for (const side of sides) {
    playing.value[side]=false
    cancelAnimationFrame(animations[side])
    animations[side]=null
    previous[side]=0
  }
}
function animate(index,time) {
  if (!playing.value[index]) return
  const track=tracks.value[index]
  if (previous[index] && track) fractions.value[index]=Math.min(1,fractions.value[index]+Math.min(.1,(time-previous[index])/1000)/Math.max(track.duration,.001))
  previous[index]=time
  if (fractions.value[index]<1) animations[index]=requestAnimationFrame(next=>animate(index,next))
  else if (sequence.value) {
    fractions.value[index]=0
    previous[index]=time
    animations[index]=requestAnimationFrame(next=>animate(index,next))
  }
  else stop(index)
}
function play(index=null) {
  const sides=index==null ? [0,1] : [index]
  if (sides.some(side=>playing.value[side])) { stop(index); return }
  if (sides.some(side=>!tracks.value[side])) return
  for (const side of sides) {
    if (fractions.value[side]>=1) fractions.value[side]=0
    playing.value[side]=true
    previous[side]=0
    animations[side]=requestAnimationFrame(time=>animate(side,time))
  }
}
function toggleComparison() {
  if (sequence.value) { stopVideoSequence(); return }
  playing.value.some(Boolean) ? stop() : play()
}
function toggleSidePlayback(index) {
  if (sequence.value) stopVideoSequence()
  play(index)
}
function seekDay(value,index=null) {
  if (!Number.isInteger(value) || value<1) return
  if (sequence.value) stopVideoSequence()
  if (index==null) {
    if (value>horizon.value) return
    days.value=[value,value]
  } else {
    if (value>runDays.value[index]) return
    days.value[index]=value
  }
  day.value=value
}
function changeDay(event) {
  seekDay(event.target.valueAsNumber)
  event.target.value=day.value
}
function changeSideDay(event,index) {
  seekDay(event.target.valueAsNumber,index)
  event.target.value=days.value[index]
}
function seekBothTime(value) {
  stop()
  fractions.value=[value,value]
}
function goToHunt(index) {
  const event=firstHunts.value[index]
  if (!event) return
  stop(index)
  fractions.value[index]=Math.max(0,event.time-0.75)/tracks.value[index].duration
  cameras.value[index]='board'
  selections.value[index]=event.id
  play(index)
}
function fit() {
  cameras.value=['board','board']
  selections.value=[null,null]
  boards.forEach(board=>board?.fit())
}
function stageVideoDays(pair=videoPair.value) {
  if (!pair?.wide || !pair?.narrow) return
  stopVideoSequence()
  leftId.value=pair.wide.id
  rightId.value=pair.narrow.id
  days.value=[6,77]
  day.value=6
  fractions.value=[0,0]
  cameras.value=['close','overhead']
  selections.value=[null,null]
  emphasis.value='left'
  reveal.value=false
  divider.value=50
}
async function prepareVideoScene() {
  if (videoPairProgress.value) return
  if (videoPair.value) { stageVideoDays(videoPair.value); return }
  const controller=new AbortController()
  videoPairController=controller
  videoPairError.value=''
  videoPairProgress.value={side:0,day:0,saving:false}
  try {
    const pair=await lab.preparePair(sizeMutationPair(SIZE_MUTATION_SEED,100),controller.signal,
      (side,day)=>{ videoPairProgress.value={side,day,saving:false} },
      ()=>{ videoPairProgress.value.saving=true })
    if (!controller.signal.aborted) stageVideoDays({
      wide:available.value.find(run=>run.id===pair.left),
      narrow:available.value.find(run=>run.id===pair.right),
    })
  } catch(error) {
    videoPairError.value=controller.signal.aborted ? 'Video pair creation canceled.' : error.message
  } finally {
    videoPairController=null
    videoPairProgress.value=null
  }
}
function cancelVideoPair() {
  if (!videoPairProgress.value?.saving) videoPairController?.abort()
}
function cutVideoScene() {
  if (sequence.value) { stopVideoSequence(); return }
  if (!sequenceReady.value) return
  stop()
  fractions.value=[0,0]
  sequenceStep.value=0
  sequence.value=true
  cameras.value=['close','overhead']
  selections.value=[null,null]
  emphasis.value='left'
  reveal.value=false
  divider.value=50
  play()
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const interval=reduced ? 6000 : 4000
  sequenceTimer=setInterval(()=>{
    sequenceStep.value++
    emphasis.value=sequenceStep.value%2 ? 'right' : 'left'
    if (sequenceStep.value%3===1) cameras.value[0]=cameras.value[0]==='close' ? 'board' : 'close'
    if (sequenceStep.value%3===2) cameras.value[1]=cameras.value[1]==='overhead' ? 'board' : 'overhead'
    if (sequenceStep.value>=10) stopVideoSequence()
  },interval)
}
function stopVideoSequence() {
  const wasPlayingSequence=sequence.value
  sequence.value=false
  clearInterval(sequenceTimer)
  sequenceTimer=null
  stop()
  if (wasPlayingSequence) nextTick(()=>sequenceButton.value?.isConnected && sequenceButton.value.focus())
}
function stopSequenceOnEscape(event) {
  if (event.key==='Escape' && sequence.value) {
    event.preventDefault()
    stopVideoSequence()
  }
}
function interruptSequence() {
  if (sequence.value) stopVideoSequence()
}
async function loadTrack(index) {
  const token=++jobs[index]
  stop(index)
  fractions.value[index]=0
  selections.value[index]=null
  tracks.value[index]=null
  errors.value[index]=''
  pending.value[index]=false
  const run=runs.value[index]
  if (!replayAvailable.value || !run) return
  pending.value[index]=true
  try {
    const found=await lab.getTrack(run,days.value[index])
    if (token===jobs[index]) tracks.value[index]=found
  } catch(error) {
    if (token===jobs[index]) errors.value[index]=error.message
  } finally {
    if (token===jobs[index]) pending.value[index]=false
  }
}
function retryTracks() {
  for (let index=0;index<2;index++) if (errors.value[index]) replayAttempt.value[index]++
}
watch([leftId,rightId],()=>{ scope.value='all' })
watch([leftId,()=>days.value[0],()=>replayAttempt.value[0],replayAvailable],()=>{ void loadTrack(0) },{immediate:true})
watch([rightId,()=>days.value[1],()=>replayAttempt.value[1],replayAvailable],()=>{ void loadTrack(1) },{immediate:true})
watch(()=>[runDays.value[0],runDays.value[1]],limits=>{
  for (let index=0;index<2;index++) {
    if (!limits[index]) days.value[index]=1
    else days.value[index]=Math.max(1,Math.min(limits[index],days.value[index]))
  }
},{immediate:true})
watch([leftId,rightId,()=>days.value[0],()=>days.value[1],day,()=>cameras.value[0],()=>cameras.value[1]],()=>emit('change',{
  left:leftId.value,right:rightId.value,day:day.value,leftDay:days.value[0],rightDay:days.value[1],
  leftCamera:cameras.value[0],rightCamera:cameras.value[1],
}),{immediate:true})
watch(horizon,limit=>{ if (day.value>limit) day.value=Math.max(1,limit) })
onBeforeUnmount(()=>{
  jobs=[jobs[0]+1,jobs[1]+1]
  stopVideoSequence()
  videoPairController?.abort()
  window.removeEventListener('keydown',stopSequenceOnEscape)
})
onMounted(()=>window.addEventListener('keydown',stopSequenceOnEscape))
watch(sequence,active=>{ if(active) nextTick(()=>sequenceStopButton.value?.focus()) })
</script>

<template>
  <Teleport to="body" :disabled="!sequence">
  <main class="compare-page" :class="{ 'cinematic-sequence':sequence }" @keydown.esc="sequence ? stopVideoSequence() : focus=''">
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
      <section v-if="experimentSizes" class="comparison-size" aria-labelledby="comparison-size-title">
        <h2 id="comparison-size-title">Average size over {{ horizon }} generations</h2>
        <table>
          <thead><tr><th scope="col">Run</th><th scope="col">Founders</th><th scope="col">Day {{ horizon }}</th><th scope="col">Change</th></tr></thead>
          <tbody>
            <tr v-for="(size,index) in experimentSizes" :key="index" :class="index===0?'run-left':'run-right'">
              <th scope="row">{{ index===0?'Left':'Right' }}</th><td>{{ format(size.start) }}</td><td>{{ format(size.finish) }}</td>
              <td>{{ size.change>0?'+':'' }}{{ format(size.change) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <div class="comparison-controls">
        <button class="icon" aria-label="Previous comparison day" :disabled="day<=1" @click="seekDay(day-1)"><ChevronLeft :size="21"/></button>
        <label>Set both days <input :value="day" type="number" min="1" :max="horizon" @change="changeDay"> of {{ horizon }}</label>
        <button class="icon" aria-label="Next comparison day" :disabled="day>=horizon" @click="seekDay(day+1)"><ChevronRight :size="21"/></button>
        <label>Species <select v-model="scope"><option value="all">All species</option><option v-for="s in commonSpecies" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
        <button class="secondary" :aria-pressed="layers.sense" @click="layers.sense=!layers.sense">Sense circles</button>
        <button class="secondary" :aria-pressed="reveal" @click="reveal=!reveal;fit()">{{ reveal ? 'Reveal mode' : 'Side by side' }}</button>
          <label>Emphasis <select v-model="emphasis" @change="interruptSequence"><option value="both">Both boards</option><option value="left">Left board</option><option value="right">Right board</option></select></label>
        <button class="icon" aria-label="Fit both boards" @click="fit"><Scan :size="20"/></button>
      </div>
      <section class="video-scene-tools" aria-label="Video scene controls">
        <button class="secondary" :disabled="!!videoPairProgress" @click="prepareVideoScene">
          {{ videoPair ? 'Stage video moments · Day 6 / 77' : 'Create seed 118 video pair · 100 days' }}
        </button>
        <button ref="sequenceButton" class="primary" :disabled="!sequenceReady" :aria-pressed="sequence" @click="cutVideoScene">{{ sequenceButtonText }}</button>
        <button v-if="videoPairProgress && !videoPairProgress.saving" class="secondary" @click="cancelVideoPair">Cancel setup</button>
        <span v-if="videoPairProgress" role="status">{{ videoPairProgress.saving ? 'Saving the two runs…' : `Building ${videoPairProgress.side===0 ? 'wide' : 'narrow'} run · Day ${videoPairProgress.day} / 100` }}</span>
        <span v-else-if="videoPairError" role="status">{{ videoPairError }}</span>
        <small>Use the seed 118 size pair for the Day 6 hunter and Day 77 forager scenes. Playback alternates the bright board and cuts camera angles.</small>
      </section>
      <div class="paired-day-controls" aria-label="Independent board controls">
        <section v-for="(run,index) in runs" :key="index" :class="index===0?'run-left':'run-right'">
          <strong>{{ index===0?'Left':'Right' }} · {{ run.setup.name }}</strong>
          <label>Day <input :value="days[index]" type="number" min="1" :max="runDays[index]" :aria-label="(index===0?'Left':'Right')+' day'" @change="changeSideDay($event,index)"> of {{ runDays[index] }}</label>
          <label>Camera <select v-model="cameras[index]" :aria-label="(index===0?'Left':'Right')+' camera angle'" @change="interruptSequence"><option value="board">Field view</option><option value="overhead">Overhead</option><option value="close">Close view</option></select></label>
          <button class="icon" :aria-label="playing[index]?'Pause '+(index===0?'left':'right')+' board':'Play '+(index===0?'left':'right')+' board'" :disabled="!tracks[index]" @click="toggleSidePlayback(index)">
            <Pause v-if="playing[index]" :size="19"/><Play v-else :size="19"/>
          </button>
          <label class="lane-progress">{{ index===0?'Left':'Right' }} playback
            <input v-model.number="fractions[index]" type="range" min="0" max="1" step=".005" :aria-label="(index===0?'Left':'Right')+' playback progress'" :disabled="!tracks[index]" @input="stop(index)">
          </label>
          <span v-if="pending[index]" class="quiet" role="status">Loading Day {{ days[index] }}…</span>
        </section>
      </div>
      <div class="paired-boards" :class="{ 'reveal-boards':reveal }" :style="{ '--divider':divider+'%' }">
        <section v-for="(run,index) in runs" :key="index" :aria-label="names[index]"
          :class="[index===0 ? 'run-left' : 'run-right', { 'quiet-board':emphasis!=='both' && emphasis!==(index===0 ? 'left' : 'right') }]">
          <Board v-show="frames[index]" :ref="element=>boards[index]=element" :frame="frames[index]" :species="run.setup.species" :layers="layers"
            :camera="cameras[index]" :scope="scope" :dim="scope!=='all'" :selected="selections[index]" :follow="selections[index]!=null" @select="selections[index]=$event"/>
          <h2>{{ run.setup.name }} <small>Day {{ days[index] }} · Seed {{ run.setup.seed }} · {{ format(frames[index]?.time,1) }} s</small></h2>
        </section>
        <button v-if="sequence" ref="sequenceStopButton" class="primary sequence-stop" @click="stopVideoSequence">Stop video sequence</button>
        <div v-if="pending.some(Boolean)||errors.some(Boolean)" class="stage-note">
          <p role="status">{{ errors.find(Boolean) || 'Building paired replays…' }}</p>
          <button v-if="errors.some(Boolean)" class="secondary" @click="retryTracks">Retry replays</button>
        </div>
      </div>
      <label v-if="reveal" class="compare-reveal">Reveal left and right <input v-model.number="divider" type="range" min="0" max="100"></label>
      <div class="comparison-clock">
        <button class="icon" :aria-label="playing.some(Boolean)?'Pause comparison':'Play comparison'" :disabled="!tracks.every(Boolean)" @click="toggleComparison">
          <Pause v-if="playing.some(Boolean)" :size="21"/><Play v-else :size="21"/>
        </button>
        <input :value="fractions[0]" type="range" min="0" max="1" step=".005" aria-label="Shared day progress" :disabled="!tracks.every(Boolean)" @input="seekBothTime($event.target.valueAsNumber)">
        <output>{{ Math.round(fractions[0]*100) }}% / {{ Math.round(fractions[1]*100) }}%</output>
      </div>
      <div class="comparison-events">
        <button v-if="largestHuntGap" class="secondary" @click="seekDay(largestHuntGap.day)">
          Largest hunt gap · Day {{ largestHuntGap.day }} ({{ largestHuntGap.gap }})
        </button>
        <button v-for="(name,index) in names" :key="name" class="secondary" :disabled="!firstHunts[index]" @click="goToHunt(index)">
          Watch {{ index===0?'left':'right' }} hunt<span v-if="firstHunts[index]"> · {{ format(firstHunts[index].time) }} s</span>
        </button>
        <span v-if="tracks.every(Boolean) && !firstHunts.some(Boolean)" class="quiet">No successful hunts on this day for this scope.</span>
      </div>
      <section class="compare-metrics"><h2>{{ resultTitle }}</h2>
        <table><thead><tr><th>Metric</th><th>Left · Day {{ days[0] }}</th><th>Right · Day {{ days[1] }}</th><th>Right − Left</th></tr></thead><tbody>
          <tr v-for="m in comparisonMetrics" :key="m.key">
            <th scope="row" :style="{color:m.heading ?? m.color}">{{ m.label }}</th>
            <td>{{ measure(m,'a') }}</td>
            <td>{{ measure(m,'b') }}</td>
            <td>{{ measure(m,'delta') }}</td>
          </tr>
        </tbody></table>
      </section>
      <div class="compact-plots">
        <p class="quiet compare-trend-note">Trend charts line up the runs by generation. The two world views above can show different days.</p>
        <TrendPlot v-for="m in [...METRICS,huntMetric]" :key="m.key" :title="m.label" :unit="m.unit ?? 'hunts per day'" :color="m.heading ?? m.color" :rows="rows"
          :pin="day" :series="series(m)" :focus="focus===m.key" legend @watch="seekDay" @pin="seekDay" @focus="focus=focus===m.key?'':m.key"/>
      </div>
    </template>
  </main>
  </Teleport>
</template>
