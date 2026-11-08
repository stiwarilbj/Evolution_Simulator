<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Chart, LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale,
  Tooltip, Filler } from 'chart.js'
import { Maximize2, Minimize2, Minus } from 'lucide-vue-next'
import { format } from '../engine/stats.js'

Chart.register(LineController,LineElement,PointElement,BarController,BarElement,LinearScale,CategoryScale,Tooltip,Filler)
const props = defineProps({ id:String, title:String, rows:Array, series:Array, unit:String, color:String,
  pin:Number, focus:Boolean, right:Boolean, hideable:Boolean, legend:Boolean, guide:Number, scope:String, annotations:Array })
const emit = defineEmits(['hide','focus','pin','watch','range'])
const canvas = ref(), hovered = ref(null)
let chart, brush, ignoreClick = false
const hidden = ref([])
const keys = computed(() => props.series.filter(s=>s.key!==false))
const active = computed(() => hovered.value ?? props.pin)
const hasSamples = computed(() => props.series.some(series => props.rows.some(row => series.value(row) != null)))
function toggle(label) {
  hidden.value=hidden.value.includes(label) ? hidden.value.filter(x=>x!==label) : [...hidden.value,label]
}
function move(event) {
  if(!props.rows.length) return
  if(event.key==='Enter' && active.value) { event.preventDefault(); emit('watch',active.value); return }
  if(event.key===' ' && active.value) { event.preventDefault(); emit('pin',active.value); return }
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
  event.preventDefault()
  const index=Math.max(0,props.rows.findIndex(r=>r.day===active.value))
  const next=event.key==='Home'?0:event.key==='End'?props.rows.length-1:Math.min(props.rows.length-1,Math.max(0,index+(event.key==='ArrowRight'?1:-1)))
  const day=props.rows[next].day
  hovered.value=day
  emit('pin',day)
}
function indexAt(event) {
  const x=event.clientX-canvas.value.getBoundingClientRect().left
  return Math.max(0,Math.min(props.rows.length-1,chart.scales.x.getValueForPixel(x)))
}
function startBrush(event) {
  if (!event.shiftKey || !props.rows.length || event.button!==0) return
  const index=indexAt(event)
  brush={ start:index, end:index }
  canvas.value.setPointerCapture(event.pointerId)
}
function moveBrush(event) {
  if (!brush) return
  brush.end=indexAt(event)
  chart.draw()
}
function endBrush() {
  if (!brush) return
  const { start,end }=brush
  brush=null
  chart.draw()
  if (start===end) return
  ignoreClick=true
  setTimeout(()=>{ignoreClick=false},80)
  emit('range',props.rows[Math.min(start,end)].day,props.rows[Math.max(start,end)].day)
}
const marker = {
  id:'day-marker',
  beforeDatasetsDraw(instance) {
    const index=props.rows.findIndex(r=>r.day===active.value)
    const area=instance.chartArea
    if (!area) return
    const dayX=i=>instance.scales.x.getPixelForValue(i)
    const ctx=instance.ctx
    ctx.save()
    if (brush) {
      ctx.fillStyle='#71D2C044'
      ctx.fillRect(dayX(Math.min(brush.start,brush.end)),area.top,
        Math.abs(dayX(brush.end)-dayX(brush.start)),area.bottom-area.top)
    }
    function mark(x, ink, dash=[]) {
      ctx.strokeStyle=ink
      ctx.lineWidth=1
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.moveTo(x,area.top)
      ctx.lineTo(x,area.bottom)
      ctx.stroke()
    }
    for (const annotation of props.annotations ?? []) {
      const i=props.rows.findIndex(row=>row.day===annotation.day)
      if(i>=0) mark(dayX(i),annotation.color,[3,4])
    }
    if(index>=0) mark(dayX(index),props.pin===active.value?'#BDBAB0':'#777268')
    ctx.restore()
  },
  afterDatasetsDraw(instance) {
    if(props.guide==null) return
    const area=instance.chartArea, y=instance.scales.y.getPixelForValue(props.guide)
    if (!area || y<area.top || y>area.bottom) return
    const ctx=instance.ctx
    ctx.save()
    ctx.strokeStyle='#99958a'
    ctx.fillStyle='#BDBAB0'
    ctx.setLineDash([4,4])
    ctx.beginPath()
    ctx.moveTo(area.left,y)
    ctx.lineTo(area.right,y)
    ctx.stroke()
    ctx.fillText('Size 100',area.left+5,y-5)
    ctx.restore()
  }
}
const axis = { color:'#BDBAB0',font:{family:'Source Sans',size:12},maxTicksLimit:6 }
function update() {
  if(!chart) return
  chart.data.labels=props.rows.map(r=>r.day)
  chart.data.datasets=props.series.map(s=>({
    type:s.bar?'bar':'line', label:s.label, data:props.rows.map(s.value), borderColor:s.color,
    backgroundColor:s.fill ?? s.color, borderDash:s.dash ?? [], borderWidth:s.width ?? (s.bar ? 0 : 2.2),
    pointRadius:s.bar || s.width && s.width<2 ? 0 : props.rows.length<=25 ? 1.8 : 0,
    pointHoverRadius:s.bar?0:3.8, spanGaps:false, hidden:hidden.value.includes(s.label), tension:0,
    yAxisID:s.axis ?? 'y', fill:s.area ?? false, categoryPercentage:.8, barPercentage:.84,
    grouped:!s.bar, order:s.bar?2:s.width && s.width<2?1:0
  }))
  chart.options.scales.y.beginAtZero=props.series.some(s=>s.bar || s.zero)
  chart.options.scales.y1.display=!!props.right
  chart.update('none')
}
function create() {
  chart=new Chart(canvas.value,{
    type:'line', plugins:[marker],data:{labels:[],datasets:[]},
    options:{
      responsive:true,maintainAspectRatio:false,animation:false, interaction:{ mode:'index', intersect:false },
      onHover(_,elements) {
        hovered.value=elements.length ? props.rows[elements[0].index]?.day : null
        chart.draw()
      },
      onClick(event,elements) {
        if(ignoreClick) return
        const day=props.rows[elements[0]?.index]?.day
        if(day==null) return
        if(event.native?.sourceCapabilities?.firesTouchEvents || matchMedia('(pointer:coarse)').matches || event.native?.shiftKey) emit('pin',day)
        else emit('watch',day)
      },
      layout:{padding:{left:8,right:12,top:6}},
      plugins:{tooltip:{
        enabled:true, backgroundColor:'#111110',titleColor:'#FFFDFC',bodyColor:'#BDBAB0',
        padding:11, borderColor:'#56534A', borderWidth:1, cornerRadius:4,
        titleFont:{family:'Lab Mono',size:15},bodyFont:{family:'Lab Mono',size:12},
        xAlign:'right', displayColors:true,
        callbacks:{
          title:items=>'Day '+items[0]?.label,
          afterTitle:()=>props.scope ?? '',
          label(item) {
            const s=props.series[item.datasetIndex]
            let value=item.raw
            if(s.bar && value<0) value=-value
            return s.label+'  '+format(value,s.integer?0:2)
          }
        }
      }},
      scales:{
        x:{ ticks:{...axis,minRotation:0,maxRotation:0},grid:{display:false},border:{color:'#56534A'} },
        y:{ ticks:axis,grid:{color:ctx=>ctx.tick.value===0?'#545147':'#33332F'},border:{color:'#45433F'},grace:'7%' },
        y1:{ position:'right', display:false, beginAtZero:true, ticks:{...axis,color:'#EEEDD6'},grid:{drawOnChartArea:false},border:{color:'#45433F'} }
      }
    }
  })
  update()
}
onMounted(create)
onBeforeUnmount(()=>chart?.destroy())
watch(()=>[props.rows,props.series,props.right,props.guide,hidden.value],update)
watch(()=>[props.pin,props.annotations],()=>chart?.draw())
function image() {
  const a=document.createElement('a')
  a.download=props.title.toLowerCase().replaceAll(' ','-')+'.png'
  a.href=chart.toBase64Image()
  a.click()
}
</script>
<template>
  <article class="trend-plot" :class="{ 'focused-plot':focus }" :style="{'--plot':color || '#EEEDD6'}"
    :aria-label="title+' chart'" :id="focus ? undefined : 'chart-'+title.toLowerCase().replaceAll(' ','-')">
    <header class="plot-heading">
      <button v-if="hideable && !focus" class="chart-hide" :aria-label="'Hide '+title" @click="emit('hide')"><Minus :size="13"/></button>
      <h2>{{ title }}</h2>
      <button class="icon plot-focus" :aria-label="focus ? 'Close focus chart' : 'Focus '+title" @click="emit('focus')">
        <Minimize2 v-if="focus" :size="16"/><Maximize2 v-else :size="16"/>
      </button>
    </header>
    <div class="chart-unit">{{ unit }}</div>
    <div class="chart-canvas" @mouseleave="hovered=null; chart?.draw()">
      <canvas ref="canvas" tabindex="0" role="img" :aria-label="title+' by generation. Arrow keys select a day. Enter watches it and Space pins it.'"
        @keydown="move" @pointerdown="startBrush" @pointermove="moveBrush" @pointerup="endBrush" @pointercancel="brush=null;chart?.draw()"></canvas>
      <span v-if="!hasSamples" class="chart-empty">{{ rows.length ? 'No samples in this range' : 'No completed days in this range' }}</span>
    </div>
    <div v-if="legend" class="chart-keys">
      <button v-for="s in keys" :key="s.label" :aria-pressed="!hidden.includes(s.label)" @click="toggle(s.label)">
        <i :style="{borderColor:s.color,borderTopStyle:s.dash?'dashed':'solid'}"></i>{{ s.label }}
      </button>
    </div>
    <div v-if="focus" class="focused-actions">
      <button class="secondary" :disabled="!active" @click="emit('pin',active)">Pin day</button>
      <button class="secondary" @click="image">Download chart PNG</button>
    </div>
  </article>
</template>
