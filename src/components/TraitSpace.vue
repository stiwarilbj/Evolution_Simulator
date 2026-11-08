<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useLab } from '../store.js'
import { format } from '../engine/stats.js'

const props=defineProps({scope:String})
const emit=defineEmits(['watch'])
const lab=useLab()
const day=ref(1), compare=ref(0), track=ref(null), other=ref(null), chosenId=ref(null)
const loading=ref(false), issue=ref(''), compareIssue=ref('')
const angle=ref(-.58), tilt=ref(.48), bins=ref(20), metric=ref('speed'), percent=ref(false)
let request=0, compareRequest=0, gesture
const scoped=frame=>frame?.final.blobs.filter(b=>b.alive && (props.scope==='all'||props.scope===b.species)) ?? []
const cohort=computed(()=>scoped(track.value))
const second=computed(()=>scoped(other.value))
const chosen=computed(()=>cohort.value.find(b=>b.id===chosenId.value))
const species=computed(()=>Object.fromEntries(lab.run.setup.species.map(s=>[s.id,s])))
const runId=()=>lab.run.id
const dayAvailable=computed(()=>day.value<=lab.completed)
watch(runId,()=>{ day.value=Math.max(1,lab.completed); compare.value=0 },{immediate:true})
watch(chosen,blob=>{ if(!blob) chosenId.value=null })
watch([day,runId,dayAvailable],async()=>{
  const id=++request
  track.value=null
  chosenId.value=null
  issue.value=''
  loading.value=dayAvailable.value
  if(!loading.value) return
  try { const result=await lab.getTrack(lab.run,day.value); if(id===request) track.value=result }
  catch(e){ if(id===request) issue.value=e.message }
  finally { if(id===request) loading.value=false }
},{immediate:true})
watch([compare,runId],async()=>{
  const id=++compareRequest
  other.value=null
  compareIssue.value=''
  if(!compare.value) return
  try{const result=await lab.getTrack(lab.run,compare.value); if(id===compareRequest) other.value=result}
  catch(e){if(id===compareRequest) compareIssue.value=e.message}
})
onBeforeUnmount(()=>{request++;compareRequest++})
function wholeNumber(event,current,min,max){
  const input=event.target, value=input.valueAsNumber
  const accepted=Number.isInteger(value)&&value>=min&&value<=max ? value : current
  input.value=accepted
  return accepted
}
function transform(x,y,z){
  const c=Math.cos(angle.value), s=Math.sin(angle.value), v=Math.cos(tilt.value), w=Math.sin(tilt.value)
  return {x:310+155*(x*c-z*s),y:205-155*(y*v-(x*s+z*c)*w),z:x*s+z*c}
}
const scales=computed(()=>Object.fromEntries(['speed','size','sense'].map(key=>[key,cohort.value.reduce((m,b)=>Math.max(m,b[key]),1)])))
const points=computed(()=>cohort.value.map(b=>({b,...transform(b.speed/scales.value.speed-.5,b.sense/scales.value.sense-.36,b.size/scales.value.size-.5)})).sort((a,b)=>a.z-b.z))
const axes=computed(()=>[
  ['Speed',transform(.66,-.36,-.5)],['Size',transform(-.5,-.36,.66)],['Sense',transform(-.5,.86,-.5)]
])
const origin=computed(()=>transform(-.5,-.36,-.5))
const histogram=computed(()=>{
  const a=cohort.value.map(b=>b[metric.value]), b=second.value.map(blob=>blob[metric.value])
  const min=Math.min(...a,...b), max=Math.max(...a,...b)
  if(!a.length&&!b.length) return {bars:[],min:0,max:0,a:0,b:0}
  const count=min===max?1:bins.value
  const bars=Array.from({length:count},()=>[0,0])
  for(const [group,values] of [a,b].entries()) for(const value of values){
    const bin=count===1?0:Math.min(count-1,Math.floor((value-min)/(max-min)*count))
    bars[bin][group]+=percent.value ? 100/values.length : 1
  }
  return {bars,min,max,peak:Math.max(1,...bars.flat()),a:a.length,b:b.length,
    mean:a.length?a.reduce((total,n)=>total+n/a.length,0):null}
})
function down(event){gesture={x:event.clientX,y:event.clientY};event.currentTarget.setPointerCapture?.(event.pointerId)}
function move(event){if(!gesture)return;angle.value+=(event.clientX-gesture.x)*.012;tilt.value=Math.min(1.28,Math.max(-.8,tilt.value+(event.clientY-gesture.y)*.008));gesture={x:event.clientX,y:event.clientY}}
function watchCreature(){
  const { id, state }=chosen.value
  const newborn=state===7
  const nextDay=newborn && day.value<lab.completed
  emit('watch',nextDay ? day.value+1 : day.value,id,{ atEnd:newborn && !nextDay })
}
</script>
<template>
  <section class="trait-space">
    <header><h2>Trait Space</h2><label>Day <input type="number" :value="day" min="1" :max="lab.completed || 1" @change="day=wholeNumber($event,day,1,lab.completed)"></label>
      <button class="secondary" @click="angle=-.58;tilt=.48">Reset view</button></header>
    <p v-if="issue" class="issue">{{ issue }}</p>
    <p v-if="loading" class="quiet center" role="status">Loading Day {{ day }}…</p>
    <p v-else-if="!cohort.length && !issue" class="quiet center">Choose a completed day with living creatures.</p>
    <div v-else-if="cohort.length" class="trait-layout">
      <svg viewBox="0 0 620 350" aria-label="Trait scatter. Drag to rotate." @pointerdown.self="down" @pointermove="move" @pointerup="gesture=null" @pointercancel="gesture=null">
        <rect x="0" y="0" width="620" height="350" fill="transparent" @pointerdown="down"/>
        <g v-for="[label,end] in axes" :key="label">
          <line :x1="origin.x" :y1="origin.y" :x2="end.x" :y2="end.y" stroke="#777268"/>
          <text :x="end.x" :y="end.y-8" fill="#EEEDD6">{{ label }}</text>
        </g>
        <circle v-for="point in points" :key="point.b.id" :cx="point.x" :cy="point.y" :r="chosen?.id===point.b.id?6:3.5"
          :fill="species[point.b.species]?.color || '#83B3CE'" :stroke="chosen?.id===point.b.id?'#FFFDFC':'none'" @click="chosenId=point.b.id">
          <title>{{ species[point.b.species]?.name }} #{{ point.b.id }}</title>
        </circle>
      </svg>
      <aside><label>Creature <select :value="chosenId ?? ''" @change="chosenId=$event.target.value ? Number($event.target.value) : null">
        <option value="">Choose</option><option v-for="b in cohort" :key="b.id" :value="b.id">{{ species[b.species]?.name }} #{{ b.id }}</option>
      </select></label>
      <p v-if="chosen">{{ format(chosen.speed) }} speed · {{ format(chosen.size) }} size · {{ format(chosen.sense) }} sense</p>
      <button v-if="chosen" class="secondary" @click="watchCreature">Watch creature</button>
      <p class="quiet">{{ cohort.length }} living blobs at dusk. Rotate to inspect the axes.</p></aside>
    </div>
    <header><h3>Trait distribution</h3><label>Trait <select v-model="metric"><option value="speed">Speed</option><option value="size">Size</option><option value="sense">Sense Range</option></select></label>
      <label>Bins <input :value="bins" type="number" min="5" max="50" @change="bins=wholeNumber($event,bins,5,50)"></label><label><input v-model="percent" type="checkbox"> Percentage</label>
      <label>Compare day <input :value="compare" type="number" min="0" :max="lab.completed" title="0 shows one day" @change="compare=wholeNumber($event,compare,0,lab.completed)"></label>
    </header>
    <p v-if="compareIssue" class="issue">Could not load comparison Day {{ compare }}. {{ compareIssue }}</p>
    <svg v-if="track && histogram.bars.length" viewBox="0 0 760 165" class="histogram" aria-label="Trait histogram">
      <line x1="30" y1="135" x2="730" y2="135" stroke="#777268"/>
      <g v-for="([a,b],i) in histogram.bars" :key="i" :transform="'translate('+(30+700*i/histogram.bars.length)+' 0)'">
        <rect :x="4" :y="135-105*a/histogram.peak" :width="(700/histogram.bars.length-8)/(histogram.b?2:1)" :height="105*a/histogram.peak" fill="#83B3CE"><title>Day {{ day }} · {{ format(a,percent?1:0) }}</title></rect>
        <rect v-if="histogram.b" :x="700/histogram.bars.length/2" :y="135-105*b/histogram.peak" :width="(700/histogram.bars.length-8)/2" :height="105*b/histogram.peak" fill="#F6AD73"><title>Day {{ compare }} · {{ format(b,percent?1:0) }}</title></rect>
      </g>
      <line v-if="histogram.mean!=null" :x1="30+700*(histogram.mean-histogram.min)/(histogram.max-histogram.min || 1)" :x2="30+700*(histogram.mean-histogram.min)/(histogram.max-histogram.min || 1)" y1="21" y2="135" stroke="#FFFDFC" stroke-dasharray="4 3"/>
      <text x="30" y="156" fill="#BDBAB0">{{ format(histogram.min) }}</text><text x="730" y="156" fill="#BDBAB0" text-anchor="end">{{ format(histogram.max) }}</text>
    </svg>
    <p v-if="histogram.a" class="quiet">Day {{ day }} · {{ histogram.a }} samples · Mean {{ format(histogram.mean) }}</p>
  </section>
</template>
