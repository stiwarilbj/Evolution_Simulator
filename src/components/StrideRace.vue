<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { Flag, Footprints, Pause, Play, RotateCcw } from 'lucide-vue-next'
import { WALKTHROUGH_STEP, travel } from '../engine/geometry.js'

const lanes = [12, 10].map(size => ({
  size, stride:travel({ size, speed:10 }, { stride:'linked' }) * WALKTHROUGH_STEP,
}))
const finish = 60
const limit = Math.max(...lanes.map(lane=>Math.ceil(finish/lane.stride)))
const steps = ref(0), playing = ref(false)
let timer
const clock = computed(() => (steps.value * WALKTHROUGH_STEP).toFixed(1))

function pause() {
  clearInterval(timer)
  playing.value = false
}
function toggle() {
  if (playing.value) { pause(); return }
  if (steps.value >= limit) steps.value = 0
  playing.value = true
  timer = setInterval(() => {
    steps.value++
    if (steps.value === limit) pause()
  }, 420)
}
onBeforeUnmount(pause)
</script>

<template>
  <div class="stride-demo" aria-label="Two-lane stride race">
    <div class="stride-lane" v-for="lane in lanes" :key="lane.size">
      <header><b>Size {{ lane.size }}</b><span>{{ lane.stride }} units per step</span></header>
      <div class="stride-track">
        <Footprints v-for="foot in Math.min(steps,Math.ceil(finish/lane.stride))" :key="foot"
          :style="{left:(Math.min(foot*lane.stride,finish)/finish*100)+'%'}" class="stride-foot" :size="19" aria-hidden="true"/>
        <Flag class="stride-flag" :size="23" aria-hidden="true"/>
      </div>
      <output>{{ Math.min(steps*lane.stride,finish) }} / {{ finish }} units</output>
    </div>
    <div class="about-actions stride-actions">
      <button class="secondary" @click="toggle"><Pause v-if="playing" :size="16"/><Play v-else :size="16"/>{{ playing?'Pause race':steps>=limit?'Race again':'Play race' }}</button>
      <button class="icon" aria-label="Reset race" @click="pause();steps=0"><RotateCcw :size="17"/></button>
      <span>Step {{ steps }} · {{ clock }} s</span>
    </div>
    <details class="stride-code">
      <summary>See the original Rust rule</summary>
      <pre><code>self.speed.0 * self.size.0 / 10.</code></pre>
      <p>Inherited speed × body size ÷ 10 gives the distance per step.</p>
      <a href="https://github.com/minutelabsio/evolution-simulator/blob/3b99f358b70a608f5fb3e34fe8f410ba85aec7f3/src/wasm/src/creature/mod.rs#L171-L175" target="_blank" rel="noreferrer">View the source</a>
    </details>
  </div>
</template>
