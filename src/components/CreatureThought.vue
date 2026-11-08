<script setup>
import { ref, watch } from 'vue'
import { ArrowLeft, Crosshair, Ellipsis, House, Leaf, Plus, Wind } from 'lucide-vue-next'
import { STATES } from '../engine/simulation.js'

const props = defineProps({ id:Number, state:Number })
const anchor = ref(), expanded = ref(false)
const icons = [Ellipsis, Leaf, Crosshair, Wind, ArrowLeft, House, Ellipsis, Plus]
const captions = ['Searching the field', 'Heading for a plant', 'Chasing smaller prey', 'Fleeing a predator',
  'Returning to the edge', 'Resting at the edge', 'Dead', 'Newborn']
watch(() => props.id, () => { expanded.value = false })

function place(point) {
  if (!anchor.value) return
  anchor.value.style.visibility = point ? 'visible' : 'hidden'
  if (point) anchor.value.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -100%)`
}
defineExpose({ place })
</script>

<template>
  <div ref="anchor" class="thought-anchor">
    <button class="thought-cloud" type="button" :aria-expanded="expanded"
      :aria-label="'Creature thought · '+(STATES[state] ?? 'Searching')" @click="expanded=!expanded">
      <svg class="thought-outline" viewBox="0 0 56 42" aria-hidden="true">
        <path d="M11 30a7 7 0 0 1-3-13 8 8 0 0 1 8-9 10 10 0 0 1 15-3 9 9 0 0 1 13 5 8 8 0 0 1 5 14 8 8 0 0 1-10 7 11 11 0 0 1-13 2 11 11 0 0 1-15-3Z"/>
        <circle cx="26" cy="37" r="2.2"/><circle cx="24" cy="41" r="1"/>
      </svg>
      <component :is="icons[state] ?? Ellipsis" class="thought-icon" :size="17" :stroke-width="1.8" aria-hidden="true"/>
    </button>
    <span v-if="expanded" class="thought-caption">{{ captions[state] ?? captions[0] }}</span>
  </div>
</template>
