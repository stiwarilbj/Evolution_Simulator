<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { useLab } from '../store.js'
import { experiments, setupFor, sizeVariancePair } from '../experiments.js'
const lab=useLab()
const emit=defineEmits(['world','compare'])
const chapter=ref(0), video=ref('')
const pairSeed=ref(18), pairDays=ref(100), pairProgress=ref(null), pairMessage=ref('')
let pairController
const chapters=[
  ['The field','The tabletop is a 500-unit square. Pellets and creatures occupy the same flat plane.'],
  ['Follow a creature','Select a blob to see its eyes, thought bubble, and individual trait flower.'],
  ['Sight','The Eye layer shows the distance at which a creature can sense plants and other creatures.'],
  ['Speed','The Runner layer maps slow bodies to brown and faster ones to red. Faster strides use more energy.'],
  ['Energy','By default, each move costs energy equal to size cubed times movement speed squared, plus sight range, divided by 10,000. Movement speed is measured in units per 0.1-second step.'],
  ['Predation','In new setups, prey can be at most 80% of the hunter’s size. A blob of size 12.5 can eat a blob of size 10.'],
  ['Getting home','A plant or prey gives one food credit. By default, energy refills at dawn. Return to the edge with one credit to survive or two to have one offspring.'],
  ['Inheritance','A newborn samples each enabled trait from a normal distribution centered on its parent.'],
  ['Read a flower','A flower combines the day’s mean traits and its closing population.'],
  ['Trends','Percentiles, extrema, birth and death counts, and supply reveal change across generations.'],
  ['Compare experiments','Run the same seed with a different size variance or food schedule and compare the two archives.'],
]

async function runPair() {
  if (pairProgress.value) return
  const controller = new AbortController()
  pairController = controller
  pairMessage.value = ''
  pairProgress.value = { side:0, day:0, saving:false }
  try {
    const pair = await lab.preparePair(
      sizeVariancePair(pairSeed.value, pairDays.value),
      controller.signal,
      (side, day) => { pairProgress.value = { side, day, saving:false } },
      () => { pairProgress.value.saving = true }
    )
    if (!controller.signal.aborted) emit('compare', pair)
  } catch (error) {
    pairMessage.value = controller.signal.aborted ? 'Experiment canceled.' : error.message
  } finally {
    pairController = null
    pairProgress.value = null
  }
}
onBeforeUnmount(() => pairController?.abort())
</script>
<template>
  <main class="about">
    <div class="about-mark" aria-hidden="true">◇</div>
    <h1>Evolution Simulator</h1>
    <p>Watch a population change as small inherited differences meet the same field, the same clock, and a limited food supply.</p>
    <div class="about-actions"><button class="primary" @click="emit('world')">Open World</button><button class="secondary" @click="lab.modal='tour'">Show tour</button></div>
    <section class="lesson">
      <h2>Walkthrough</h2>
      <div class="chapter-list"><button v-for="([title],i) in chapters" :key="title" class="secondary" :aria-pressed="chapter===i" @click="chapter=i">{{ String(i+1).padStart(2,'0') }} {{ title }}</button></div>
      <h3>{{ chapters[chapter][0] }}</h3><p>{{ chapters[chapter][1] }}</p>
      <div class="about-actions"><button class="secondary" :disabled="chapter===0" @click="chapter--">Back</button>
        <button class="secondary" :disabled="chapter===chapters.length-1" @click="chapter++">Next</button><button class="link" @click="emit('world')">Try it in World</button></div>
    </section>
    <section class="reference-videos">
      <div v-for="[id,title,credit] in [['6nMo8T3T0L4','Interactive Evolution Simulator','MinuteLabs · Jasper Palfree · art direction by Sarah Berman'],['0ZGbIKd0XrM','Simulating Natural Selection','Primer']]" :key="id">
        <iframe v-if="video===id" :src="'https://www.youtube-nocookie.com/embed/'+id+'?autoplay=1'" :title="title" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
        <button v-else class="video-launch" @click="video=id"><span>▶</span>{{ title }}</button>
        <p class="quiet">{{ credit }} <a :href="'https://www.youtube.com/watch?v='+id" target="_blank" rel="noreferrer">Watch on YouTube</a></p>
      </div>
    </section>
    <section><h2>Experiments</h2>
      <article class="paired-experiment" aria-labelledby="variance-title">
        <h3 id="variance-title">Compare size mutation</h3>
        <p>Run the same setup twice with size variance of 1.00 and 0.25. Both use the same seed, founders, food, and rules. Compare their hunts, traits, and population at the same point in a day.</p>
        <form class="about-actions" @submit.prevent="runPair">
          <label>Seed <input v-model.number="pairSeed" type="number" min="1" max="100" step="1" required :disabled="!!pairProgress"></label>
          <label>Days per run <select v-model.number="pairDays" :disabled="!!pairProgress"><option :value="100">100</option><option :value="600">600</option></select></label>
          <button class="primary" :disabled="!!pairProgress">Run both and compare</button>
          <button v-if="pairProgress && !pairProgress.saving" type="button" class="secondary" @click="pairController?.abort()">Cancel</button>
        </form>
        <div v-if="pairProgress" class="pair-progress">
          <progress :value="pairProgress.side*pairDays+pairProgress.day" :max="2*pairDays" aria-label="Paired experiment progress"></progress>
          <span role="status">{{ pairProgress.saving ? 'Saving both runs…' : 'Simulating '+(pairProgress.side===0?'wide':'narrow')+' size variance · '+pairProgress.day+' / '+pairDays }}</span>
        </div>
        <p v-if="pairMessage" class="quiet" role="status">{{ pairMessage }}</p>
      </article>
      <div class="experiments">
      <article v-for="item in experiments" :key="item.title"><h3>{{ item.title }}</h3><p>{{ item.detail }}</p><button class="secondary" @click="lab.openSettings(setupFor(item))">Load setup</button></article>
    </div></section>
  </main>
</template>
