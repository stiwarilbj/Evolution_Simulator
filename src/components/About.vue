<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useLab } from '../store.js'
import { MAX_SEED } from '../engine/config.js'
import { walkthroughStepCost } from '../engine/geometry.js'
import { experiments, setupFor, sizeMutationPair, SIZE_MUTATION_DAYS, SIZE_MUTATION_SEED } from '../experiments.js'
import { lessons, videoAt } from '../guide.js'
import finches from '../assets/guide-finches.webp'
import primer from '../assets/guide-primer.webp'
import primerOverhead from '../assets/guide-primer-overhead.webp'
import primerClose from '../assets/guide-primer-close.webp'
import host from '../assets/guide-host.webp'
import StrideRace from './StrideRace.vue'

const lab=useLab()
const props=defineProps({ lesson:String })
const emit=defineEmits(['world','compare','lesson','example','trends'])
const chapter=computed(()=>Math.max(0,lessons.findIndex(item=>item.id===props.lesson)))
const current=computed(()=>lessons[chapter.value])
const slide=ref(0), video=ref('')
const pairSeed=ref(SIZE_MUTATION_SEED), pairDays=ref(SIZE_MUTATION_DAYS), pairProgress=ref(null), pairMessage=ref('')
let pairController
const opening=[
  { image:finches, title:'Finches', alt:'Four finch profiles with deep, pointed, and curved beaks',
    caption:'Different beaks work better for different foods.' },
  { image:primer, title:'Primer', alt:'Blue, yellow, green and orange clay blobs gather around food on a white table',
    montage:[
      { image:primerOverhead, alt:'Clay blobs scattered across a white tabletop seen from above' },
      { image:primerClose, alt:'Three clay blobs reach for a pile of food' },
    ],
    caption:'Primer used simple animated creatures to show how natural selection works.' },
  { image:host, title:'The host', alt:'Hand-drawn science host with round glasses and open hands',
    caption:'Now try the idea yourself. Follow a creature and see what it takes to survive.' },
]
const exampleCost = size => walkthroughStepCost({ size, speed:10, sense:20 }, { stride:'linked' }).toFixed(3)
function selectChapter(index) {
  const entry = lessons[index]
  if (entry) emit('lesson',entry.id)
}

async function runPair() {
  if (pairProgress.value) return
  const controller = new AbortController()
  pairController = controller
  pairMessage.value = ''
  pairProgress.value = { side:0, day:0, saving:false }
  try {
    const pair = await lab.preparePair(
      sizeMutationPair(pairSeed.value, pairDays.value),
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
      <div class="chapter-list" aria-label="Walkthrough chapters"><button v-for="(entry,i) in lessons" :key="entry.id"
        class="secondary" :aria-pressed="chapter===i" @click="selectChapter(i)">{{ entry.title }}</button></div>
      <article class="chapter-panel" :key="current.id">
        <header class="chapter-card"><h3>{{ current.title }}</h3></header>
        <div v-if="current.id==='opening'" class="opening-slides">
          <figure>
            <img :src="opening[slide].image" :alt="opening[slide].alt" width="1200" height="263">
            <div v-if="opening[slide].montage" class="opening-montage">
              <img v-for="still in opening[slide].montage" :key="still.image" :src="still.image" :alt="still.alt" width="680" height="325">
            </div>
            <figcaption>{{ opening[slide].caption }}</figcaption>
          </figure>
          <div class="opening-tabs" aria-label="Opening illustrations">
            <button v-for="(scene,index) in opening" :key="scene.title" class="secondary" :aria-pressed="slide===index"
              @click="slide=index">{{ scene.title }}</button>
          </div>
        </div>
        <StrideRace v-if="current.id==='stride'"/>
        <div v-if="current.id==='energy'" class="energy-cutaway">
          <div>
            <h4>What helps find food</h4>
            <ul><li>Better sight</li><li>Longer strides</li><li>Hunting smaller blobs</li></ul>
          </div>
          <div>
            <h4>Energy spent per move</h4>
            <p class="guide-formula">(size³ × distance per step² + sight) ÷ 10,000</p>
            <p>At speed 10 and sight 20, a size-10 blob spends <b>{{ exampleCost(10) }}</b> energy per step. A size-12 blob spends <b>{{ exampleCost(12) }}</b>.</p>
          </div>
        </div>
        <p class="chapter-text">{{ current.text }}</p>
      </article>
      <div class="about-actions">
        <button class="secondary" :disabled="chapter===0" @click="selectChapter(chapter-1)">Back</button>
        <button class="secondary" :disabled="chapter===lessons.length-1" @click="selectChapter(chapter+1)">Next</button>
        <button v-if="current.example" class="primary" @click="emit('example',current.example)">Try it in World</button>
        <button v-else class="primary" @click="emit('trends')">Open Trends</button>
        <a class="lesson-source" :href="videoAt(current.timestamp)" target="_blank" rel="noreferrer">Watch this part of the video</a>
      </div>
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
        <p>Repeat the 600-generation video experiment with size standard deviations of 1.00 and 0.50. Both runs start with 50 blobs of size 10 and get 50 plants each day. Compare how size changes and replay the hunts that take place.</p>
        <p><a href="https://www.youtube.com/watch?v=6nMo8T3T0L4&amp;t=459s" target="_blank" rel="noreferrer">Watch the experiment in the video</a></p>
        <form class="about-actions" @submit.prevent="runPair">
          <label>Seed <input v-model.number="pairSeed" type="number" min="1" :max="MAX_SEED" step="1" required :disabled="!!pairProgress"></label>
          <label>Days per run <select v-model.number="pairDays" :disabled="!!pairProgress"><option :value="SIZE_MUTATION_DAYS">{{ SIZE_MUTATION_DAYS }}</option><option :value="100">100</option></select></label>
          <button class="primary" :disabled="!!pairProgress">Run both and compare</button>
          <button v-if="pairProgress && !pairProgress.saving" type="button" class="secondary" @click="pairController?.abort()">Cancel</button>
        </form>
        <div v-if="pairProgress" class="pair-progress">
          <progress :value="pairProgress.side*pairDays+pairProgress.day" :max="2*pairDays" aria-label="Paired experiment progress"></progress>
          <span role="status">{{ pairProgress.saving ? 'Saving both runs…' : 'Simulating '+(pairProgress.side===0?'wide':'narrow')+' size mutation · '+pairProgress.day+' / '+pairDays }}</span>
        </div>
        <p v-if="pairMessage" class="quiet" role="status">{{ pairMessage }}</p>
      </article>
      <div class="experiments">
      <article v-for="item in experiments" :key="item.title"><h3>{{ item.title }}</h3><p>{{ item.detail }}</p><button class="secondary" @click="lab.openSettings(setupFor(item))">Load setup</button></article>
    </div></section>
  </main>
</template>
