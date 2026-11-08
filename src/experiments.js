import { starter } from './engine/config.js'

export const experiments = [
  { title:'A finite table', detail:'Locked traits, 50 plants, 100 days. Find the carrying capacity.', build(c) {
    c.days=100
    c.species[0].mutation={speed:false,size:false,sense:false}
  }},
  { title:'The price of speed', detail:'Only speed mutates. Compare the trait histogram with population.', build(c) {
    c.days=100
    c.species[0].mutation={speed:true,size:false,sense:false}
    c.stride='speed'
  }},
  { title:'Sense spreads', detail:'Sense evolves across 600 days while speed and size stay fixed.', build(c) {
    c.days=600
    c.species[0].mutation={speed:false,size:false,sense:true}
    c.species[0].variance.sense=1
  }},
  { title:'Size variance · wide', detail:'600 days. Size variance is 1.00 trait points squared.', build(c) {
    c.days=600
    c.species[0].variance.size=1
  }},
  { title:'Size variance · narrow', detail:'Same seed and 600 days. Size variance is 0.25.', build(c) { c.days=600 }},
  { title:'Sudden scarcity', detail:'100 plants a day, then 10 starting on Day 51.', build(c) {
    c.days=120;c.food=100;c.scheduleMode='step';c.schedule=[{day:51,food:10}]
  }},
  { title:'Gradual scarcity', detail:'Ramp from 100 plants to 10 between Day 50 and Day 100.', build(c) {
    c.days=120;c.food=100;c.scheduleMode='ramp';c.schedule=[{day:50,food:100},{day:100,food:10}]
  }},
]
export function setupFor(experiment) {
  const config=starter()
  config.name=experiment.title
  experiment.build(config)
  return config
}

export function sizeVariancePair(seed, days) {
  return [['Wide', 1], ['Narrow', 0.25]].map(([label, size]) => {
    const setup = starter()
    setup.seed = seed
    setup.days = days
    setup.name = `Size variance · ${label} (${size.toFixed(2)})`
    setup.species[0].variance.size = size
    return setup
  })
}
