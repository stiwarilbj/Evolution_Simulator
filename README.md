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

- **World** plays a day. Click a blob to follow it, or use **Quick Sim** to skip ahead. The speed colors use the same scale across the run. If the last blob dies, click the extinction tile to watch the ending.
- **Settings** lets you make species and choose how much their traits can change.
- **Trends** shows the blobs that start each day. See the average and spread, switch to dusk, or watch the sight example.
- **About → Walkthrough** shows the ideas from the video. Try a stride race or watch a newborn blob search for food.
- **About → Experiments** runs the 600-generation size test from the video. Compare size changes and watch hunts from each run.

Use `npm test` to run the checks and `npm run build` to build the site.

[Project plan](outputs/evolution-simulator-website-plan.md) · [UI guide](outputs/evolution-simulator-implemented-ui.md) · [Project log](PROJECT_LOG.md)
