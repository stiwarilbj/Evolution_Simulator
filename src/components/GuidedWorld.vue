<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Aperture, Pause, Play, RotateCcw } from 'lucide-vue-next'
import { guidedExamples } from '../guide.js'
import { guideSource, lessonMoments } from '../guide-replay.js'
import { travel, WALKTHROUGH_STEP } from '../engine/geometry.js'
import { format } from '../engine/stats.js'
import { trackFrame } from '../track.js'
import { useLab } from '../store.js'
import Board from './Board.vue'
import ExtinctionIcon from './ExtinctionIcon.vue'

const props = defineProps({ example:String })
const emit = defineEmits(['exit'])
const lab = useLab()
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const spec = computed(() => guidedExamples[props.example])
const source = computed(() => guideSource(spec.value.source))
const moments = shallowRef([])
const step = ref(0), elapsed = ref(0), selected = ref(null), playing = ref(false)
const focus = ref(false), busy = ref(true), error = ref('')
let animation, previous, request = 0
const moment = computed(() => moments.value[step.value])
const duration = computed(() => moment.value?.hold ?? ((moment.value?.to ?? 0) - (moment.value?.from ?? 0)))
const frame = computed(() => moment.value && trackFrame(moment.value.track, Math.min(moment.value.to, moment.value.from + elapsed.value)))
const creature = computed(() => frame.value?.blobs.find(blob => blob.id === selected.value))
const layers = computed(() => ({ ...spec.value.layers, vision:focus.value,
  selected:selected.value != null && !spec.value.layers?.speed }))
const day = computed(() => moment.value?.track.day ?? spec.value.day ?? 1)
const end = computed(() => elapsed.value >= duration.value && step.value === moments.value.length - 1)
const speedRange = computed(() => {
  if (!spec.value.layers?.speed) return
  const speeds = source.value.setup.species.filter(species => species.enabled).map(species => species.speed)
  return { min:Math.min(...speeds), max:Math.max(...speeds) }
})

function pause() {
  playing.value = false
  cancelAnimationFrame(animation)
}
function jump(index) {
  step.value = index
  elapsed.value = 0
  selected.value = moment.value.blob ?? null
  focus.value = Boolean(spec.value.layers?.vision && moment.value.vision !== false)
}
function tick(now) {
  if (!playing.value) return
  const delta = previous ? Math.min(.1, (now - previous) / 1000) : 0
  previous = now
  elapsed.value = Math.min(duration.value, elapsed.value + delta)
  if (elapsed.value >= duration.value) {
    if (end.value) { pause(); return }
    jump(step.value + 1)
  }
  animation = requestAnimationFrame(tick)
}
function play() {
  if (!moment.value) return
  if (end.value) jump(0)
  previous = 0
  playing.value = true
  animation = requestAnimationFrame(tick)
}
function restart() {
  pause()
  jump(0)
  if (!reduced.matches) play()
}
function choose(index) {
  pause()
  jump(index)
  if (!reduced.matches) play()
}
async function load() {
  const token = ++request
  const run = source.value
  const example = props.example
  pause()
  busy.value = true
  error.value = ''
  moments.value = []
  step.value = 0
  try {
    const track = await lab.getTrack(run, spec.value.day ?? 1)
    const next = example === 'offspring' ? await lab.getTrack(run, 2) : undefined
    if (token !== request) return
    moments.value = lessonMoments(example, track, next)
    jump(0)
    if (!reduced.matches) play()
  } catch {
    if (token === request) error.value = 'This example could not load.'
  } finally {
    if (token === request) busy.value = false
  }
}
function pauseWhenHidden() {
  if (document.hidden) pause()
}
watch(() => props.example, load, { immediate:true })
onMounted(() => document.addEventListener('visibilitychange', pauseWhenHidden))
onBeforeUnmount(() => {
  ++request
  pause()
  document.removeEventListener('visibilitychange', pauseWhenHidden)
})
</script>

<template>
  <main class="guided-world" aria-labelledby="example-title">
    <header class="guided-heading">
      <div><span class="quiet">Guided World · Day {{ day }}</span><h1 id="example-title">{{ spec.title }}</h1></div>
      <button class="secondary" @click="emit('exit')">Back to walkthrough</button>
    </header>
    <div class="guided-stage" :class="{ 'guided-split':example==='energy' }">
      <div class="guided-board" :aria-busy="busy">
        <Board v-if="moment" :frame="frame" :species="source.setup.species" :layers="layers" :selected="selected"
          :follow="selected!=null" :camera="spec.camera ?? 'board'" :speed-range="speedRange" scope="all"
          quality="efficient" @select="selected=$event"/>
        <div v-else class="stage-note">
          <p role="status">{{ error || 'Preparing the example…' }}</p>
          <button v-if="error" class="secondary" @click="load">Retry example</button>
        </div>
        <div v-if="moment && speedRange" class="speed-key" aria-label="Body color by speed">
          <span>Speed · points</span><i aria-hidden="true"></i>
          <div><span>{{ speedRange.min }}</span><span>{{ speedRange.max }}</span></div>
        </div>
        <p v-if="moment?.label" class="guided-caption" role="status">{{ moment.label }}</p>
        <div v-if="example==='extinction' && end" class="guided-extinction">
          <button :aria-label="'Extinction on Day '+day+'. Replay the last generation'" @click="restart">
            <ExtinctionIcon/>Day {{ day }} · Extinct
          </button>
        </div>
      </div>
      <aside v-if="example==='energy'" class="guided-cost">
        <section><h2>What helps</h2><p>Better sight<br>Longer strides<br>Hunting smaller blobs</p></section>
        <section><h2>Energy cost</h2><p>(Size³ × stride² + sight) ÷ 10,000</p></section>
      </aside>
    </div>
    <div class="guided-controls">
      <button class="icon" :disabled="!moment" :aria-label="playing?'Pause example':'Play example'" @click="playing?pause():play()">
        <Pause v-if="playing" :size="20"/><Play v-else :size="20"/>
      </button>
      <button class="icon" :disabled="!moment" aria-label="Replay example" @click="restart"><RotateCcw :size="19"/></button>
      <input type="range" min="0" :max="duration" step="0.01" :value="elapsed" :disabled="!duration"
        aria-label="Example progress" @input="pause(); elapsed=$event.target.valueAsNumber">
      <span class="guided-time">{{ format(frame?.time,2) }} s</span>
      <button v-if="spec.layers?.vision" class="secondary" :disabled="!moment" :aria-pressed="focus" @click="focus=!focus"><Aperture :size="15"/> Sense focus</button>
    </div>
    <div v-if="moments.length>1" class="guided-moments" aria-label="Family replay stages">
      <button v-for="(part,index) in moments" :key="part.label" class="secondary" :aria-pressed="step===index"
        @click="choose(index)">{{ part.label }}</button>
    </div>
    <p class="guided-summary">{{ spec.text }}
      <span v-if="creature" class="quiet">Blob #{{ creature.id }}
        <template v-if="example==='speed' || example==='stride'">
          · Size {{ format(creature.size) }} · Speed {{ format(creature.speed) }}
          · {{ format(travel(creature,source.setup)*WALKTHROUGH_STEP) }} units per step
        </template>
        <template v-else> · Sight {{ format(creature.sense) }} · Food {{ creature.credits }}</template>
        <template v-if="example==='hunt'"> · Prey {{ creature.preyCredits }}</template>
        <template v-if="spec.layers?.energy"> · Energy {{ format(creature.energy,0) }}</template>
      </span>
    </p>
  </main>
</template>
