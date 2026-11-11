export const TRAITS = ['speed', 'size', 'sense']
export const PALETTE = ['#406780', '#F47E18', '#CE6591', '#80A653', '#9B7ACA', '#46A49D', '#D5A84C', '#C76052']
export const VERSION = 1

export function speciesTemplate(id, name, color, count = 10, enabled = true) {
  return { id, name, color, count, enabled, energy: 500, speed: 10, size: 10, sense: 20,
    variance: { speed: 0.25, size: 0.25, sense: 0.25 },
    mutation: { speed: true, size: true, sense: true } }
}

export function starter() {
  return {
    version: VERSION, name: 'Starter field', days: 50, duration: 100, seed: 18, food: 50,
    mode: 'prepare', predation: true, sameSpecies: true, stride: 'linked', metabolism: 'product',
    plantReward: 30, preyReward: 30, schedule: [], scheduleMode: 'constant',
    species: [speciesTemplate('blue', 'Blue', PALETTE[0], 50),
      { ...speciesTemplate('orange', 'Orange', PALETTE[1], 10, false), sense: 50 },
      { ...speciesTemplate('pink', 'Pink', PALETTE[2], 10, false), speed: 9, size: 9 }]
  }
}

export function validate(config) {
  const errors = {}
  const number = (key, name, value, min, max, integer = true) => {
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      errors[key] = `${name} must be ${integer ? 'a whole number ' : ''}from ${min} to ${max}.`
    }
  }
  if (!config || config.version !== VERSION) return { setup: 'Choose a setup file with a supported rule version.' }
  if (typeof config.name !== 'string' || !config.name.trim() || config.name.trim().length > 60) errors.name = 'Enter a run name with 1–60 characters.'
  number('days', 'Days', config.days, 10, 1000)
  number('duration', 'Seconds per day', config.duration / 10, 1, 60, false)
  if (!errors.duration && !Number.isInteger(config.duration)) errors.duration = 'Enter seconds in tenths.'
  number('seed', 'Seed', config.seed, 1, 100)
  number('food', 'Starting plants', config.food, 10, 1000)
  number('plantReward', 'Plant reward', config.plantReward, 0, 1000)
  number('preyReward', 'Prey reward', config.preyReward, 0, 1000)
  if (!['prepare', 'live'].includes(config.mode) || !['linked', 'speed'].includes(config.stride) ||
      !['product', 'additive'].includes(config.metabolism) || typeof config.predation !== 'boolean' ||
      typeof config.sameSpecies !== 'boolean') errors.rules = 'Choose supported simulation rules.'
  if (!Array.isArray(config.schedule) || !['constant', 'ramp', 'step'].includes(config.scheduleMode)) {
    errors.schedule = 'Choose a supported food schedule.'
  } else {
    const days = new Set()
    for (const point of config.schedule) {
      if (!point || !Number.isInteger(point.day) || point.day < 2 || point.day > config.days ||
          days.has(point.day) || !Number.isInteger(point.food) || point.food < 10 || point.food > 1000) {
        errors.schedule = 'Use unique days from 2 through the run limit and 10–1,000 plants.'
        break
      }
      days.add(point.day)
    }
  }
  if (!Array.isArray(config.species) || !config.species.some(item => item?.enabled)) errors.species = 'Enable at least one species.'
  const names = new Set(), colors = new Set(), ids = new Set()
  for (const item of Array.isArray(config.species) ? config.species : []) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.enabled !== 'boolean') {
      errors.species = 'Every species needs a unique identity and enable state.'
      continue
    }
    ids.add(item.id)
    const name = typeof item.name === 'string' ? item.name.trim().toLowerCase() : ''
    const color = typeof item.color === 'string' ? item.color.toLowerCase() : ''
    if (!name || name.length > 30 || names.has(name)) errors[item.id + '.name'] = 'Enter a unique species name with 1–30 characters.'
    if (!/^#[0-9a-f]{6}$/.test(color) || colors.has(color)) errors[item.id + '.color'] = 'Choose a distinct six-digit color.'
    names.add(name)
    colors.add(color)
    number(item.id + '.count', 'Starting creatures', item.count, 10, 1000)
    number(item.id + '.energy', 'Starting energy', item.energy, 10, 1000)
    for (const trait of TRAITS) {
      number(item.id + '.' + trait, trait, item[trait], 1, 100)
      number(item.id + '.variance.' + trait, 'Variance', item.variance?.[trait], 0.01, 10, false)
      if (typeof item.mutation?.[trait] !== 'boolean') errors[item.id + '.mutation'] = 'Specify which traits mutate.'
    }
  }
  return errors
}

export function plantsForDay(config, day) {
  if (config.scheduleMode === 'constant') return config.food
  let previous = { day: 1, food: config.food }
  for (const next of [...config.schedule].sort((a, b) => a.day - b.day)) {
    if (day === next.day) return next.food
    if (day < next.day) {
      return config.scheduleMode === 'step' ? previous.food :
        Math.floor(previous.food + (next.food - previous.food) * (day - previous.day) / (next.day - previous.day) + 0.5)
    }
    previous = next
  }
  return previous.food
}

export function rulesFor(setup, revisions, day) {
  return revisions.findLast(revision => day >= revision.day)?.setup ?? setup
}

export function validateRevisions(setup, revisions) {
  if (!Array.isArray(revisions)) return false
  if (!revisions.length) return true
  if (revisions[0]?.day !== 1) return false
  const foundersOf = settings => settings.species.map(s => [
    s.id,s.name,s.color,s.enabled,s.count,s.energy,s.speed,s.size,s.sense
  ])
  const identity = JSON.stringify(foundersOf(setup))
  let previous = 0
  for (const revision of revisions) {
    if (!revision || !Number.isInteger(revision.day) || revision.day <= previous || revision.day > setup.days ||
        Object.keys(validate(revision.setup)).length || revision.setup.seed !== setup.seed ||
        JSON.stringify(foundersOf(revision.setup)) !== identity) return false
    previous = revision.day
  }
  return true
}

export function randomSeed(exclude = 0) {
  if (!exclude) return 1 + Math.floor(Math.random() * 100)
  const draw = 1 + Math.floor(Math.random() * 99)
  return draw >= exclude ? draw + 1 : draw
}
