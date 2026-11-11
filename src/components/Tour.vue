<script setup>
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { CircleX, Play, Pause } from 'lucide-vue-next'
import Board from './Board.vue'
import { starter } from '../engine/config.js'
import { founders } from '../engine/simulation.js'
import { trackFrame } from '../track.js'
import { useLab } from '../store.js'

const emit=defineEmits(['close','world'])
const dialog=ref(), step=ref(0), track=shallowRef(null), time=ref(0), chosen=ref(null), issue=ref('')
const playing=ref(false), lab=useLab(), setup=starter()
const source={id:'intro-demo',setup,revisions:[],checkpoints:[{day:0,...founders(setup)}]}
let frameId, previous=0, closed=false
const chapters=[
  ['Welcome to the tabletop','Every blob begins at an edge. The olive pellets are food, and the pale strip is refuge.'],
  ['Find food','Follow a creature on its way to its first pellet. Turn on the pale sensing circle and watch the pellet disappear on contact.'],
  ['Spend energy','The energy halo drains as a creature moves. Each bite earns one food credit without refilling energy.'],
  ['Go home','With two credits, a blob heads for the nearest viable refuge. It stops spending energy as soon as it reaches safety.'],
  ['See a birth','At dusk, a rested parent with two credits has one child. Each unlocked trait varies around the parent’s value.'],
  ['Read the experiment','The timeline and Trends turn each completed day into measurements. Start with the example, or design your own experiment in Settings.']
]
const events=computed(()=>{
  if(!track.value) return {}
  const born=track.value.events.find(e=>e.type==='birth')
  const parent=born?.parent
  return { first:track.value.events.find(e=>e.type==='plant'),
    bite:track.value.events.find(e=>e.type==='plant'&&e.id===parent),
    home:track.value.events.find(e=>e.type==='home'&&e.id===parent), born }
})
const layers=computed(()=>({ sense:step.value===1, energy:step.value===2,
  credits:step.value>=2, homes:step.value===3, selected:step.value>0 }))
const current=computed(()=>track.value ? trackFrame(track.value,time.value) : null)
const follow=computed(()=>step.value>0&&step.value<5&&chosen.value!=null)
function stop() { playing.value=false; cancelAnimationFrame(frameId) }
function animate(now) {
  if(!playing.value) return
  if(previous) time.value=Math.min(track.value.duration,time.value+Math.min(.09,(now-previous)/1000))
  previous=now
  if(time.value<track.value.duration) frameId=requestAnimationFrame(animate)
  else stop()
}
function toggle() {
  if(playing.value) { stop(); return }
  if(time.value>=track.value.duration) jump()
  playing.value=true
  previous=0
  frameId=requestAnimationFrame(animate)
}
function jump() {
  if(!track.value) return
  const { first,bite,home,born }=events.value
  chosen.value=step.value===1 ? first?.id : born?.parent
  time.value=[0,Math.max(0,(first?.time ?? 1)-.65),Math.max(0,(bite?.time ?? 2)-.5),
    Math.max(0,(home?.time ?? 3)-.9),track.value.duration,0][step.value]
}
watch(step,()=>{stop();jump()})
function close(world=false) {
  try { localStorage.setItem('evolution.tour','seen') } catch {}
  emit(world?'world':'close')
}
onMounted(async ()=>{
  dialog.value.showModal()
  try { const result=await lab.getTrack(source,1); if(!closed){track.value=result;jump()} }
  catch { if(!closed) issue.value='The demo could not load. You can still open the World.' }
})
onBeforeUnmount(()=>{closed=true;stop()})
</script>

<template>
  <dialog ref="dialog" class="task-dialog tour-dialog" aria-labelledby="tour-title" @cancel.prevent="close()">
    <header><h2 id="tour-title">Explore the tabletop</h2><button class="icon" aria-label="Close tour" @click="close()"><CircleX :size="23"/></button></header>
    <progress :value="step+1" max="6" aria-label="Tour progress"></progress>
    <div class="tour-board" :aria-busy="!track && !issue">
      <Board :frame="current" :species="setup.species" :layers="layers" :selected="chosen" :follow="follow"
        camera="board" scope="all" @select="chosen=$event"/>
      <p v-if="!track" class="stage-note">{{ issue || 'Preparing a demo day…' }}</p>
    </div>
    <div class="tour-chapter"><h3>{{ chapters[step][0] }}</h3>
      <button class="icon" :aria-label="playing?'Pause demo':'Play demo'" :disabled="!track || step===4" @click="toggle">
        <Pause v-if="playing" :size="20"/><Play v-else :size="20"/>
      </button>
    </div>
    <p>{{ chapters[step][1] }}</p>
    <footer>
      <button class="link" @click="close()">Skip</button>
      <button class="secondary" :disabled="step===0" @click="step--">Back</button>
      <button class="primary" @click="step===5?close(true):step++">{{ step===0?'Get started':step===5?'Open World':'Next' }}</button>
    </footer>
  </dialog>
</template>
