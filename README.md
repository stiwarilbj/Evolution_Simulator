[Play the Evolution Simulator](https://stiwarilbj.github.io/Evolution_Simulator/)

# Evolution Simulator

Watch blobs look for food, hunt, and have babies. Small changes in speed, size, and sight can affect which blobs survive.

## Run it

Install Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open the link shown in your terminal.

## Try it

- **World** plays a day. Click a blob to follow it, or use **Quick Sim** to skip ahead. If the last blob dies, click the extinction tile to watch the ending.
- **Settings** lets you make species and choose how much their traits can change.
- **Trends** shows how the population and its traits change over time. Compare sight ranges or see how many blobs are each age.
- **About → Experiments** compares size changes of 1.00 and 0.50 using seed 118.

Use `npm test` to run the checks and `npm run build` to build the site.

[Project plan](outputs/evolution-simulator-website-plan.md) · [UI guide](outputs/evolution-simulator-implemented-ui.md) · [Project log](PROJECT_LOG.md)
