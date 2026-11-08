<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { Minus, Plus } from 'lucide-vue-next'
const value = defineModel()
const props = defineProps({ label:String, min:Number, max:Number, step:{type:Number,default:1}, tint:String,
  compact:Boolean, error:String, disabled:Boolean, id:String, pace:Number })
const offset = ref(0)
const editing = ref(false), entered = ref('')
let timer, residual = 0, since = 0, holding = false
const decimals = computed(() => props.step.toString().split('.')[1]?.length ?? 0)
const text = computed(() => {
  if (editing.value) return entered.value
  if (!Number.isFinite(value.value)) return ''
  const rounded = value.value.toFixed(decimals.value)
  return Number(rounded) === value.value ? rounded : String(value.value)
})
function change(n) {
  const base = Number.isFinite(value.value) ? value.value : props.min
  value.value = Number(Math.min(props.max,Math.max(props.min,base+n*props.step)).toFixed(decimals.value))
}
function direction(event) {
  if (!holding) return
  const box = event.currentTarget.getBoundingClientRect()
  const next = Math.round(Math.max(-1,Math.min(1,(event.clientX-box.left-box.width/2)/(box.width/2)))*10)/10
  if (Math.sign(next)!==Math.sign(offset.value)) { residual=0; since=0 }
  offset.value=next
}
function start(event) {
  if (props.disabled || event.button!==0) return
  holding = true
  event.currentTarget.setPointerCapture(event.pointerId)
  direction(event)
  clearInterval(timer)
  timer = setInterval(() => {
    if (!offset.value) return
    since += 50
    residual += (props.pace ?? 10)*offset.value**2/10
    const increment = Math.floor(residual) || (since>=1000 ? 1 : 0)
    if (!increment) return
    change(increment*Math.sign(offset.value))
    residual = Math.max(0,residual-increment)
    since=0
  },50)
}
function stop() { clearInterval(timer); holding=false; offset.value=0; residual=0; since=0 }
function begin(event) { entered.value=event.target.value; editing.value=true }
function read(event) {
  entered.value=event.target.value
  value.value=entered.value==='' ? '' : event.target.valueAsNumber
}
onBeforeUnmount(stop)
</script>
<template>
  <div class="number-field" :class="{ compact, invalid:!!error, unavailable:disabled }" :style="{ '--tint':tint || '#777268' }">
    <div class="number-shell">
      <label :for="id">{{ label }}</label>
      <div class="spring">
        <button type="button" :aria-label="'Decrease '+label" :disabled="disabled || value<=min" @click="change(-1)"><Minus :size="13"/></button>
        <div class="spring-track" aria-hidden="true" @pointerdown="start" @pointermove="direction" @pointerup="stop"
          @lostpointercapture="stop" @pointercancel="stop" @pointerleave="!$event.buttons && stop()">
          <i></i><span :style="{left:(50+offset*45)+'%'}"></span>
        </div>
        <button type="button" :aria-label="'Increase '+label" :disabled="disabled || value>=max" @click="change(1)"><Plus :size="13"/></button>
      </div>
      <input :id="id" :value="text" type="number" :min="min" :max="max" :step="step" :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined" :aria-describedby="error ? id+'-error' : undefined"
        @focus="begin" @blur="editing=false" @input="read" @keydown.esc="stop">
    </div>
    <small v-if="error" :id="id+'-error'" class="issue">{{ error }}</small>
  </div>
</template>
