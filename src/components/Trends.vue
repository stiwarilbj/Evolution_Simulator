<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Dices, Download, FastForward, Layers, RotateCcw } from 'lucide-vue-next'
import { METRICS, metricValue, format } from '../engine/stats.js'
import { useLab } from '../store.js'
import TrendPlot from './TrendPlot.vue'
import TraitSpace from './TraitSpace.vue'

const emit = defineEmits(['watch','sense','reroll','restart'])
const lab=useLab()
const range=ref('all'), from=ref(1), to=ref(50), pin=ref(null), focused=ref(null)
const focusDialog=ref()
const spread=ref('percentile'), hidden=ref([]), order=ref('classic'), tab=ref('Trends')
const separate=ref(false), opening=ref(false), compareSpecies=ref(false), causes=ref(false), transition=ref(false)
const scopeName=computed(()=>lab.run.setup.species.find(s=>s.id===lab.scope)?.name ?? 'All species')
const species=computed(()=>lab.run.setup.species.filter(s=>s.enabled))
const rows=computed(()=>{
  const source=lab.run.summaries
  const visible=range.value==='all'?source:range.value==='custom' ? source.filter(d=>d.day>=from.value && d.day<=to.value) : source.slice(-Number(range.value))
  return visible.map(d=>({day:d.day,...d.rows[lab.scope],scopes:d.rows}))
})
const pinned=computed(()=>pin.value ? lab.run.summaries[pin.value-1]?.rows[lab.scope] : null)
const annotations=computed(()=>{
  const food=lab.run.setup.scheduleMode==='constant'?[]:lab.run.setup.schedule.map(point=>({day:point.day,color:'#B7D65A',label:point.food+' plants'}))
  const fork=lab.run.forkDay
  return fork ? [{day:fork+1,color:'#83B3CE',label:'Branch'},...food] : food
})
const basic=['population','age','speed','size','sense']
const compactKey=computed(()=>basic.some(key=>key!=='population'&&!hidden.value.includes(key)))
const titles={ population:'Population',age:'Age',speed:'Speed',size:'Size',sense:'Sense Range',deathAge:'Age at Death' }
const m=key=>METRICS.find(metric=>metric.key===key)
const line=(label,color,value,rest={})=>({label,color,value,...rest})
function distribution(key) {
  const metric=m(key), useSD=spread.value==='sd'
  return [
    line('Max',metric.outer+'66',r=>r[key]?.max,{width:1,dash:[2,2]}),
    line(useSD?'Mean + sample SD':'P75',metric.inner+'A6',r=>useSD ? (r[key]?.n?Math.min(r[key].max,r[key].mean+r[key].sd):null):r[key]?.p75,{width:1.5}),
    line('Mean',metric.color,r=>r[key]?.mean,{width:2.5,zero:key==='age'||key==='deathAge'}),
    line(useSD?'Mean − sample SD':'P25',metric.inner+'A6',r=>useSD ? (r[key]?.n?Math.max(r[key].min,r[key].mean-r[key].sd):null):r[key]?.p25,{width:1.5,dash:[4,2]}),
    line('Min',metric.outer+'66',r=>r[key]?.min,{width:1,dash:[2,2]})
  ]
}
const options=computed(()=>{
  const charts={}
  for(const key of [...basic,'deathAge']) charts[key]={
    id:key,title:titles[key],color:m(key).heading ?? m(key).color, unit:key==='age'?'Living blobs at dusk · days':key==='deathAge'?'Deaths during the day · days':m(key).unit,
    guide:key==='size'&&transition.value?100:undefined, hideable:true,legend:key!=='population'||opening.value||compareSpecies.value,
    series:key==='population' ? [
      line('Closing population',m(key).color,r=>r.population,{integer:true,zero:true}),
      ...(opening.value?[line('Opening population','#BDBAB0',r=>r.opening,{integer:true,dash:[4,3],width:1.5})]:[]),
      ...(compareSpecies.value?species.value.map((s,i)=>line(s.name,s.color,r=>r.scopes[s.id]?.population,{integer:true,dash:[i*2+2,3]})):[])
    ]:distribution(key)
  }
  charts.overview={id:'overview',title:'Overview',unit:'Traits · left axis   /   Population · right axis',right:true,legend:true,
    series:METRICS.filter(metric=>!hidden.value.includes(metric.key)).map(metric=>line(metric.short,metric.color,r=>metricValue(r,metric.key),{
      axis:metric.key==='population'?'y1':'y',integer:metric.key==='population',dash:metric.key==='deathAge'?[3,3]:undefined
    }))}
  charts.births={id:'births',title:'Births and Deaths',unit:'Births above zero · deaths below zero',legend:true,
    series:[line('Births','#A1BD67',r=>r.births,{bar:true,integer:true}),line('Deaths','#BD5558',r=>-r.deaths,{bar:true,integer:true}),
      line('Net','#FFFDFC',r=>r.net,{integer:true,area:'origin',fill:'#FFFDFC10'}),
      ...(causes.value?['Starvation','Missed home','Predation','Energy depletion'].map((cause,i)=>
        line(cause,['#F0B29F','#D89482','#EB7B72','#DDA66A'][i],r=>-(r.causes?.[cause]??0),{integer:true,dash:[3+i,3],width:1.3})):[])
    ]}
  charts.food={id:'food',title:'Food',unit:'Resources per day',legend:true,series:[
    line(lab.scope==='all'?'Food available':'Shared plant supply','#BDBAB0',r=>r.food,{dash:[4,3],integer:true,zero:true}),
    line('Food eaten','#B7D65A',r=>r.plants,{integer:true,area:'origin',fill:'#B7D65A12'}),
    line('Creatures eaten','#D38C80',r=>r.hunts,{dash:[6,3,2,3],integer:true})
  ]}
  return charts
})
const sectionOrder=computed(()=>order.value==='overview' ? ['overview','compact','extra'] : ['compact','overview','extra'])
function toggleHidden(key) { hidden.value=hidden.value.includes(key)?hidden.value.filter(k=>k!==key):[...hidden.value,key] }
function jump(event) {
  const chart=options.value[event.target.value]
  if(chart) {
    if(hidden.value.includes(chart.id)) toggleHidden(chart.id)
    requestAnimationFrame(()=>document.getElementById('chart-'+chart.title.toLowerCase().replaceAll(' ','-'))?.scrollIntoView({behavior:'smooth',block:'start'}))
  }
  event.target.value=''
}
function focus(key) { focused.value=focused.value===key?null:key }
function customRange(a,b) { from.value=a; to.value=b; range.value='custom' }
watch(focused, async key=>{
  if(!key) { focusDialog.value?.close(); return }
  await nextTick()
  if(focused.value && !focusDialog.value?.open) focusDialog.value?.showModal()
})
</script>
<template>
  <main class="trends">
    <div class="trends-toolbar">
      <div class="trend-filters">
        <label>Filter By Species <select v-model="lab.scope"><option value="all">All species</option><option v-for="s in species" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
        <label>Range <select v-model="range"><option value="all">Full run</option><option value="25">Last 25</option><option value="100">Last 100</option><option value="custom">Custom</option></select></label>
        <select v-if="tab==='Trends'" aria-label="Jump to chart" @change="jump"><option value="">Jump to chart</option><option v-for="plot in options" :key="plot.id" :value="plot.id">{{ plot.title }}</option></select>
      </div>
      <div class="trend-actions">
        <button class="secondary" @click="lab.modal='download'"><Download :size="17"/> Download</button>
        <button class="icon" title="Run again" aria-label="Run again" @click="emit('restart')"><RotateCcw :size="17"/></button>
        <button class="icon" title="Reroll seed" aria-label="Reroll seed" @click="emit('reroll')"><Dices :size="17"/></button>
        <button class="icon" title="More Generations" aria-label="More Generations" @click="lab.modal='extend'"><Layers :size="17"/></button>
        <button class="secondary" @click="lab.modal=lab.batch?'quick-progress':'quick'"><FastForward :size="17"/> {{ lab.batch?'Progress':'Quick Sim' }}</button>
      </div>
    </div>
    <div v-if="range==='custom'" class="range-fields"><label>From day <input v-model.number="from" type="number" min="1" :max="lab.completed || 1"></label>
      <label>To day <input v-model.number="to" type="number" :min="from" :max="lab.completed || 1"></label><button class="link" @click="range='all'">Reset range</button>
    </div>
    <div class="trend-subhead">
      <span>{{ lab.run.setup.name }} · Seed {{ lab.run.setup.seed }} · Through Day {{ lab.completed }}<span v-if="lab.batch" class="teal"> · Simulating</span></span>
      <div class="trend-tabs"><button v-for="name in ['Trends','Trait Space']" :key="name" class="secondary" :aria-pressed="tab===name" @click="tab=name">{{ name }}</button></div>
    </div>
    <TraitSpace v-if="tab==='Trait Space'" :scope="lab.scope" @watch="(day,id)=>emit('watch',day,id)"/>
    <template v-else>
      <div class="trend-options">
        <label>Spread <select v-model="spread"><option value="percentile">Percentiles</option><option value="sd">Walkthrough spread</option></select></label>
        <label>Order <select v-model="order"><option value="classic">Walkthrough order</option><option value="overview">Overview first</option></select></label>
        <details><summary>Chart options</summary>
          <label><input type="checkbox" v-model="opening"> Opening population</label>
          <label><input type="checkbox" v-model="compareSpecies"> Compare species populations</label>
          <label><input type="checkbox" v-model="causes"> Show death causes</label>
          <label><input type="checkbox" v-model="transition"> Size 100 threshold</label>
        </details>
      </div>
      <p v-if="annotations.length" class="trend-annotations quiet">
        <span v-for="a in annotations" :key="a.day+a.label" :style="{color:a.color}">┊ Day {{ a.day }} · {{ a.label }}</span>
      </p>
      <div v-if="hidden.length" class="restore-plots"><button v-for="key in hidden" :key="key" class="secondary" @click="toggleHidden(key)">+ {{ titles[key] }}</button>
        <button class="link" @click="hidden=[]">Restore all</button></div>
      <div v-if="!rows.length" class="notice" role="status">{{ lab.completed?'Choose a different range.':'Complete Day 1 to see trends.' }}
        <button v-if="!lab.completed" class="secondary" @click="emit('watch',1)">Watch World</button></div>
      <div v-if="pinned" class="pinned-summary">
        <div><strong>Day {{ pin }} · Pinned</strong><small>{{ scopeName }} · {{ pinned.population }} living blobs · {{ pinned.births }} births · {{ pinned.deaths }} deaths</small></div>
        <button class="secondary" @click="lab.modal='table'">View table</button><button class="secondary" @click="emit('sense',pin)">Show sense circles</button>
        <button class="primary" @click="emit('watch',pin)">Watch day</button><button class="icon" aria-label="Clear pinned day" @click="pin=null">×</button>
      </div>
      <template v-for="section in sectionOrder" :key="section">
        <div v-if="section==='compact'" class="compact-plots walkthrough-plots">
          <aside v-if="compactKey" class="plot-guide" aria-label="Trait chart line key">
            <h2>Reading the traits</h2>
            <dl>
              <div><dt><i class="trace-mean"></i>Mean</dt><dd>Average of the day’s sample</dd></div>
              <div><dt><i class="trace-upper"></i>{{ spread==='sd' ? 'Mean + sample SD' : '75th percentile' }}</dt></div>
              <div><dt><i class="trace-lower"></i>{{ spread==='sd' ? 'Mean − sample SD' : '25th percentile' }}</dt></div>
              <div><dt><i class="trace-edge"></i>Min / max</dt><dd>Lowest and highest observed</dd></div>
            </dl>
            <p>Focus a chart to show or hide individual lines.</p>
          </aside>
          <TrendPlot v-for="key in basic.filter(key=>!hidden.includes(key))" :key="key" v-bind="options[key]"
            :legend="key==='population' && options[key].legend" :rows="rows" :pin="pin" :scope="scopeName" :annotations="annotations"
            @hide="toggleHidden(key)" @focus="focus(key)" @pin="pin=$event" @watch="emit('watch',$event)" @range="customRange"/>
        </div>
        <section v-else-if="section==='overview'" class="overview">
          <button class="secondary overview-mode" :aria-pressed="separate" @click="separate=!separate">{{ separate?'Combined scales':'Separate scales' }}</button>
          <div v-if="separate" class="compact-plots">
            <TrendPlot v-for="key in [...basic,'deathAge'].filter(key=>!hidden.includes(key))" :key="key" v-bind="{...options[key],series:options[key].series.filter(s=>s.label==='Mean'||s.label==='Closing population'),hideable:false}"
              :rows="rows" :pin="pin" :scope="scopeName" :annotations="annotations" @focus="focus(key)" @pin="pin=$event" @watch="emit('watch',$event)" @range="customRange"/>
          </div>
          <TrendPlot v-else v-bind="options.overview" :rows="rows" :pin="pin" :scope="scopeName" :annotations="annotations" @focus="focus('overview')" @pin="pin=$event" @watch="emit('watch',$event)" @range="customRange"/>
        </section>
        <div v-else class="secondary-plots">
          <TrendPlot v-for="key in ['births','food','deathAge'].filter(key=>!hidden.includes(key))" :key="key" v-bind="options[key]" :rows="rows" :pin="pin"
            :scope="scopeName" :annotations="annotations" @hide="toggleHidden(key)" @focus="focus(key)" @pin="pin=$event" @watch="emit('watch',$event)" @range="customRange"/>
        </div>
      </template>
    </template>
    <Teleport to="body">
      <dialog ref="focusDialog" class="focus-dialog" aria-label="Focused chart" @cancel.prevent="focused=null">
        <TrendPlot v-if="focused" v-bind="options[focused]" :rows="rows" :pin="pin" :scope="scopeName" :annotations="annotations" focus
          @focus="focused=null" @pin="pin=$event" @watch="focused=null; emit('watch',$event)" @range="customRange"/>
      </dialog>
    </Teleport>
  </main>
</template>
