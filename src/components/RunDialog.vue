<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { CircleX, Download, FastForward, Upload } from 'lucide-vue-next'
import { useLab } from '../store.js'
import { METRICS, format, metricValue } from '../engine/stats.js'
import { starter, randomSeed, rulesFor, validate } from '../engine/config.js'
import { csv, download, setupLink } from '../export.js'

const lab=useLab()
const emit=defineEmits(['compare','watch','world','resume','results'])
const dialog=ref(), mode=ref('additional'), amount=ref(0), target=ref(1), extension=ref(25), branchFood=ref(lab.run.setup.food)
const message=ref(''), search=ref(''), file=ref(), removeId=ref(null), renameId=ref(null), newName=ref('')
const end=ref(lab.completed), start=ref(1), exportScope=ref(lab.scope), exportKind=ref('csv'), branchDay=ref(Math.max(1,Math.min(lab.viewing,lab.latestBranchDay)))
const startProgress=ref(lab.completed), endProgress=ref(lab.completed), resumeLive=ref(false)
const remaining=computed(()=>1000-lab.run.setup.days)
const base=computed(()=>lab.liveFrame?.time>=lab.liveFrame?.duration ? lab.completed : Math.min(lab.completed+1,lab.run.setup.days))
const finish=computed(()=>mode.value==='absolute'?target.value:base.value+amount.value)
const scopeLabel=computed(()=>lab.run.setup.species.find(s=>s.id===lab.scope)?.name ?? 'All species')
const rows=computed(()=>lab.run.summaries.map(s=>s.rows[lab.scope]).filter(Boolean))
const matches=computed(()=>[...lab.library].sort((a,b)=>b.created-a.created).filter(r=>r.setup.name.toLowerCase().includes(search.value.toLowerCase())))
const canSim=computed(()=>Number.isInteger(finish.value)&&finish.value>=1&&finish.value<=lab.run.setup.days&&
  (mode.value==='absolute'||Number.isInteger(amount.value)&&amount.value>=0))
const canExportCsv = computed(() => Number.isInteger(start.value) && Number.isInteger(end.value) &&
  start.value >= 1 && start.value <= end.value && end.value <= lab.completed)
const exportRowCount = computed(() => {
  if (!canExportCsv.value) return 0
  return lab.run.summaries.filter(day => day.day >= start.value && day.day <= end.value)
    .reduce((total, { rows }) => total + (exportScope.value === '*' ? Object.keys(rows).length : Number(!!rows[exportScope.value])), 0)
})
const titles={quick:'Quick Sim','quick-progress':'Simulating generations','quick-done':'Simulation complete',
  'quick-stopped':'Simulation stopped',extend:'More Generations',
  library:'Run Library',download:'Download',table:'Generation statistics',branch:'Branch here'}
watch(()=>lab.modal,key=>{
  message.value=''
  if(key==='quick') {
    resumeLive.value=!lab.replay && lab.playing
    if(!lab.replay) lab.stopPlayback()
    mode.value=lab.targetDay || lab.completed===lab.run.setup.days?'absolute':'additional'
    amount.value=Math.min(25,Math.max(0,lab.run.setup.days-base.value))
    target.value=lab.targetDay ?? Math.min(lab.run.setup.days,base.value+amount.value)
    lab.targetDay=null
  }
  if(key==='quick-progress' && lab.batch) { startProgress.value=lab.batch.start; endProgress.value=lab.batch.target }
  if(key==='extend') extension.value=Math.min(25,remaining.value)
  if(key==='download') {
    start.value = lab.downloadRange?.start ?? 1
    end.value = lab.downloadRange?.end ?? lab.completed
    exportScope.value = lab.scope
    lab.downloadRange = null
  }
},{immediate:true})
function close() {
  if(lab.modal==='quick'&&resumeLive.value&&!lab.replay&&!lab.playing) lab.play()
  lab.modal=null
}
function simulate() {
  if(!canSim.value) return
  if(finish.value<=lab.completed) { const day=finish.value;lab.modal=null;emit('watch',day);return }
  if(lab.simulate(finish.value)) lab.modal='quick-progress'
}
function exportRun() {
  if (exportKind.value === 'setup') setupDownload(lab.run)
  else if (canExportCsv.value) download('evolution-results.csv', 'text/csv;charset=utf-8', csv(lab.run, exportScope.value, start.value, end.value))
  else return
  close()
}
function setupDownload(run) {
  download('evolution-setup.json','application/json',JSON.stringify({setup:run.setup,revisions:run.revisions},null,2))
}
async function share(run) {
  const link=!run.revisions.length && setupLink(run.setup)
  if(!link) { message.value='Use Export setup for branch histories or longer configurations.'; return }
  try { await navigator.clipboard.writeText(link); message.value='Setup link copied. It opens a new experiment draft.' }
  catch { message.value='The clipboard is unavailable. Use Export setup.' }
}
async function importSetup(event) {
  const picked=event.target.files[0]
  if(!picked)return
  try {
    const data=JSON.parse(await picked.text())
    const setup=data.setup ?? data
    const errors=Object.values(validate(setup))
    if(errors.length) { message.value=errors[0]; return }
    if(data.revisions?.length) {
      if(!await lab.importBranch(setup,data.revisions)) message.value='The branch history contains incompatible setup revisions.'
      return
    }
    lab.openSettings(setup)
  } catch { message.value='Choose a valid setup JSON file.' }
}
async function createBranch(edit=false) {
  if(!Number.isInteger(branchDay.value)||branchDay.value<1||branchDay.value>lab.latestBranchDay||
     !Number.isInteger(branchFood.value)||branchFood.value<10||branchFood.value>1000){
    message.value='Choose a completed day before the run limit and a food count from 10 to 1,000.'
    return
  }
  const { setup: current, revisions } = lab.run
  const setup = {
    ...JSON.parse(JSON.stringify(rulesFor(current, revisions, branchDay.value))),
    name: (current.name + ' · branch').slice(0,60),
    days: current.days,
    mode: current.mode,
    food: branchFood.value,
    scheduleMode: 'constant',
    schedule: [],
  }
  if(edit) { lab.openSettings(setup,branchDay.value); return }
  try { if (await lab.branch(branchDay.value,setup)) emit('world') }
  catch(error){message.value=error.message}
}
onMounted(()=>dialog.value.showModal())
</script>
<template>
  <dialog ref="dialog" class="task-dialog" :class="{'wide-dialog':['library','table'].includes(lab.modal)}" @cancel.prevent="close" aria-labelledby="dialog-title">
    <header><h2 id="dialog-title">{{ titles[lab.modal] }}</h2><button class="icon" aria-label="Close dialog" @click="close"><CircleX :size="23"/></button></header>
    <template v-if="lab.modal==='quick'">
      <p>Advance the active run without animation.</p>
      <div class="split-options"><button class="secondary" :aria-pressed="mode==='additional'" @click="mode='additional'">Additional generations</button>
        <button class="secondary" :aria-pressed="mode==='absolute'" @click="mode='absolute'">Complete through day</button></div>
      <dl class="pair-readout"><dt>Watching</dt><dd>Day {{ lab.viewing }}</dd><dt>Computing</dt><dd>{{ lab.completed>=lab.run.setup.days?'Finished':'Day '+base }}</dd><dt>Saved through</dt><dd>Day {{ lab.saved }}</dd></dl>
      <label v-if="mode==='additional'" class="dialog-field">Additional generations <input v-model.number="amount" type="number" min="0" :max="lab.run.setup.days-base"></label>
      <label v-else class="dialog-field">Target day <input v-model.number="target" type="number" min="1" :max="lab.run.setup.days"></label>
      <p v-if="finish>lab.run.setup.days" class="issue">The current limit is Day {{ lab.run.setup.days }}.</p>
      <p v-else-if="canSim" class="destination">{{ finish<=lab.completed?'Day '+finish+' is ready to watch.':finish===base?'Finish Day '+finish:'Finish Day '+base+', then complete Days '+(base+1)+'–'+finish }}</p>
      <footer><button class="secondary" @click="close">Cancel</button>
        <button v-if="finish>lab.run.setup.days" class="primary" @click="lab.modal='extend'">More Generations</button>
        <button v-else class="primary" :disabled="!canSim || finish>lab.completed && !lab.workerReady" @click="simulate"><FastForward v-if="finish>lab.completed" :size="16"/>{{ finish<=lab.completed?'Watch Day '+finish:'Simulate' }}</button>
      </footer>
    </template>
    <template v-else-if="['quick-progress','quick-done','quick-stopped'].includes(lab.modal)">
      <progress :value="Math.max(0,lab.completed-startProgress)" :max="Math.max(1,endProgress-startProgress)" aria-label="Batch progress"></progress>
      <dl class="pair-readout"><dt>Completed in this batch</dt><dd>{{ Math.max(0,lab.completed-startProgress) }} of {{ Math.max(0,endProgress-startProgress) }}</dd>
        <dt v-if="lab.batch">Computing</dt><dd v-if="lab.batch">Day {{ lab.completed+1 }}</dd>
        <dt>Completed through</dt><dd>Day {{ lab.completed }}</dd><dt>Saved through</dt><dd>Day {{ lab.saved }}</dd></dl>
      <p v-if="lab.batch?.stopping" class="quiet">Stopping at the next day boundary.</p>
      <footer><button class="secondary" @click="close">{{ lab.batch?'Hide progress':'Close' }}</button>
        <button v-if="lab.batch" class="primary" :disabled="lab.batch.stopping" @click="lab.stopBatch">Stop after this day</button>
        <template v-else>
          <button v-if="lab.canEnterLive" class="secondary" @click="lab.modal='quick'">New Quick Sim</button>
          <button v-if="lab.completed" class="primary" @click="emit('watch',lab.completed)">Watch last day</button>
        </template>
      </footer>
    </template>
    <template v-else-if="lab.modal==='extend'">
      <p>Add days to the existing run.</p><dl class="pair-readout"><dt>Current limit</dt><dd>Day {{ lab.run.setup.days }}</dd><dt>New limit</dt><dd>Day {{ lab.run.setup.days+(Number(extension)||0) }}</dd></dl>
      <label class="dialog-field">Additional days <input v-model.number="extension" type="number" min="1" :max="remaining"></label>
      <p class="quiet">{{ remaining }} days available before Day 1,000.<template v-if="lab.batch"> Stop or finish the current job before extending.</template></p>
      <footer><button class="secondary" @click="close">Cancel</button><button class="primary" :disabled="!lab.workerReady||!!lab.batch||!Number.isInteger(extension)||extension<1||extension>remaining" @click="lab.extend(lab.run.setup.days+extension)">Extend</button></footer>
    </template>
    <template v-else-if="lab.modal==='download'">
      <div class="split-options"><button class="secondary" :aria-pressed="exportKind==='csv'" @click="exportKind='csv'">CSV results</button>
        <button class="secondary" :aria-pressed="exportKind==='setup'" @click="exportKind='setup'">Setup JSON</button></div>
      <template v-if="exportKind==='csv'">
        <label class="dialog-field">Scope <select v-model="exportScope"><option value="all">All species</option><option value="*">All scopes</option>
          <option v-for="s in lab.run.setup.species.filter(s=>s.enabled)" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
        <label class="dialog-field">From day <input type="number" v-model.number="start" min="1" :max="end"></label>
        <label class="dialog-field">Through day <input type="number" v-model.number="end" :min="start" :max="lab.completed"></label>
        <p class="quiet">{{ exportRowCount }} data rows</p>
        <p v-if="!lab.completed" class="quiet">Complete a day to download results.</p>
        <p v-else-if="!canExportCsv" class="issue">Choose whole days from 1 through {{ lab.completed }} in order.</p>
      </template>
      <p v-else class="quiet">Includes the seed, species, rules, and food schedule.</p>
      <footer><button class="secondary" @click="close">Cancel</button><button class="primary" :disabled="exportKind==='csv'&&!canExportCsv" @click="exportRun"><Download :size="17"/> Download</button></footer>
    </template>
    <template v-else-if="lab.modal==='table'">
      <p class="quiet">{{ scopeLabel }} · Completed generations · Select a day to replay it</p>
      <div class="table-scroll"><table><thead><tr><th>Day</th><th v-for="m in METRICS" :key="m.key">{{ m.short }}</th></tr></thead>
        <tbody><tr v-for="r in rows" :key="r.day"><td><button class="link" @click="lab.modal=null;emit('watch',r.day)">{{ r.day }}</button></td>
          <td v-for="m in METRICS" :key="m.key" :title="String(metricValue(r,m.key) ?? '')">{{ format(metricValue(r,m.key),m.key==='population'?0:2) }}</td></tr></tbody></table></div>
      <p v-if="!rows.length" class="quiet">Complete a generation to populate the table.</p>
      <footer><button class="secondary" @click="lab.openDownload()">Download</button><button class="primary" @click="close">Done</button></footer>
    </template>
    <template v-else-if="lab.modal==='library'">
      <div class="library-tools"><input v-model="search" type="search" placeholder="Search runs" aria-label="Search runs">
        <input ref="file" type="file" accept=".json,application/json" hidden @change="importSetup">
        <button class="secondary" @click="file.click()"><Upload :size="16"/> Import setup</button>
        <button class="primary" @click="lab.openSettings({...starter(),name:'New experiment',seed:randomSeed()})">New experiment</button>
      </div>
      <p v-if="!matches.length" class="quiet">No matching saved runs.</p>
      <div class="library-rows">
        <article v-for="run in matches" :key="run.id">
          <div><strong>{{ run.setup.name }}</strong> <span v-if="run.id===lab.run.id" class="teal">● Active</span>
            <small>Seed {{ run.setup.seed }} · Saved through Day {{ run.summaries.at(-1)?.day ?? 0 }}</small></div>
          <button class="secondary" @click="emit('resume',run)">Resume</button>
          <button v-if="run.id!==lab.run.id" class="secondary" @click="emit('compare',run.id)">Compare</button>
          <details><summary>Actions</summary><div class="library-menu">
            <button @click="emit('results',run)">View results</button>
            <button @click="renameId=run.id;newName=run.setup.name">Rename</button>
            <button @click="lab.openSettings({...run.setup,name:(run.setup.name+' copy').slice(0,60)})">Duplicate</button>
            <button @click="setupDownload(run)">Export setup</button>
            <button @click="share(run)">Copy setup link</button>
            <button v-if="run.id!==lab.run.id" @click="removeId=run.id">Delete</button>
          </div></details>
          <form v-if="renameId===run.id" class="library-confirm" @submit.prevent="lab.rename(run,newName.trim());renameId=null"><label>Name <input v-model="newName" required maxlength="60"></label><button class="primary" :disabled="!newName.trim()">Save</button></form>
          <div v-if="removeId===run.id" class="library-confirm">Delete {{ run.setup.name }}? <button class="secondary" @click="removeId=null">Cancel</button>
            <button class="secondary issue" @click="lab.remove(run.id);removeId=null">Delete run</button></div>
        </article>
      </div>
    </template>
    <template v-else-if="lab.modal==='branch'">
      <p>Keep the committed history of {{ lab.run.setup.name }} and change plant supply from the next day.</p>
      <label class="dialog-field">Branch after day <input type="number" v-model.number="branchDay" min="1" :max="lab.latestBranchDay"></label>
      <label class="dialog-field">Plants per day <input type="number" v-model.number="branchFood" min="10" max="1000"></label>
      <p class="destination">First changed day {{ Number(branchDay)+1 }} · Seed {{ lab.run.setup.seed }}</p>
      <footer><button class="secondary" @click="close">Cancel</button><button class="secondary" @click="createBranch(true)">Edit branch rules</button>
        <button class="primary" @click="createBranch()">Create branch</button></footer>
    </template>
    <p v-if="message" class="issue" role="alert">{{ message }}</p>
  </dialog>
</template>
