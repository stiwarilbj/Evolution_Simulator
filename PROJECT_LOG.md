# Project log

## 2026-11-08

- Added the Evolution Simulator, its tests, and its design notes to Jeopardy_Trainer.
- Shortened the README so it explains how to run the site and what to try.
- Set up this log to track project updates along with their commits.
- Set up GitHub Pages to test, build, and publish the simulator when changes reach `main`. Put the live link on the first line of the README.
- Added the blob icon to the browser tab on the live site.
- Checked for pending changes. The working tree was clean, so this update only records the check.
- Fixed replay navigation, Next Day, and stopped batches. Added recovery for failed simulations and browser checks before and after publishing to GitHub Pages.
- Fixed food markers after branching, made CSV downloads follow the Trends filters, and added hide and restore controls for Food and Births and Deaths.
- Fixed Trait Space selections after filtering species, rejected invalid day and bin numbers, and let Constant food runs start when old schedule points are out of range.
- Kept completed days when renaming an active run, opened newborns at a replay point where they are present, and used each replay day's movement and energy rules in creature details.
- Added a retry when replay reconstruction stops reporting progress. The current view stays available and long replays can keep working while they report progress.
- Kept copied setup links in the address bar while their settings are open, so refreshing reloads the shared setup.
- Added a retry for failed comparison replays that keeps the same runs and day selected.
- Fixed Run Library resume so switching between runs keeps completed days that are still waiting to save.
- Fixed the mutation profile menu so it shows the selected species' current trait settings.
- Cleared the old species Undo when discarding a settings draft so it cannot add a duplicate.
- Fixed Branch here so it offers earlier completed days while viewing the last day of a run.
- Fit World, playback, stats, and the timeline inside short and split windows. Kept stats in full screen and moved longer pages into their own scroll area.
- Made error messages and Retry simulation available when the World is in full screen.
- Kept the Mini line chart points centered above their generation tiles in short and split windows.
- Closed focused Trends charts when leaving Trends so browser Back returns to usable World controls.
- Kept cleared run choices empty when reloading Compare.
- Turning off Play Through now cancels the automatic move to the next replay, even if it has started loading.
- Fixed branching from an earlier day so a new branch starts with the rules from that day. Changing the plant count no longer brings in a later day length or other rules.
- Canceling Quick Sim now leaves a finished replay at the end and still resumes live playback if the dialog paused it.
- Fixed Trends so chart shortcuts and the pinned summary respect the selected day range. A pin appears again when its day is back in view.
- Switching runs during Quick Sim now lets the current day finish so its results are saved with the old run.
- Discarding settings edits now restores the setup the draft started from, including copies of saved runs and imported setups.

## 2026-11-11

- Fixed Seconds per day so Settings reports values outside 1–60 seconds and requires steps of one tenth of a second.
- Updated the README link and browser test path for the renamed GitHub Pages site.
- Fixed Run Library so View results opens Trends for the active run without stopping Quick Sim.
- Fixed Run both and compare so a worker that does not start shows an error and lets you try again.
- Fixed Mini line so the generation chart can show Population and Age at Death.
- Fixed the World view so it keeps drawing in Canvas when WebGL disconnects during a run.
- Kept the dark background in chart PNG downloads so the light lines and labels stay readable.
- Fixed Jump to chart so it scrolls to Overview with both separate and combined scales.
- Added a retry in Trait Space so a failed day can load again without changing the selection.
- Fixed playback actions that stayed enabled at the end of a live or recorded day.
- Fixed Compare so the old boards disappear while a different day's replay loads or fails.
- Fixed Branch here to start with the selected day's plant count and keep any amount you type.
- Fixed Mini line so each recorded reading shows a dot, even when only one day has results.
- Fixed Trends keyboard controls so the first arrow press selects the first visible day when no visible day is selected.
- Fixed Trait Space so a chart with one trait value centers the average line and shows the value once.
- Fixed World so clearing a creature selection shows the enabled layers for all creatures again.
- Fixed Creature Details so replays show the distance to the nearest refuge while a blob is returning.
- Added a retry for failed Trait Space comparisons so the main day and selected creature stay in view.
- Added a sight range comparison in Trends that opens the narrowest and widest days from above at dusk. Added exact age counts and newborn shares in Trait Space.
- Made the video's additive movement cost the default for new runs. Blobs pay the full cost for each 0.1-second move, and saved runs keep their original energy rules.
- Fixed a release delay by using the runner's installed browser libraries when downloading Chromium. The full browser checks still run before publishing.
- Plants and prey still give one food credit each, but meals no longer refill energy by default. Saved runs keep their chosen refill amounts.
- New setups use the original engine’s hunting rule. Prey can be at most 80% of the hunter’s size. Older setups and replays keep the 20% rule.
- New setups end the day when all blobs are home or dead. Fixed time remains available. Runs stop at extinction, and the ribbon tile opens the last scene.
- Added seed 118 and size settings of 1.00 and 0.50 to the paired experiment. New setups use standard deviation for mutations and let traits evolve below 1. Saved runs keep their original rules.

## 2026-11-12

- Rebuilt the video’s 600-generation size experiment around step-by-step foraging and inherited refuges. In Chromium with seed 118, average size drops from 10 to 7.37 in the wide run and 6.95 in the narrow run. Compare opens at Day 600 with both results and hunt replays.
- Added an illustrated video walkthrough, a footprint race, and an energy comparison. Each World example opens its own replay. The family replay follows a parent home and then shows the newborn’s small sight range.
- Matched World more closely to the video with a tilted board, smaller playback controls and flowers, and simpler creature follow view. The speed colors now use bounds from the whole run.

## 2026-11-13

- Matched the five Trends plots to the video with shaded spread bands and dawn stats. Kept dusk and percentiles in Chart options. Added an overhead sight example with Days 1 and 648 from a separate 1,000-day run.
- Tightened Settings to match the video’s narrow overlay, color-coded compact controls, side-by-side Energy and Food fields, and teal Evolve button. Fixed clipped reproduction notes and mutation value fields.
- Added independent days, timelines, and camera angles to Compare, kept those choices in its URL, and staged the seed 118 Day 6 hunter versus Day 77 forager sequence with timed dimming and camera cuts.
