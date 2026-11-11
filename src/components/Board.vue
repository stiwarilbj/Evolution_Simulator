<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { clamp } from '../engine/geometry.js'
import CreatureThought from './CreatureThought.vue'

const props = defineProps({
  frame: Object, species: Array, layers: Object, selected: Number, follow: Boolean, camera: String,
  scope: String, dim: Boolean, quality: String, speedRange: Object
})
const emit = defineEmits(['select', 'fallback'])
const host = ref(null), cloud = ref(null), visionMask = ref(null)
const followedBlob = computed(() => props.follow && props.camera !== 'overhead'
  ? props.frame?.blobs.find(b => b.id === props.selected && b.alive) : null)
const hovered = ref(null)
const stageColor = '#242424'
const scene = new THREE.Scene()
scene.background = new THREE.Color(stageColor)
const camera = new THREE.PerspectiveCamera(45, 1, 1, 4500)
const overhead = new THREE.OrthographicCamera(-350, 350, 350, -350, 1, 4500)
overhead.up.set(0, 0, -1)
overhead.position.set(0, 1000, 0)
overhead.lookAt(0, 0, 0)
const target = new THREE.Vector3(), aim = new THREE.Vector3(), position = new THREE.Vector3()
const originalPosition = new THREE.Vector3(), originalTarget = new THREE.Vector3()
const stamp = new THREE.Object3D(), color = new THREE.Color()
const slow = new THREE.Color('#7E635D'), fast = new THREE.Color('#C92922')
const mutedBody = new THREE.Color('#B7B7B7'), deadBody = new THREE.Color('#B9B9B9')
const energyLow = new THREE.Color('#CCCCCC'), energyFull = new THREE.Color('#FDDE3B')
const cast = new THREE.Raycaster()
const mouse = new THREE.Vector2()
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const radiusGeometry = new THREE.CircleGeometry(1, 32)
const boardSize = 500
const meshKinds = {}
let renderer, canvas, ctx, orbit, resize, raf, down, previousFrame, height = 1, width = 1, dirty = true
let contact, contactTexture
let bodyIds = [], screenBlobs = [], followed = false, manual = false, previousTime = 0
let lastPose, nextPose, poseChangedAt = 0, recentDeaths = new Set(), recentBites = new Map()
const colors = new Map()
const visionRim = Array.from({ length: 48 }, (_, i) =>
  [Math.cos(i * Math.PI / 24), Math.sin(i * Math.PI / 24)])

function standard(fill) {
  return new THREE.MeshLambertMaterial({ color: fill })
}

function makeContactShadow() {
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 64
  const surface = sprite.getContext('2d')
  const wash = surface.createRadialGradient(32,32,3,32,32,32)
  for (const [stop, alpha] of [[0,.31],[.47,.20],[.78,.07],[1,0]]) {
    wash.addColorStop(stop, `rgba(75,86,97,${alpha})`)
  }
  surface.fillStyle = wash
  surface.fillRect(0,0,64,64)
  return sprite
}

function placeBoard() {
  const slab = new THREE.Mesh(new THREE.BoxGeometry(540, 10, 540),
    ['#9C9C9C','#AAAAAA','#CDCDCD','#888888','#A3A3A3','#AAAAAA'].map(fill => new THREE.MeshBasicMaterial({ color:fill })))
  slab.position.y = -6
  scene.add(slab)
  const tabletop = new THREE.Mesh(new THREE.PlaneGeometry(boardSize, boardSize), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
  tabletop.rotation.x = -Math.PI / 2
  tabletop.position.y = -0.7
  scene.add(tabletop)
  const ambient = new THREE.AmbientLight('#ffffff', 1.35)
  const lamp = new THREE.DirectionalLight('#ffffff', 1.65)
  lamp.position.set(-100, 200, -10)
  scene.add(ambient, lamp)
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(484, 0.01, 484)),
    new THREE.LineDashedMaterial({ color: '#6C847C', dashSize: 7, gapSize: 5, transparent: true, opacity: .65 }))
  outline.position.y = 0.05
  outline.computeLineDistances()
  outline.name = 'homes'
  scene.add(outline)
}

function meshes() {
  const profile = [[0,0], [.56,.035], [.87,.12], [1,.37], [.96,.67], [.81,.91], [.64,1.2],
    [.53,1.54], [.54,1.86], [.46,2.1], [.29,2.29], [0,2.38]]
  const curve = new THREE.SplineCurve(profile.map(([r,y]) => new THREE.Vector2(r,y)))
  const shape = new THREE.LatheGeometry(curve.getPoints(32), 20)
  const vertices = shape.attributes.position
  for (let i = 0; i < vertices.count; i++) {
    const y = vertices.getY(i)
    vertices.setX(i, vertices.getX(i) + Math.max(0, y - 0.9) * .23)
  }
  shape.computeVertexNormals()
  const flat = (opacity = 1) => new THREE.MeshBasicMaterial({
    color: '#ffffff', transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: THREE.DoubleSide
  })
  meshKinds.body = [shape, standard('#ffffff')]
  meshKinds.eye = [new THREE.SphereGeometry(1, 7, 5), standard('#ffffff')]
  meshKinds.pellet = [new THREE.SphereGeometry(2, 16, 10), standard('#ffffff')]
  contactTexture = new THREE.CanvasTexture(contact)
  contactTexture.colorSpace = THREE.SRGBColorSpace
  meshKinds.shadow = [radiusGeometry, new THREE.MeshBasicMaterial({
    map:contactTexture, transparent:true, depthWrite:false
  })]
  meshKinds.vision = [radiusGeometry, flat(.77)]
  meshKinds.vision[1].clippingPlanes = [
    new THREE.Plane(new THREE.Vector3(1,0,0),250), new THREE.Plane(new THREE.Vector3(-1,0,0),250),
    new THREE.Plane(new THREE.Vector3(0,0,1),250), new THREE.Plane(new THREE.Vector3(0,0,-1),250)
  ]
  meshKinds.energy = [radiusGeometry, flat(.84)]
  meshKinds.credits = [radiusGeometry, flat()]
  meshKinds.ring = [new THREE.RingGeometry(.86, 1, 32), flat()]
  meshKinds.deadEye = [new THREE.BoxGeometry(1.8, .34, .25), standard('#ffffff')]
}

function buffer(kind, count) {
  const [geometry, material, previous, capacity] = meshKinds[kind]
  if (previous && count <= capacity) {
    previous.count = count
    return previous
  }
  if (previous) {
    scene.remove(previous)
    previous.dispose()
  }
  const allocation = Math.max(4, 2 ** Math.ceil(Math.log2(count || 1)))
  const mesh = new THREE.InstancedMesh(geometry, material, allocation)
  mesh.frustumCulled = false
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  if (kind === 'vision' || kind === 'shadow' || kind === 'energy') mesh.renderOrder = { vision: 1, shadow: 2, energy: 3 }[kind]
  mesh.count = count
  meshKinds[kind] = [geometry, material, mesh, allocation]
  scene.add(mesh)
  return mesh
}

function write(mesh, index, fill, x, y, z, sx, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
  stamp.position.set(x, y, z)
  stamp.rotation.set(rx, ry, rz)
  stamp.scale.set(sx, sy, sz)
  stamp.updateMatrix()
  mesh.setMatrixAt(index, stamp.matrix)
  mesh.setColorAt(index, fill instanceof THREE.Color ? fill : color.set(fill))
}

function frameBlob(b, f, t) {
  const old = lastPose?.get(b.id)
  if (!old || t >= 1 || !b.alive || old.state !== b.state || lastPose.day !== f.day) return b
  const da = b.angle - old.angle
  return { ...b, x: old.x + (b.x - old.x) * t, y: old.y + (b.y - old.y) * t,
    angle: old.angle + Math.atan2(Math.sin(da), Math.cos(da)) * t }
}

function activeBlobs(frame, now) {
  if (frame !== previousFrame) {
    lastPose = nextPose
    const delta = frame.time - (previousFrame?.time ?? 0)
    poseChangedAt = delta > 0 && delta <= .12 ? now - 6 : now - 100
    nextPose = new Map(frame.blobs.map(b => [b.id, b]))
    nextPose.day = frame.day
    recentDeaths = new Set()
    recentBites = new Map()
    for (const e of frame.events) if (e.time<=frame.time && frame.time-e.time<.28) {
      if (e.type==='death') recentDeaths.add(e.id)
      if (e.type==='plant' || e.type==='prey') recentBites.set(e.id,e.time)
    }
    previousFrame = frame
    dirty = true
  }
  const t = clamp((now - poseChangedAt) / 36, 0, 1)
  return frame.blobs.filter(b => b.alive || recentDeaths.has(b.id)).map(b => frameBlob(b, frame, t))
}

function paintColor(b, min, max) {
  if (props.layers?.speed) color.copy(slow).lerp(fast, max === min ? .5 : clamp((b.speed - min) / (max - min), 0, 1))
  else color.set(colors.get(b.species) ?? '#406780')
  if (props.dim && props.scope !== 'all' && b.species !== props.scope) color.lerp(mutedBody, .72)
  if (!b.alive) color.lerp(deadBody, .52)
  return color
}

function inSightCohort(blob) {
  return blob.alive && (props.scope==='all' || blob.species===props.scope)
}

function draw3d(blobs, frame, view, { min, max }) {
  const detailed = blobs.length < 1500
  const chosen = blobs.find(b => b.id === props.selected)
  const indicators = props.layers?.selected || !detailed ? (chosen ? [chosen] : []) : blobs
  const body = buffer('body', blobs.length)
  const eye = buffer('eye', detailed ? blobs.filter(b => b.alive).length * 2 : 0)
  const crosses = buffer('deadEye', blobs.filter(b => !b.alive).length * 2)
  const shadows = buffer('shadow', blobs.length + frame.plants.length)
  const pellets = buffer('pellet', frame.plants.length)
  let sight = props.layers?.sense ? indicators : []
  if (props.layers?.sense && props.layers.cohortSense) {
    sight = (props.layers.selected ? indicators : blobs).filter(inSightCohort)
  }
  const vision = buffer('vision', sight.length)
  const energy = buffer('energy', props.layers?.energy ? indicators.length : 0)
  const credit = buffer('credits', props.layers?.credits ? indicators.reduce((n,b) => n + b.credits, 0) : 0)
  const outlines = [chosen,blobs.find(b=>b.id===hovered.value && b.id!==chosen?.id)].filter(Boolean)
  const ring = buffer('ring', outlines.length)
  let eyes = 0, deaths = 0, pips = 0
  bodyIds = []
  const close = props.follow && chosen?.alive
  for (const [i, b] of blobs.entries()) {
    const x = b.x - 250, z = b.y - 250, r = b.r
    const moving = b.alive && b.state < 5 && frame.time > 0 && frame.time < frame.duration
    const bite = close && b.id===chosen.id && recentBites.has(b.id) ? 1-(frame.time-recentBites.get(b.id))/.28 : 0
    const bob = moving && !reduced.matches ? Math.sin(frame.time * 17 + b.id) * .10 + bite*.15 : 0
    const born = b.state === 7
    const offset = born ? r * 1.9 : 0
    const turn = b.angle, c = Math.cos(turn), s = Math.sin(turn)
    const lift = b.alive ? Math.max(0, bob) * r : r * .5
    const yaw = -turn
    write(body, i, paintColor(b, min, max), x + offset, lift, z, r, r * (1 - bob), r,
      0, yaw, b.alive ? (moving ? -.08 + bob * .4 : 0) : -1.3)
    bodyIds.push(b.id)
    write(shadows, i, '#FFFFFF', x + r * .42 + offset, .045, z + r * .15, r * 1.7, r * 1.12, 1, -Math.PI / 2)
    if (b.alive && detailed) for (const side of [-.30, .30]) {
      const eyeScale = r * (close && b.id === props.selected ? .125 : .103)
      write(eye, eyes++, '#0a0a0a', x + offset + r * (.88 * c - side * s), lift + r * 1.94 * (1 - bob),
        z + r * (.88 * s + side * c), eyeScale)
    } else if (!b.alive) for (const angle of [-.7, .7]) {
      write(crosses, deaths++, '#676767', x + c * r * 1.52, r, z + s * r * 1.52, r * .33, r * .33, r * .33, 0, yaw, angle)
    }
  }
  frame.plants.forEach((p, i) => {
    const x = p.x - 250, z = p.y - 250
    write(pellets, i, '#83A51E', x, 2.2, z, 1)
    write(shadows, blobs.length + i, '#FFFFFF', x + .8, .045, z + .35, 3.2, 2.3, 1, -Math.PI / 2)
  })
  sight.forEach((b,i)=>write(vision, i, '#E4F5FE', b.x - 250, -.48, b.y - 250, b.sense, b.sense, 1, -Math.PI / 2))
  indicators.forEach((b, i) => {
    if (energy.count) {
      color.copy(energyLow).lerp(energyFull, b.energy / b.capacity)
      write(energy, i, color, b.x - 250, .06, b.y - 250, b.r * 1.5, b.r * 1.5, 1, -Math.PI / 2)
    }
    if (credit.count) for (let j = 0; j < b.credits; j++) {
      write(credit, pips++, j < b.preyCredits ? '#D38C80' : '#A1C33F',
        b.x - 250 - b.r * 1.7 + j * 2.6, .1, b.y - 250 + b.r * 1.5, 1.15, 1.15, 1, -Math.PI / 2)
    }
  })
  outlines.forEach((b,i)=>write(ring, i, b===chosen?'#33786D':'#C92922', b.x-250, .14, b.y-250, b.r*1.53, b.r*1.53, 1, -Math.PI/2))
  scene.getObjectByName('homes').visible = !!props.layers?.homes
  for (const [, , mesh] of Object.values(meshKinds)) if (mesh) {
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }
  renderer.render(scene, view)
}

function project(x, y, z, view) {
  const p = new THREE.Vector3(x, y, z).project(view)
  return { x: (p.x * .5 + .5) * width, y: (-p.y * .5 + .5) * height, depth: p.z }
}

function spotlight(blob, view) {
  // Clip the floor circle before projection so a radius crossing the camera stays convex.
  const rim = visionRim.map(([x, z]) => new THREE.Vector3(
    blob.x - 250 + x * blob.sense, 0, blob.y - 250 + z * blob.sense).applyMatrix4(view.matrixWorldInverse))
  const near = -view.near
  const clipped = []
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length]
    if (a.z <= near) clipped.push(a)
    if ((a.z <= near) !== (b.z <= near)) clipped.push(a.clone().lerp(b, (near - a.z) / (b.z - a.z)))
  }
  const hole = clipped.map(p => {
    p.applyMatrix4(view.projectionMatrix)
    return ((p.x + 1) * width / 2).toFixed(1) + ',' + ((1 - p.y) * height / 2).toFixed(1)
  })
  const backdrop = `M-42,-42H${width + 42}V${height + 42}H-42Z`
  visionMask.value?.setAttribute('d', backdrop + (hole.length ? 'M' + hole.join('L') + 'Z' : ''))
}

function polygon(points, fill) {
  ctx.beginPath()
  points.forEach(({x,y}, i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y))
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

function ellipse(x,y,rx,ry,fill) {
  ctx.beginPath()
  ctx.ellipse(x,y,Math.max(.1,rx),Math.max(.1,ry),0,0,2*Math.PI)
  ctx.fillStyle = fill
  ctx.fill()
}

function softShadow(x,y,rx,ry) {
  ctx.drawImage(contact,x-rx,y-ry,rx*2,ry*2)
}

function draw2d(blobs, frame, view, { min, max }) {
  ctx.fillStyle = stageColor
  ctx.fillRect(0, 0, width, height)
  const p = (x,y,z) => project(x, y, z, view)
  const corners = s => [[-s,-s],[s,-s],[s,s],[-s,s]]
  const top = corners(270).map(([x,z]) => p(x,-1,z)), bottom = corners(270).map(([x,z]) => p(x,-11,z))
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    polygon([top[i],top[j],bottom[j],bottom[i]], i % 2 ? '#969696' : '#AAAAAA')
  }
  polygon(top, '#CDCDCD')
  const field = corners(250).map(([x,z]) => p(x,0,z))
  polygon(field, '#FFFFFF')
  ctx.save()
  ctx.clip()
  const eligible = b => !props.layers?.selected || b.id === props.selected
  if (props.layers?.homes) {
    const points = corners(242).map(([x,z]) => p(x,0,z))
    ctx.strokeStyle = '#6C847C'
    ctx.setLineDash([4,3])
    ctx.beginPath()
    points.forEach(({x,y},i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y))
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])
  }
  const overheadView = view === overhead
  const markers = blobs.map(b => ({ b, q: p(b.x-250,0,b.y-250), t: p(b.x-250,b.r*2.35,b.y-250) }))
  const plants = frame.plants.map(plant => {
    const x = plant.x-250, z = plant.y-250
    const q = p(x,0,z), t = p(x,2.2,z), edge = p(x+2,2.2,z)
    return { plant, q, t, r:Math.max(1,Math.min(8,Math.hypot(t.x-edge.x,t.y-edge.y))) }
  })
  plants.forEach(({q,r}) => softShadow(q.x+r*.38,q.y+r*.08,r*1.65,r*(overheadView?1.15:.54)))
  markers.forEach(({b,q,t}) => {
    const r = Math.max(1.2, overheadView ? b.r * width/(overhead.right-overhead.left) : Math.hypot(t.x-q.x,t.y-q.y) / 2.15)
    if (props.layers?.sense && eligible(b) && (!props.layers.cohortSense || inSightCohort(b))) {
      const senseRadius = overheadView ? b.sense * width/(overhead.right-overhead.left) : b.sense*r/b.r
      ellipse(q.x,q.y,senseRadius,senseRadius*(overheadView ? 1 : .36),'#E4F5FE')
    }
    softShadow(q.x+r*.42,q.y+r*.09,r*1.7,r*(overheadView?1.12:.51))
    if (props.layers?.energy && eligible(b)) ellipse(q.x,q.y,r*1.46,r*.43,b.energy/b.capacity>.45?'#F4DF86':'#CCCCCC')
    if (b.id === props.selected) {
      ctx.beginPath()
      ctx.ellipse(q.x,q.y,r*1.47,r*.48,0,0,Math.PI*2)
      ctx.strokeStyle='#33786D'
      ctx.stroke()
    }
  })
  ctx.restore()
  screenBlobs = []
  const objects = [...markers, ...plants]
  objects.sort((a,b) => b.q.depth-a.q.depth)
  for (const { b, plant, q, t, r: pelletRadius } of objects) {
    if (plant) {
      const r = pelletRadius
      const gradient = ctx.createRadialGradient(t.x-r*.3,t.y-r*.4,0,t.x,t.y,r*1.15)
      gradient.addColorStop(0,'#A9BA4D')
      gradient.addColorStop(1,'#647D22')
      ellipse(t.x,t.y,r,r,gradient)
      continue
    }
    const x = q.x, y = q.y
    const h = Math.max(3,overheadView ? b.r * width/(overhead.right-overhead.left)/.42 : Math.hypot(t.x-x,t.y-y)), r = h*.42
    const side = Math.cos(b.angle) < 0 ? -1 : 1
    const fill = paintColor(b,min,max).clone()
    const grad = ctx.createLinearGradient(x-r,y-h,x+r,y)
    grad.addColorStop(0,'#'+fill.clone().lerp(new THREE.Color('#EAF1F0'),.22).getHexString())
    grad.addColorStop(.5,'#'+fill.getHexString())
    grad.addColorStop(1,'#'+fill.multiplyScalar(.54).getHexString())
    if (props.camera === 'overhead') ellipse(x,y,r,r,grad)
    else {
      ctx.save()
      ctx.translate(x,y)
      ctx.scale(side,1)
      if (!b.alive) ctx.rotate(-1.2)
      ctx.beginPath()
      ctx.moveTo(-r*.9,-h*.15)
      ctx.bezierCurveTo(-r*1.25,-h*.42,-r*.44,-h*.65,-r*.40,-h*.82)
      ctx.bezierCurveTo(-r*.30,-h*1.08,r*.66,-h*1.05,r*.74,-h*.78)
      ctx.bezierCurveTo(r*.72,-h*.62,r*1.1,-h*.47,r*1.04,-h*.23)
      ctx.bezierCurveTo(r*.93,h*.04,-r*.7,h*.08,-r*.9,-h*.15)
      ctx.fillStyle=grad
      ctx.fill()
      if (b.id === hovered.value) {
        ctx.strokeStyle = '#C92922'
        ctx.lineWidth = 1.3
        ctx.stroke()
      }
      ctx.restore()
      ellipse(x+side*r*.53,y-h*.78,Math.max(.65,r*.08),Math.max(.65,r*.08),'#0A0A0A')
    }
    if (props.layers?.credits && eligible(b)) for (let i=0;i<b.credits;i++) ellipse(x-r+i*4,y+4,1.8,1.5,i<b.preyCredits?'#D38C80':'#A1C33F')
    screenBlobs.push({ id:b.id,x,y:overheadView?y:y-h*.5,r:Math.max(r,4),h })
  }
}

function fit() {
  if (!host.value?.clientWidth || !host.value.clientHeight) return
  width = host.value.clientWidth
  height = host.value.clientHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  const units = 355 * Math.max(1, height / width)
  overhead.left = -units * width / height
  overhead.right = -overhead.left
  overhead.top = units
  overhead.bottom = -units
  overhead.updateProjectionMatrix()
  const zoom = Math.max(1, height / width * 1.28)
  originalPosition.set(600*zoom,300*zoom,600*zoom)
  originalTarget.set(0, width < 700 ? 18 : height < 500 ? 13 : 26, 0)
  if (!manual && !followed) {
    camera.position.copy(originalPosition)
    target.copy(originalTarget)
  }
  const dpr = Math.min(devicePixelRatio, props.quality === 'efficient' ? 1 : 1.8)
  if (renderer) {
    renderer.setPixelRatio(dpr)
    renderer.setSize(width,height,false)
  } else if (ctx) {
    canvas.width = Math.round(width*dpr)
    canvas.height = Math.round(height*dpr)
    ctx.setTransform(dpr,0,0,dpr,0,0)
  }
  dirty = true
}

function resetView() {
  manual = false
  fit()
  camera.position.copy(originalPosition)
  target.copy(originalTarget)
  dirty = true
}

function draw(now) {
  if (!host.value?.offsetWidth) { raf = requestAnimationFrame(draw); return }
  const delta = Math.min(80, now-previousTime)
  previousTime = now
  const frame = props.frame
  if (frame) {
    const blobs = activeBlobs(frame, now)
    const blob = followedBlob.value && blobs.find(b => b.id === props.selected)
    const follow = !!blob
    if (follow) {
      if (!followed) {
        originalPosition.copy(camera.position)
        originalTarget.copy(target)
        followed = true
      }
      const x = blob.x-250, z = blob.y-250, c = Math.cos(blob.angle), s = Math.sin(blob.angle)
      const distance = Math.max(84, blob.r * 6)
      const lookAhead = clamp((width - 270) / 48, 0, 20)
      position.set(x+distance*(.19*c+.98*s),Math.max(32,blob.r*3.1),z+distance*(.19*s-.98*c))
      aim.set(x+c*lookAhead,Math.max(13,blob.r*1.65),z+s*lookAhead)
      const ease = reduced.matches ? 1 : 1 - Math.exp(-delta / 135)
      camera.position.lerp(position,ease)
      target.lerp(aim,ease)
    } else if (followed) {
      const ease = reduced.matches ? 1 : 1 - Math.exp(-delta / 195)
      camera.position.lerp(originalPosition,ease)
      target.lerp(originalTarget,ease)
      if (camera.position.distanceTo(originalPosition)<.8) followed = false
    }
    orbit.enabled = !follow && !followed && props.camera !== 'overhead'
    orbit.target.copy(target)
    orbit.update()
    target.copy(orbit.target)
    camera.lookAt(target)
    const view = props.camera === 'overhead' ? overhead : camera
    view.updateMatrixWorld()
    if (dirty || follow || followed || now-poseChangedAt < 90) {
      const range = props.speedRange ?? { min:Infinity, max:-Infinity }
      if (props.layers?.speed && !props.speedRange) for (const b of frame.blobs) if (b.state !== 7) {
        range.min = Math.min(range.min, b.speed)
        range.max = Math.max(range.max, b.speed)
      }
      if (renderer) draw3d(blobs,frame,view,range)
      else draw2d(blobs,frame,view,range)
      dirty = false
    }
    if (follow) {
      const p = project(blob.x-250,blob.r*2.6+4,blob.y-250,view)
      cloud.value?.place(p.x>28 && p.x<width-28 && p.y>92 && p.y<height-88 ? p : null)
      if (props.layers?.vision) spotlight(blob, view)
    }
  }
  raf = requestAnimationFrame(draw)
}

function hit(event) {
  const r = canvas.getBoundingClientRect(), x = event.clientX-r.left, y = event.clientY-r.top
  if (!renderer) return [...screenBlobs].reverse().find(b => Math.abs(b.x-x)<b.r+3 && Math.abs(b.y-y)<b.h*.58+3)?.id ?? null
  if (!meshKinds.body?.[2]) return null
  mouse.set(x/r.width*2-1,1-y/r.height*2)
  cast.setFromCamera(mouse,props.camera === 'overhead' ? overhead : camera)
  return bodyIds[cast.intersectObject(meshKinds.body[2])[0]?.instanceId] ?? null
}

function pointerDown(event) { down = { x:event.clientX,y:event.clientY, id:hit(event) } }
function pointerUp(event) {
  if (!down || event.button !== 0) return
  if (Math.hypot(event.clientX-down.x,event.clientY-down.y) <= (event.pointerType === 'touch' ? 10 : 5)) {
    const id = hit(event)
    if (id === down.id) emit('select',id)
  }
  down = null
}
function move(event) {
  if (down) return
  const id = hit(event)
  if (id !== hovered.value) {
    hovered.value = id
    canvas.style.cursor = id ? 'pointer' : 'grab'
    dirty = true
  }
}

function mountCanvas() {
  canvas.className = 'world-canvas'
  canvas.setAttribute('aria-label','Interactive tabletop. Use the creature list to select a blob by name.')
  host.value.prepend(canvas)
  orbit = new OrbitControls(camera,canvas)
  orbit.enableDamping = true
  orbit.dampingFactor = .12
  orbit.enablePan = false
  orbit.minPolarAngle = .09
  orbit.maxPolarAngle = Math.PI*.475
  orbit.minDistance = 55
  orbit.maxDistance = 2300
  orbit.addEventListener('change', () => { dirty = true })
  canvas.addEventListener('wheel', () => { if (orbit.enabled) manual = true }, { passive:true })
  canvas.addEventListener('pointermove', event => { if (down && orbit.enabled && Math.hypot(event.clientX-down.x,event.clientY-down.y)>5) manual = true; move(event) })
  canvas.addEventListener('pointerdown',pointerDown)
  canvas.addEventListener('pointerup',pointerUp)
  canvas.addEventListener('pointercancel',()=>{ down=null })
  fit()
}

function useCanvasFallback() {
  orbit?.dispose()
  canvas?.remove()
  renderer?.dispose()
  renderer = null
  down = null
  canvas = document.createElement('canvas')
  ctx = canvas.getContext('2d')
  mountCanvas()
  emit('fallback')
}

function setupRenderer() {
  contact = makeContactShadow()
  placeBoard()
  meshes()
  try {
    renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, powerPreference:'high-performance' })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.localClippingEnabled = true
    renderer.setClearColor(stageColor)
    canvas = renderer.domElement
    canvas.addEventListener('webglcontextlost', useCanvasFallback, { once:true })
  } catch {
    useCanvasFallback()
  }
  if (renderer) mountCanvas()
  resize = new ResizeObserver(fit)
  resize.observe(host.value)
  raf = requestAnimationFrame(draw)
}
watch(() => props.species, list => { for (const s of list ?? []) colors.set(s.id,s.color); dirty = true }, { immediate:true })
watch(() => [props.layers,props.camera,props.follow,props.selected,props.dim,props.scope,props.quality], () => { dirty = true }, { deep:true })
watch(() => props.quality, () => { if (canvas) fit() })
onMounted(setupRenderer)
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  resize?.disconnect()
  orbit?.dispose()
  contactTexture?.dispose()
  for (const [g,m,mesh] of Object.values(meshKinds)) { mesh?.dispose(); g.dispose(); m.dispose() }
  scene.traverse(object => {
    if (object.isInstancedMesh) return
    object.geometry?.dispose()
    for (const material of [object.material].flat()) material?.dispose()
  })
  canvas?.removeEventListener('webglcontextlost', useCanvasFallback)
  renderer?.dispose()
  renderer?.forceContextLoss()
})
defineExpose({ fit:resetView })
</script>
<template>
  <div ref="host" class="board">
    <svg v-if="followedBlob && layers?.vision" class="vision-mask" aria-hidden="true">
      <path ref="visionMask" fill-rule="evenodd" transform="translate(42 42)"/>
    </svg>
    <CreatureThought v-if="followedBlob" ref="cloud" :id="followedBlob.id" :state="followedBlob.state"/>
  </div>
</template>
