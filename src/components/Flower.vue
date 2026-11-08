<script setup>
import { computed, ref, watch } from 'vue'
import { METRICS, format } from '../engine/stats.js'

const props = defineProps({
  values: Object, bounds: Object, rotation: Number, six: Boolean, individual: Boolean, interactive: Boolean
})
const active = ref(null)
const keys = computed(() => props.six ? ['age','deathAge','speed','size','sense'] : ['age','speed','size','sense'])
const step = computed(() => 360 / keys.value.length)
const angle = computed(() => -(props.rotation ?? 0) * step.value)
const point = (r, degrees) => {
  const a = degrees * Math.PI / 180
  return [50+r*Math.cos(a), 50+r*Math.sin(a)]
}
const sector = (r, center, half) => {
  const a = point(r,center-half), b = point(r,center+half)
  return `M50 50 L${a.join(' ')} A${r} ${r} 0 0 1 ${b.join(' ')} Z`
}
const wedges = computed(() => keys.value.map((key,index) => {
  const metric = METRICS.find(metric => metric.key === key)
  const value = props.values?.[key]
  const { min = 0, max = 1 } = props.bounds?.[key] ?? {}
  const norm = !Number.isFinite(value) || max <= min ? .5 : Math.max(0,Math.min(1,(value-min)/(max-min)))
  const center = -90 + index*step.value
  const half = props.six ? 13.75 : 17.2
  const r = 11.4 + norm*(props.individual ? 21 : 34.1)
  const [x,y] = point(props.individual ? 39 : 28,center+angle.value)
  return { key, value, x, y, color:metric.petal, ink:metric.heading ?? metric.petal,
    petal:sector(r,center,half), outline:sector(45.5,center,half), area:sector(45.5,center,step.value/2) }
}))
const pop = computed(() => props.values?.population ? Math.min(11.4,4+7.4*Math.sqrt(props.values.population/(props.bounds?.population?.max || props.values.population))) : 0)
const reading = computed(() => active.value === 'population'
  ? { value:props.values?.population, key:'population', ink:'#EEEDD6', x:50, y:50 }
  : wedges.value.find(w => w.key === active.value))
watch(() => props.interactive, value => { if (!value) active.value = null })
</script>
<template>
  <svg viewBox="0 0 100 100" class="flower" :class="{ 'flower-interactive':interactive }" aria-hidden="true"
    @pointerleave="active=null">
    <circle cx="50" cy="50" r="45.5" fill="#121212" stroke="#2B2B2B" stroke-width=".6"/>
    <g class="flower-wheel" :style="{ transform:'rotate('+angle+'deg)' }">
      <g v-for="w in wedges" :key="w.key" class="flower-sector" :class="{ 'sector-muted':active==='population' }">
        <path class="sector-tint" :class="{ 'sector-active':active===w.key }"
          :d="interactive ? w.area : w.outline" :fill="w.color"/>
        <path v-if="w.value != null" :d="w.petal" :fill="w.color"/>
        <path v-else :d="w.outline" fill="none" :stroke="w.color" opacity=".25" stroke-width=".45"/>
        <path v-if="interactive" class="sector-hit" :data-metric="w.key" :d="w.area" fill="transparent"
          @pointerenter="active=w.key" @pointerleave="active=null"/>
      </g>
    </g>
    <template v-if="individual">
      <circle cx="50" cy="50" r="23" fill="none" stroke="#777268" stroke-width=".5" opacity=".55"/>
      <text v-for="w in wedges.filter(w=>w.value!=null)" :key="w.key" :x="w.x" :y="w.y"
        :style="{ fill:w.ink }" text-anchor="middle" dominant-baseline="central" class="flower-reading">
        {{ format(w.value, w.key === 'age' ? 0 : 1) }}
      </text>
    </template>
    <circle v-else cx="50" cy="50" :r="pop || 3.5" :fill="pop ? '#EEEDD6' : '#121212'" :stroke="pop ? '#171717' : '#686459'" stroke-width=".6"/>
    <circle v-if="interactive" class="sector-hit" data-metric="population" cx="50" cy="50" r="12" fill="transparent"
      @pointerenter="active='population'" @pointerleave="active=null"/>
    <g v-if="interactive && reading" class="flower-value">
      <rect :x="reading.x-21" :y="reading.y-7" width="42" height="14" rx="3" fill="#121212" :stroke="reading.ink" stroke-width=".55"/>
      <text :x="reading.x" :y="reading.y" :fill="reading.ink" text-anchor="middle" dominant-baseline="central">
        {{ format(reading.value, reading.key === 'population' ? 0 : 2) }}
      </text>
    </g>
  </svg>
</template>
