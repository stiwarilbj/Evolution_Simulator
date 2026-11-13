<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Aperture, Pause, Play, RotateCcw } from 'lucide-vue-next'
import { guidedExamples } from '../guide.js'
import { guideSource, lessonMoments, SIGHT_EXAMPLE_DAYS, SIGHT_EXAMPLE_LATER_DAY } from '../guide-replay.js'
import { travel, WALKTHROUGH_STEP } from '../engine/geometry.js'
import { distribution, format } from '../engine/stats.js'
import { trackFrame } from '../track.js'
import { prepareExperiment, useLab } from '../store.js'
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
const preparedDay = ref(0)
let animation, previous, loading
const sightExample = computed(() => props.example === 'sight-comparison')
const moment = computed(() => moments.value[step.value])
const openingSight = computed(() => sightExample.value && moment.value
  ? distribution(moment.value.track.opening.map(blob => blob.sense)) : null)
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
function jump(index, preview = false) {
  step.value = index
  elapsed.value = preview ? moment.value.preview ?? 0 : 0
  selected.value = moment.value.blob ?? null
  focus.value = Boolean(spec.value.layers?.vision && moment.value.vision !== false)
}
function tick(now) {
  if (!playing.value) return
  const delta = previous ? Math.min(.1, (now - previous) / 1000) : 0
  previous = now
  elapsed.value = Math.min(duration.value, elapsed.value + delta)
  if (elapsed.value >= duration.value) {
    if (sightExample.value || end.value) { pause(); return }
    jump(step.value + 1)
  }
  animation = requestAnimationFrame(tick)
}
function play() {
  if (!moment.value) return
  if (elapsed.value >= duration.value && sightExample.value) jump(step.value)
  else if (end.value) jump(0)
  previous = 0
  playing.value = true
  animation = requestAnimationFrame(tick)
}
function restart() {
  pause()
  jump(sightExample.value ? step.value : 0)
  if (!reduced.matches) play()
}
function choose(index) {
  pause()
  jump(index, sightExample.value)
  if (!reduced.matches && !sightExample.value) play()
}
async function load() {
  loading?.abort()
  const controller = new AbortController()
  loading = controller
  const { signal } = controller
  let run = source.value
  const example = props.example
  const isSight = sightExample.value
  const firstDay = spec.value.day ?? 1
  pause()
  busy.value = true
  error.value = ''
  preparedDay.value = 0
  moments.value = []
  step.value = 0
  try {
    if (isSight) {
      run = await prepareExperiment(run.setup, signal, day => {
        if (day % 25 === 0) preparedDay.value = day
      })
      if (run.summaries.at(-1)?.day !== SIGHT_EXAMPLE_DAYS) throw new Error('The sight example ended early.')
    }
    const secondDay = isSight ? SIGHT_EXAMPLE_LATER_DAY : example === 'offspring' ? 2 : null
    const [track, next] = await Promise.all([
      lab.getTrack(run, firstDay), secondDay && lab.getTrack(run, secondDay),
    ])
    if (signal.aborted) return
    moments.value = lessonMoments(example, track, next)
    jump(0, isSight)
    if (!reduced.matches && !isSight) play()
  } catch {
    if (!signal.aborted) error.value = 'This example could not load.'
  } finally {
    if (!signal.aborted) busy.value = false
  }
}
function pauseWhenHidden() {
  if (document.hidden) pause()
}
watch(() => props.example, load, { immediate:true })
onMounted(() => document.addEventListener('visibilitychange', pauseWhenHidden))
onBeforeUnmount(() => {
  loading?.abort()
  pause()
  document.removeEventListener('visibilitychange', pauseWhenHidden)
})
</script>

<template>
  <main class="guided-world" aria-labelledby="example-title">
    <header class="guided-heading">
      <div><span class="quiet">Guided World · Day {{ day }}</span><h1 id="example-title">{{ spec.title }}</h1></div>
      <button class="secondary" @click="emit('exit')">{{ sightExample?'Back to Trends':'Back to walkthrough' }}</button>
    </header>
    <div class="guided-stage" :class="{ 'guided-split':example==='energy' }">
      <div class="guided-board" :aria-busy="busy">
        <Board v-if="moment" :frame="frame" :species="source.setup.species" :layers="layers" :selected="selected"
          :follow="selected!=null" :camera="spec.camera ?? 'board'" :speed-range="speedRange" scope="all"
          quality="efficient" @select="selected=$event"/>
        <div v-else class="stage-note">
          <p role="status">{{ error || (sightExample ? 'Preparing the sight example · Day '+preparedDay+' of 1,000' : 'Preparing the example…') }}</p>
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
    <div v-if="moments.length>1" class="guided-moments" role="group" :aria-label="sightExample?'Sight comparison stages':'Family replay stages'">
      <button v-for="(part,index) in moments" :key="part.label" class="secondary" :aria-pressed="step===index"
        @click="choose(index)">{{ part.label }}</button>
    </div>
    <p class="guided-summary">{{ spec.text }}
      <span v-if="openingSight" class="quiet">Dawn sight · Mean {{ format(openingSight.mean) }} ± {{ format(openingSight.sd) }} · {{ openingSight.n }} blobs</span>
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
