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
