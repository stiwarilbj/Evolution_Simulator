<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { BatteryMedium, CircleX, Copy, Dices, Leaf, Plus, Check, Trash2 } from 'lucide-vue-next'
import { useLab } from '../store.js'
import { PALETTE, TRAITS, randomSeed, speciesTemplate, validate } from '../engine/config.js'
import { travel, cost } from '../engine/geometry.js'
import NumberField from './NumberField.vue'

const lab = useLab()
const draft = lab.draft
const fork = lab.branchFrom
const dialog = ref(), tab = ref(draft.species[0].id), issue = ref({}), savedSpecies = ref(null)
const copied = ref(false), advanced = ref(false), rewards = ref(false), discarding = ref(false), applying = ref(false)
const selected = computed(() => draft.species.find(s => s.id===tab.value) ?? draft.species[0])
const seconds = computed({ get:()=>draft.duration==='' ? '' : draft.duration/10,
  set:value=>{ draft.duration=value==='' ? '' : Math.round(value*10) } })
const total = computed(() => draft.species.filter(s=>s.enabled).reduce((sum,s)=>sum+(Number(s.count)||0),0))
const endurance = computed(() => selected.value.energy/cost(selected.value,draft))
const swatches = { speed:'#9A5A57',size:'#44877C',sense:'#468298' }
const labels = { speed:'Speed',size:'Size',sense:'Sense Range' }
const updated = computed(() => JSON.stringify(draft)!==JSON.stringify(lab.run.setup))
const titleErrors = computed(() => Object.entries(issue.value).map(([key,message])=>({key,message})))
function add(copy=false) {
  const id = crypto.randomUUID()
  const original = selected.value
  const color = PALETTE.find(c=>!draft.species.some(s=>s.color.toLowerCase()===c.toLowerCase())) ??
    '#'+((draft.species.length*2654435761)>>>8).toString(16).padStart(6,'0')
  const stem = copy ? original.name.slice(0,23)+' copy' : 'Species'
  let name = copy ? stem : 'Species '+(draft.species.length+1)
  let i = 2
  while (draft.species.some(s=>s.name.toLowerCase()===name.toLowerCase())) name=stem+' '+i++
  draft.species.push(copy ? { ...JSON.parse(JSON.stringify(original)),id,name,color } : speciesTemplate(id,name,color))
  tab.value=id
}
function remove() {
  if (draft.species.length<2) return
  const index=draft.species.findIndex(s=>s.id===tab.value)
  const [value]=draft.species.splice(index,1)
  savedSpecies.value={value,index}
  tab.value=draft.species[Math.max(0,index-1)].id
}
function undo() {
  const { value,index } = savedSpecies.value
  draft.species.splice(index,0,value)
  tab.value=value.id
  savedSpecies.value=null
}
function reorder(delta) {
  const index=draft.species.findIndex(s=>s.id===tab.value)
  const to=index+delta
  if(to<0 || to>=draft.species.length) return
  const [species]=draft.species.splice(index,1)
  draft.species.splice(to,0,species)
}
function addAnchor() {
  let day=Math.max(1,...draft.schedule.map(p=>p.day))+1
  if(day>draft.days) day=Array.from({length:Math.max(0,draft.days-1)},(_,i)=>i+2).find(day=>!draft.schedule.some(p=>p.day===day))
  if(day) draft.schedule.push({day,food:draft.food})
}
async function copySeed() {
  try { await navigator.clipboard.writeText(String(draft.seed)); copied.value=true; setTimeout(()=>{ copied.value=false },1200) }
  catch { issue.value={ ...issue.value, clipboard:'Clipboard unavailable. Select the seed to copy it.' } }
}
function discard() {
  Object.assign(draft,JSON.parse(JSON.stringify(lab.run.setup)))
  tab.value=draft.species[0].id
  issue.value={}
  discarding.value=false
}
async function apply() {
  const errors=validate(draft)
  let setup=draft
  if(draft.scheduleMode==='constant' && errors.schedule) {
    setup={ ...draft, schedule:[] }
    delete errors.schedule
  }
  issue.value=errors
  if(fork != null && draft.days<=fork) issue.value.days='The run must continue beyond Day '+fork+'.'
  const first=Object.keys(issue.value)[0]
  if(first) {
    const forSpecies=draft.species.find(s=>first.startsWith(s.id+'.'))
    if(forSpecies) tab.value=forSpecies.id
    await nextTick()
    ;(document.getElementById(first) ?? dialog.value.querySelector('.settings-errors'))?.focus()
    return
  }
  applying.value=true
  try { issue.value=await lab.evolve(setup) }
  finally { applying.value=false }
}
function useProfile(profile) {
  for(const trait of TRAITS) selected.value.mutation[trait]=profile==='all' || profile==='speed' && trait==='speed'
}
onMounted(()=>dialog.value.showModal())
</script>
<template>
  <dialog ref="dialog" class="settings-sheet" aria-labelledby="settings-title" @cancel.prevent="lab.closeSettings">
    <button class="icon settings-close" aria-label="Close settings" @click="lab.closeSettings"><CircleX :size="26"/></button>
    <form class="settings-form" novalidate @submit.prevent="apply">
      <header class="settings-intro">
        <h1 id="settings-title">{{ fork==null ? 'Simulation Settings' : 'Branch Settings' }}</h1>
        <p v-if="fork==null">Choose the starting traits, then watch what survives.</p>
        <p v-else>Keep Days 1–{{ fork }}. Apply these rules from Day {{ fork+1 }}.</p>
      </header>
      <section class="setting-section">
        <h2>Blob Creatures</h2>
        <div class="species-tabs" aria-label="Edit species">
          <button v-for="s in draft.species" :key="s.id" type="button" class="secondary species-tab"
            :aria-pressed="selected.id===s.id" :style="{'--species':s.color}" @click="tab=s.id">
            <i></i>{{ s.name }}<small v-if="!s.enabled">Off</small>
          </button>
          <button v-if="fork==null" class="secondary" type="button" @click="add()"><Plus :size="15"/> Add species</button>
        </div>
        <div v-if="fork==null" class="species-editor">
          <label>Name <input :id="selected.id+'.name'" v-model="selected.name" maxlength="30"></label>
          <label>Color <input :id="selected.id+'.color'" v-model="selected.color" type="color"></label>
          <label><input v-model="selected.enabled" type="checkbox"> Enabled</label>
          <details class="species-actions"><summary>Species actions</summary>
            <button type="button" @click="add(true)">Duplicate</button><button type="button" @click="reorder(-1)">Move left</button>
            <button type="button" @click="reorder(1)">Move right</button><button type="button" :disabled="draft.species.length<2" @click="remove">Remove</button>
          </details>
        </div>
        <div v-if="savedSpecies" class="center quiet">Species removed from draft. <button type="button" class="link" @click="undo">Undo</button></div>
        <div v-if="fork==null" class="form-seam">
          <div class="seam-copy"><p>How many creatures start?</p><div class="founder-preview"><span class="preview-shadow"></span><span class="preview-blob" :style="{backgroundColor:selected.color}"></span></div>
            <small>Founder preview · {{ selected.name }}</small></div>
          <div class="form-stack">
            <NumberField :id="selected.id+'.count'" v-model="selected.count" label="Founders" :min="10" :max="1000" compact :error="issue[selected.id+'.count']"/>
            <div class="number-group">
              <NumberField v-for="key in TRAITS" :id="selected.id+'.'+key" :key="key" v-model="selected[key]" :label="labels[key]"
                :min="1" :max="100" :tint="swatches[key]" :error="issue[selected.id+'.'+key]"/>
            </div>
            <small class="quiet">{{ travel(selected,draft).toFixed(0) }} units/s · {{ Number.isFinite(endurance) ? endurance.toFixed(1) : '—' }} s of movement before refills</small>
          </div>
        </div>
      </section>
      <section class="setting-section">
        <h2>When they reproduce</h2>
        <div class="form-seam">
          <div class="seam-copy"><p>Newborn traits are sampled from a Gaussian centered on the parent’s trait.</p><small>Each trait has independent variance σ². Inherited traits have a minimum of 1.</small></div>
          <div class="form-stack">
            <div v-for="key in TRAITS" :key="key" class="variance-row">
              <NumberField :id="selected.id+'.variance.'+key" v-model="selected.variance[key]" :label="'σ² '+labels[key]"
                :min=".01" :max="10" :step=".01" :pace="1" :tint="swatches[key]" :disabled="!selected.mutation[key]" :error="issue[selected.id+'.variance.'+key]"/>
              <div class="variance-meta"><small>σ = {{ Math.sqrt(selected.variance[key]).toFixed(2) }} trait points</small><label><input type="checkbox" v-model="selected.mutation[key]"> Allow {{ key }} mutation</label></div>
            </div>
          </div>
        </div>
      </section>
      <section class="setting-section">
        <h2>Each generation</h2>
        <div class="daily-cards">
          <div class="daily-card energy-card"><h3><BatteryMedium :size="16"/> Energy</h3><p>{{ selected.name }} starts with this much energy</p>
            <NumberField :id="selected.id+'.energy'" v-model="selected.energy" label="Energy" :min="10" :max="1000" :pace="100" tint="#8F8048" compact :disabled="fork!=null" :error="issue[selected.id+'.energy']"/>
            <button class="link gold" type="button" :aria-expanded="rewards" @click="rewards=!rewards">Refill rewards {{ rewards ? '▴' : '▾' }}</button>
          </div>
          <div class="daily-card food-card"><h3><Leaf :size="16"/> Food</h3><p>Randomly place this many plants</p>
            <NumberField id="food" v-model="draft.food" label="Food" :min="10" :max="1000" tint="#6C7C3A" compact :error="issue.food"/>
            <label class="olive-label">Food schedule <select v-model="draft.scheduleMode" @change="delete issue.schedule"><option value="constant">Constant</option><option value="ramp">Ramp</option><option value="step">Step</option></select></label>
          </div>
        </div>
        <p class="quiet center">Food and energy reset at dawn.</p>
        <p v-if="draft.scheduleMode==='constant' && draft.schedule.length" class="quiet center">Constant runs use the daily food count. If the schedule has invalid points, starting the run clears the schedule.</p>
        <div v-if="rewards" class="setting-inset">
          <NumberField id="plantReward" v-model="draft.plantReward" label="Plant reward" :min="0" :max="1000" :pace="100" tint="#6C7C3A" :error="issue.plantReward"/>
          <NumberField id="preyReward" v-model="draft.preyReward" label="Prey reward" :min="0" :max="1000" :pace="100" tint="#8F8048" :error="issue.preyReward"/>
          <p class="quiet">Each successful bite gives one food credit.</p>
          <button type="button" class="secondary" @click="draft.preyReward=draft.plantReward">Equal rewards</button>
        </div>
        <div v-if="draft.scheduleMode!=='constant'" class="setting-inset">
          <strong>Food schedule</strong><p class="quiet">Day 1 follows Starting plants · {{ draft.food }}</p>
          <div class="schedule-row" v-for="(point,i) in draft.schedule" :key="i">
            <label>Day <input v-model.number="point.day" type="number" min="2" :max="draft.days"></label>
            <label>Plants <input v-model.number="point.food" type="number" min="10" max="1000"></label>
            <button type="button" class="icon" aria-label="Remove schedule point" @click="draft.schedule.splice(i,1)"><Trash2 :size="17"/></button>
          </div>
          <p v-if="issue.schedule" class="issue">{{ issue.schedule }}</p>
          <button type="button" class="secondary" @click="addAnchor">Add point</button>
          <button v-if="draft.schedule.length" type="button" class="link" @click="draft.schedule=[]">Clear</button>
        </div>
      </section>
      <section class="setting-section">
        <h2>Finally</h2>
        <div class="setting-inset final-fields">
          <label class="run-name">Run name <input id="name" v-model="draft.name" maxlength="60"></label>
          <NumberField id="days" v-model="draft.days" label="Days to run" :min="10" :max="1000" :error="issue.days"/>
          <NumberField id="duration" v-model="seconds" label="Seconds per day" :min="1" :max="60" :step=".1" :error="issue.duration"/>
          <div class="quick-picks"><button v-for="n in [1,5,10,20,30,60]" :key="n" type="button" class="secondary" :aria-pressed="seconds===n" @click="seconds=n">{{ n }} s</button></div>
          <small class="quiet">{{ ((draft.days*seconds)/60).toFixed(1) }} min of playback at 1×</small>
          <NumberField id="seed" v-model="draft.seed" label="Random seed" :min="1" :max="100" :disabled="fork!=null" :error="issue.seed"/>
          <div class="seed-actions">
            <button v-if="fork==null" type="button" class="secondary" @click="draft.seed=randomSeed(draft.seed)"><Dices :size="16"/> Roll seed</button>
            <button type="button" class="secondary" @click="copySeed"><component :is="copied ? Check : Copy" :size="16"/>{{ copied ? 'Copied' : 'Copy seed' }}</button>
          </div>
        </div>
        <div class="start-modes">
          <button v-for="[mode,name,body] in [['prepare','Prepare and watch','Build the archive in the background.'],['live','Watch live','Run each tick as you watch.']]" :key="mode" type="button"
            class="secondary" :aria-pressed="draft.mode===mode" @click="draft.mode=mode"><strong>{{ name }}</strong><small>{{ body }}</small></button>
        </div>
        <div class="advanced setting-inset">
          <button type="button" class="secondary" :aria-expanded="advanced" @click="advanced=!advanced">Advanced Rules {{ advanced ? '▴' : '▾' }}</button>
          <div v-if="advanced" class="advanced-grid">
            <label><input v-model="draft.predation" type="checkbox"> Predation</label>
            <label><input v-model="draft.sameSpecies" type="checkbox" :disabled="!draft.predation"> Same-species hunting</label>
            <label>Stride <select v-model="draft.stride"><option value="linked">Size-linked</option><option value="speed">Speed only</option></select></label>
            <label>Energy model <select v-model="draft.metabolism"><option value="product">Product</option><option value="additive">Walkthrough additive</option></select></label>
            <label>Mutation profile <select @change="useProfile($event.target.value)"><option value="">Choose a profile</option><option value="all">All unlocked</option><option value="speed">Speed only</option><option value="locked">All locked</option></select></label>
            <output>{{ draft.metabolism==='product' ? 'size³ × speed² × sense ÷ 20,000' : '0.001 × (size³ × effective speed² + sense)' }}<small>{{ cost(selected,draft).toFixed(1) }} energy/s for {{ selected.name }}</small></output>
          </div>
        </div>
      </section>
      <footer class="settings-footer">
        <div v-if="titleErrors.length" class="settings-errors issue" tabindex="-1" role="alert"><p>Review the setup</p><ul><li v-for="error in titleErrors" :key="error.key">{{ error.message }}</li></ul></div>
        <p>{{ draft.species.filter(s=>s.enabled).length }} enabled species · {{ total }} founders · {{ total ? (draft.food/total).toFixed(2) : '—' }} plants per founder</p>
        <p v-if="updated && fork==null" class="quiet">Draft has changes <button type="button" class="link" @click="discarding=true">Discard changes</button></p>
        <p v-if="discarding">Restore the active setup? <button type="button" class="secondary" @click="discard">Discard draft</button> <button type="button" class="link" @click="discarding=false">Keep editing</button></p>
        <button type="submit" class="primary evolve" :disabled="applying">{{ fork==null ? 'Evolve!' : 'Create branch' }}</button>
        <small class="quiet">by natural selection</small>
      </footer>
    </form>
  </dialog>
</template>
