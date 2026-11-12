export const METRICS = [
  { key: 'population', label: 'Population', short: 'Population', unit: 'blobs', color: '#EEEDD6', petal: '#EEEDD6' },
  { key: 'age', label: 'Average Age', short: 'Age', unit: 'days', color: '#FDDE3B', heading: '#FADE69', petal: '#FDDE3B', inner: '#FEE97F', outer: '#FEF2B8' },
  { key: 'deathAge', label: 'Average Age at Death', short: 'Age at Death', unit: 'days', color: '#DDDAD0', heading: '#FFFDFC', petal: '#FFFDFC', inner: '#E9E6DF', outer: '#F3F1ED' },
  { key: 'speed', label: 'Average Speed', short: 'Speed', unit: 'points', color: '#E97167', heading: '#E78482', petal: '#D20F18', inner: '#F1A29B', outer: '#F7CCC8' },
  { key: 'size', label: 'Average Size', short: 'Size', unit: 'points', color: '#1CC1AA', heading: '#70BAAB', petal: '#1CC1AA', inner: '#6BD6C7', outer: '#B0E8DF' },
  { key: 'sense', label: 'Average Sense Range', short: 'Sense Range', unit: 'world units', color: '#07C7FB', heading: '#7EC1DF', petal: '#07C7FB', inner: '#5EDAFB', outer: '#A8EAFC' },
]

export function distribution(values) {
  const n = values.length
  if (!n) return { n, mean: null, min: null, p25: null, p75: null, max: null, sd: null }
  values.sort((a, b) => a - b)
  const mean = values.reduce((sum, value) => sum + value / n, 0)
  const quantile = p => {
    const index = (n - 1) * p
    const lower = Math.floor(index)
    return values[lower] + (values[Math.ceil(index)] - values[lower]) * (index - lower)
  }
  const sd = n < 2 ? 0 : Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1))
  return { n, mean, min: values[0], p25: quantile(0.25), p75: quantile(0.75), max: values[n - 1], sd }
}

export function summaries(day, config, opening, closing, events, supply, plantsLeft) {
  const rows = {}
  for (const id of ['all', ...config.species.filter(s => s.enabled).map(s => s.id)]) {
    const belongs = item => id === 'all' || item.species === id
    const lives = closing.filter(belongs)
    const scoped = events.filter(belongs)
    const deaths = scoped.filter(event => event.type === 'death')
    const births = scoped.filter(event => event.type === 'birth').length
    rows[id] = {
      day, opening: opening.filter(belongs).length, population: lives.length, births,
      deaths: deaths.length, net: births - deaths.length, food: supply, plantsLeft,
      plants: scoped.filter(e => e.type === 'plant').length,
      hunts: scoped.filter(e => e.type === 'prey').length,
      causes: Object.fromEntries(['Starvation', 'Missed home', 'Predation', 'Energy depletion']
        .map(cause => [cause, deaths.filter(e => e.cause === cause).length])),
      age: distribution(lives.map(b => b.age)), deathAge: distribution(deaths.map(e => e.age)),
      speed: distribution(lives.map(b => b.speed)), size: distribution(lives.map(b => b.size)),
      sense: distribution(lives.map(b => b.sense)),
    }
  }
  return { day, rows }
}

export function metricValue(row, key) {
  return key === 'population' ? row?.population : row?.[key]?.mean
}

export function runSpeedRange(run) {
  let min = Infinity, max = -Infinity
  for (const species of run.setup.species) if (species.enabled) {
    min = Math.min(min, species.speed)
    max = Math.max(max, species.speed)
  }
  for (const record of run.summaries) {
    const speed = record.rows.all?.speed
    if (!Number.isFinite(speed?.min) || !Number.isFinite(speed?.max)) continue
    min = Math.min(min, speed.min)
    max = Math.max(max, speed.max)
  }
  return { min, max }
}

const numberFormats = new Map()
export function format(value, digits = 2) {
  if (value == null) return '—'
  if (!numberFormats.has(digits)) numberFormats.set(digits, new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  }))
  return numberFormats.get(digits).format(value)
}
