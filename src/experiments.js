import { starter } from './engine/config.js'

export const SIZE_MUTATION_SEED = 118
export const SIZE_MUTATION_DAYS = 600

function applySizeExperiment(config, size, seed = SIZE_MUTATION_SEED, days = SIZE_MUTATION_DAYS) {
  config.seed = seed
  config.days = days
  config.foraging = 'walkthrough'
  config.species[0].standardDeviation.size = size
}

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
    c.species[0].standardDeviation.sense=1
  }},
  { title:'Size mutation · wide', detail:'Seed 118, 600 days, and a size standard deviation of 1.00.', build(c) {
    applySizeExperiment(c, 1)
  }},
  { title:'Size mutation · narrow', detail:'Seed 118, 600 days, and a size standard deviation of 0.50.', build(c) {
    applySizeExperiment(c, 0.5)
  }},
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

export function sizeMutationPair(seed, days) {
  return [['Wide', 1], ['Narrow', 0.5]].map(([label, size]) => {
    const setup = starter()
    setup.name = `Size mutation · ${label} (${size.toFixed(2)})`
    applySizeExperiment(setup, size, seed, days)
    return setup
  })
}
