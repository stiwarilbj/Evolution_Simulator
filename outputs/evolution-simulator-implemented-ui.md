# Evolution Simulator
## Implemented visual and interaction guide

The site opens on a white tabletop suspended in charcoal, with a thin gray rim and miniature matte creatures. The large white surface is reserved for the experiment. Teal marks the controls and elapsed time. The brighter yellow, red, mint, and cyan belong to individual traits. Click a creature and the view drops to its level. Read a whole run by following the same colors from the creature’s flower to the generation ribbon and Trends.

| Walkthrough moment | How it appears in the site |
| --- | --- |
| Tabletop at 1:08 | White field, gray edge, free charcoal space, compact header and transport, dark timeline and roof over the selected day. [Tabletop](https://www.youtube.com/watch?v=6nMo8T3T0L4&t=68s) |
| Creature follow at 1:30 and overlays at 1:53–2:08 | Matte blue model with pin eyes, short shadow, black thought cloud, right-side flower, cyan sensing disk, and brown-to-red speed colors. [Follow](https://www.youtube.com/watch?v=6nMo8T3T0L4&t=90s), [sensing](https://www.youtube.com/watch?v=6nMo8T3T0L4&t=113s), [speed](https://www.youtube.com/watch?v=6nMo8T3T0L4&t=128s) |
| Small area of vision at 4:09 and overhead at 5:44 | A selectable spotlight projects the selected blob’s sense radius onto the floor. Overhead shows all four edges from directly above. [Spotlight](https://www.youtube.com/watch?v=6nMo8T3T0L4&t=249s), [overhead](https://www.youtube.com/watch?v=6nMo8T3T0L4&t=344s) |
| Settings at 6:27 and 7:55 | A dark translucent layer lets the current stage or plots show through. Mono headings and short form rows align around the center. Energy and Food have their own colors. [Over World](https://www.youtube.com/watch?v=6nMo8T3T0L4&t=387s), [over Trends](https://www.youtube.com/watch?v=6nMo8T3T0L4&t=475s) |
| Five plots at 8:05 and paired boards at 8:24 | Trends puts three plots over two and a shared key. Compare allows one board to recede into the dark while both days remain synchronized. [Plots](https://www.youtube.com/watch?v=6nMo8T3T0L4&t=485s), [paired boards](https://www.youtube.com/watch?v=6nMo8T3T0L4&t=504s) |

The table maps compositions visible in the footage. The hex values below are the app’s CSS or material inputs. Directional light changes the apparent colors of three-dimensional objects. The [visual specification](evolution-simulator-visual-ui-spec.md) and [annotated component atlas](evolution-simulator-component-atlas.md) retain the earlier design studies.

The direct flower interaction follows the [released flower component](https://github.com/minutelabsio/evolution-simulator/blob/3b99f358b70a608f5fb3e34fe8f410ba85aec7f3/src/components/flower-chart.vue) and its [generation selection logic](https://github.com/minutelabsio/evolution-simulator/blob/3b99f358b70a608f5fb3e34fe8f410ba85aec7f3/src/pages/simulation.vue). The bordered readings card, keyboard shortcut, and labeled speed stops are additions for this implementation.

## 1. Palette, typography, and controls

| Role | Actual value and placement |
| --- | --- |
| Stage and chart page | `#242424`. The stage canvas, page and gaps between plots share this background. |
| Lower dock and flowers | `#171717` dock, `#080808` ribbon key, `#121212` flower disks and `#162E2B` selected-day roof. |
| Ink | `#FFFDFC` active text and large readings, `#EEEDD6` cream labels and population, `#BDBAB0` secondary text, `#A5A195` metadata. |
| Edges | `#46443E` dividing rules and `#30302D` quieter seams. Standard secondary buttons use `#5C594F` around a `#171717` fill. |
| Actions and focus | Primary `#33786D`, hover `#3C897B`. Outline and icon accent `#71D2C0`. Hovered or pressed secondary controls get `#1E302D` and a muted mint border. |
| Rail | `#5E5A51` remaining time, `#19AF9A` elapsed time and knob, `#71D2C0` hover and keyboard focus. |
| Transport | `#171717EB` surround, `#46443E` outline, `#272725` central control. Side chevrons use `#BDBAB0`. |
| Timeline inspection | `#121212` value badges, `#111110F7` readings card and `#62887C` border. Value badges borrow their trait’s text color; readings in the card use cream. |
| Validation | Salmon `#FFA89D` text and `#CB7B70` field outline. Unavailable controls keep their place and lower their opacity. |
| Food and energy | `#83A51E` olive pellets, `#A1C33F` plant credits, `#D38C80` prey credits. Energy moves from `#CCCCCC` to `#FDDE3B`. |

Source Sans is used for prose, field help, navigation, and axis labels. Latin Modern Mono is used for headings, transport readouts, generation labels, numbers, and the Settings pill. The typical icon button occupies 40 × 40 CSS pixels. The main Settings pill is 124 × 40 on desktop. Rectangular actions generally have a 5 px radius, native dialogs 8 px. Keyboard focus is a 2 px mint outline with a 3 px offset. Toggle controls also expose a pressed state. On desktop, hover tips explain the layer icons. Narrow screens display the layer names inline. Reduced motion removes decorative bobbing and CSS transitions, and camera follow snaps to its target.

| Trait | UI heading and stat label | Chart mean | Flower |
| --- | --- | --- | --- |
| Population | `#EEEDD6` | `#EEEDD6` | `#EEEDD6` center |
| Age | `#FADE69` | `#FDDE3B` | `#FDDE3B` top |
| Age at death | `#FFFDFC` | `#DDDAD0` | `#FFFDFC` in six-metric mode |
| Speed | `#E78482` | `#E97167` | `#D20F18` right |
| Size | `#70BAAB` | `#1CC1AA` | `#1CC1AA` bottom |
| Sense range | `#7EC1DF` | `#07C7FB` | `#07C7FB` left |

## 2. Header, field, and creature observation

The cream outline blob at top left returns to World. About, World, and Trends sit in a row beside it. The current link turns ivory and gains a short mint underline. Compare joins the row while its page is open. The centered **settings** pill opens the active run’s draft. The smaller line beneath it shows the current day, configured limit, and playback or simulation status. Its chevron opens the run name, seed, last saved day, Run Library, Compare, Branch here, Back to Live when eligible, and Show tour. Outside click and Escape dismiss the run menu. A recoverable app error appears in a warm red banner with an explicit close button.

### 2.1 Tabletop and camera

The usable field is 500 world units square. A white `#FFFFFF` tabletop sits on a 540 × 10 × 540 slab with a `#CDCDCD` top lip and gray side faces. The stage fills the space above the dock. The default oblique view shows thickness and leaves a wide charcoal perimeter. Drag to orbit and scroll or pinch to zoom. **Fit board** restores framing. **Overhead** swaps to an orthographic view, where the rim reads as a square and the sensing disks as circles. **Full screen** expands the stage using the browser’s fullscreen mode.

The body is a softly curved, asymmetrical lathed mesh with a broad base and forward head. The starter species material is steel blue `#406780`. Two `#0A0A0A` pin eyes face travel. Both food and creatures cast a soft `#4B5661` contact shadow. It fades from 31% opacity at the center through 20% and 7% to transparent. The creature ellipse is wider than its footprint and slightly offset from the body toward the unlit side. The pellet uses the same falloff at a much smaller scale. The floor remains white between them. Food is a round olive `#83A51E` bead with a radius of two world units and directional shading. In Canvas it shades from `#A9BA4D` to `#647D22`; overhead objects use their projected footprint. WebGL and Canvas share the same shadow texture.

While moving, a creature leans and bobs slightly. A nearby selected creature reacts briefly on a bite. Deceased bodies tip over and temporarily gray out. At dawn the seeded layout spreads creatures around all four sides and plants across the interior. The bead and its shadow disappear together when consumed. Renderer interpolation smooths movement between recorded positions.

### 2.2 Follow, thought, flower, and focus

Click a creature on the field or use **Follow creature** to use the current selection or the first living blob. The camera eases toward a low oblique view with room in the direction of travel. Portrait framing keeps the body near center and clear of the right-hand instruments. Click empty floor to clear selection, or toggle Follow to pull back. An outline in dark teal `#33786D` marks the selection. The follow view ends when its creature dies.

A 52 × 40 px scalloped `#222222` thought cloud and two trailing dots attach above the head. Its ivory pictogram follows the actual behavior state. Dots mean search, leaf means a plant target, crosshair means chasing, wind means fleeing, arrow means return, and house means refuge. Press the cloud to show a short caption above it. Hover or expansion tints the pictogram mint. The caption resets for a different creature.

The right-hand individual flower has four wedges around a fine `#777268` circular guide. Age is above the ring, speed to the right, size below, and sense to the left. Petals stop before the numbers, so each number has a dark background and picks up its trait’s softer heading tint. Age is an integer and the other three values use one decimal. The small black **Current creature** caption underneath carries the species swatch, name, and ID. It opens the inspector. **Sense focus** beside the selected creature’s instrument switches the stage to the low-sense composition. The area outside its projected 2D sense circle is covered with an approximately 90% `#0B0B0B` mask and a 10 px feather. Camera projection makes the opening follow the slope of the floor. The top controls, flower, thought cloud, and player sit over the mask. Toggle again to restore the whole field.

### 2.3 Layer and view controls

| Control | Appearance and result |
| --- | --- |
| Layers | Stack icon opens a dark vertical strip, with a closing chevron above and More layer options below. Selected layers have a mint icon and a thin mint tick at the left edge. |
| Sense range | Eye icon draws pale cyan `#E4F5FE` disks on the ground. Disks stop at the playable boundary. The focus toggle is a separate close-view tool. |
| Color by speed | Rabbit icon changes body materials from `#7E635D` brown to `#C92922` red. The compact key above playback shows the opening cohort’s low and high trait values for the day. It uses a single reading when all speeds match. The species swatch still identifies the selected creature. |
| Energy and food credits | Battery adds a gray-to-gold ground halo. Utensils add small olive or rust credit marks. These marks sit below the body and retain their own meaning when speed recoloring is active. |
| More layer options | **Selected creature only** restricts the ground indicators to one selection. **Show refuges** adds a muted green dashed square near the board edges. |
| View options | Fit board, Overhead, Full screen, Creatures, graphics quality, Dim other species, and HUD. The HUD is a small top-left tally for alive, home, plants left, hunts, and deaths. |
| Creatures | The inspector is a scrollable near-black panel on the left with a close icon and a creature dropdown. It shows current state, distance to refuge where applicable, energy bar, credits, age, traits, effective travel, radius, energy rate, birth day, and parent. Filter the timestamped event list by category. In a replay, a timestamp jumps to the event. |

A small centered message covers replay construction or extinction. At high visible populations the renderer prioritizes body instances over tiny eyes and uses the selected creature for detailed ground indicators. If WebGL cannot initialize, the Canvas renderer preserves the field, controls, replay, and sense focus, with simpler models and ground markers.

## 3. Playback, stats, and generation ribbon

The three transport buttons sit on one dark plate with a 6 px corner radius, 1 px border, and 3 px gaps. The center is a lighter 42 × 38 px cell; its ivory glyph changes from a triangle to pause bars during playback, then to a circular **Replay day** arrow at the end of a recorded day. Replay goes back to zero and starts playback. The 40 × 38 px chevrons step between recorded days and dim when a neighboring recording is unavailable. The step-forward toggle directly above enables automatic playback into the next day. To the right, **Quick Sim** uses a mint double-arrow, the ellipsis opens playback actions, and the clock opens the vertical speed panel.

The speed panel has 13 positions from **0.125× to 8×**. Three small ticks to the right show **8×**, **1×**, and **⅛×** from top to bottom. The midpoint tick turns mint at normal speed, and the bordered mint readout shows the current multiplier. The individual flower slides left while the panel is open, leaving both controls readable. Clicking the readout resets to 1×; arrow keys can move one stop at a time. This adjusts viewing only. Playback actions include one-tick advance, finish or seek to the end of a day, jump to the latest completed day, and resume Live when available.

The 4 px rail is visually separate from the controls. A replay has a 9 px knob and a larger input area for dragging or keyboard seeking. Hover or focus displays elapsed and total seconds. While computing a live day the rail is a progress indicator. During a pointer scrub the replay pauses and restores its previous playing state on release when it has time left.

**Current Generation Stats** is an 84 px desktop strip immediately below the rail. The heading is followed by day/state and an exact-table icon. The right dropdown shares its species scope with Trends. Six columns put a short color mark beside each metric and an ivory value below. Population is an integer. Other statistics show two decimals, with a dash for unavailable samples. Readings update as the visible day runs. At its end they match the committed summary.

The 178 px desktop ribbon contains 100 px tiles. The active day centers in the viewport where possible and sits on a muted teal roof. A soft mint-gray stroke follows pointer hover. Keyboard focus uses a separate brighter outline, drawn inside the tile so the scroller never cuts it off. Each completed day has a dark flower disk, the trait wedges, a cream population center, and the day number. An empty center marks zero population. Pending flowers fade and carry a label. The first extinction has an explicit marker.

| Flower control | Visual response and behavior |
| --- | --- |
| Trait sector | The hit area is the full 90° sector in classic mode or 72° in six-metric mode, including the dark space beside a short petal. Its tint goes from 5% to 20% on hover. A dark rounded badge shows the mean to two decimals in the trait’s heading color. An em dash indicates a missing mean. |
| Population center | The cream disk grows with the square root of its share of the scope’s maximum recorded population. Hovering over the center dims the petals to 52% and shows the integer count. |
| Select and rotate | Clicking a different day selects that day. Clicking a trait on the current day or its legend key turns that trait to the top of every flower over 450 ms. The selected legend key gains a mint dot. Reduced-motion mode makes the turn immediate. |
| All readings | Click the current flower’s center or right-click any completed tile. A near-black 214 px minimum-width card opens above the tile with a thin muted mint outline and a pointer. A cream day heading and muted Final label sit above six color-coded names with right-aligned values. The card follows the tile as the ribbon scrolls and stays inside the viewport. |
| Keyboard | One day tile is in the Tab sequence. Left/Right move focus, Home goes to Day 1, and End moves to the last completed day. Enter or Space selects the focused day. `I` or Shift+F10 opens that completed day’s card and moves focus to Close. Escape closes the card and returns focus when invoked from inside it. The legend provides keyboard access to trait rotation. |
| Touch | Tap a day, then tap a sector to rotate or tap the center for exact readings. The card fits inside a narrow viewport, and the ribbon still scrolls horizontally. |

The black left legend can be collapsed. Its population key and scale help open the numeric table. In Mini line mode a trait key chooses the plotted measure, and the numeric card remains available from keyboard or right-click. The right tools reroll the seed into a draft, extend the run, open ribbon options, or collapse the ribbon. Options include the classic flower, all six metrics, a mini line, the numeric table, and Go to day.

## 4. Settings

Settings is a full-viewport native dialog with a 5 px blur and one translucent `#090909C7` scrim. The white table or colored chart traces remain recognizable behind it. An outlined close icon stays at the upper right. A centered 26–34 px mono heading leads into compact 21 px section titles with quiet horizontal rules. On desktop, explanatory copy aligns to the right of the left column and fields stack in the right column within a 650 px seam.

| Section | Appearance and behavior |
| --- | --- |
| Blob Creatures | Compact species tabs display color dots, names and an Off marker. The active tab uses the shared teal pressed style. Add creates a species. Name, native color swatch, Enabled, and Species actions edit the draft. Actions duplicate, reorder, or remove, with Undo after removal. A shaded two-eye preview uses the selected color. Founders accept 10–1,000. Starting speed, size, and sense accept 1–100. A readout combines starting travel rate and estimated moving time before refills. |
| When they reproduce | Salmon, sea green, and blue rails mark speed, size, and sense. Each variance field ranges from 0.01 to 10 and shows its corresponding standard deviation underneath. Each Allow mutation checkbox locks or unlocks its own trait. Branch Settings keeps inherited traits and lets mutation rules change. |
| Each generation | The left Energy card has a gold top rule, battery icon, and starting energy field from 10–1,000. Refill rewards expands the plant and prey energy fields from 0–1,000 and an Equal rewards action. The right Food card has an olive top rule, leaf icon, and starting supply from 10–1,000. Its Constant, Ramp, and Step options reveal schedule point fields, add, remove, and clear controls when relevant. Every dawn resets energy and places the scheduled supply. |
| Finally | The darker central inset holds name, days from 10–1,000, duration from 1–60 seconds with a 10-second default, duration presets, a playback estimate, and seed from 1–100. Seed controls roll or copy. Two tiles select Prepare and watch or Watch live. |
| Advanced Rules | A disclosure exposes predation, same-species hunting, stride, energy model, and mutation profiles. Formula and selected species cost share the final row. The default model uses size³ × speed² × sense with a scale factor of 20,000. |
| Footer | Enabled species, founders, and plants per founder summarize the draft. Discard opens a local confirmation. The large teal **Evolve!** pill starts a new run after validation. Branch Settings changes the action to **Create branch** and states the first changed day. Validation shows inline salmon text and a summary. The first invalid field receives focus when possible. |

The common numeric row has three compartments. A near-black mono label sits at left, minus and plus flank a spring slider in the middle, and an editable exact number sits at right. Hold to either side of the spring to repeatedly adjust the number. Release returns the white dot to center while keeping the value. The native number field and step buttons support keyboard use. Unavailable rows fade, and the labels, step buttons, and validation text stay associated with their fields.

## 5. Trends and Trait Space

The toolbar starts with species scope, time range, and chart jump. On the right sit Download, Run again, Reroll seed, More Generations, and Quick Sim. A thin rule separates the run name, seed, completed day, and Trends/Trait Space switch. Range offers Full run, Last 25, Last 100, and custom day bounds. The second row chooses Percentiles or Walkthrough spread, Walkthrough order or Overview first, and optional opening population, per-species population traces, death causes, or the size-100 guide.

| Chart area | Visual and interaction details |
| --- | --- |
| Walkthrough grid | Population, Age, Speed fill row one. Size and Sense Range start row two. The shared **Reading the traits** key fills the last slot on desktop. The axes sit directly on charcoal. Headings are uppercase mono with a tiny colored minus at left and a focus icon at right. The plots share horizontal rhythm while their axes show their own units. |
| Distribution | A saturated 2.5 px mean, softened 1.5 px upper and lower traces, and faint 1 px dotted extrema. The lower trace is dashed. Default bounds are P25/P75. Walkthrough spread switches to mean ± sample SD, bounded by observed extrema. An extinct cohort’s missing values leave gaps. A range with no samples gets an explicit empty-state message. |
| Overview | All six metrics in one plot, with the population axis on the right. Separate scales splits the readouts into compact mean plots. The combined chart has a line-toggle key. |
| Births and Deaths | Olive-green births extend above zero. Muted red deaths extend below zero. A cream trace and faint fill show the signed net. Optional dashed traces break deaths down by cause. |
| Food | A dashed warm-gray supply line, an olive eaten-plant line, and a rust dashed hunt line. The supply belongs to the whole field when viewing a species. |
| Age at Death | A separate ivory distribution chart samples only deaths on each day. No deaths produce a gap. |
| Tooltip and chart focus | Hover shows a near-black tooltip with day, scope, and series readings. The square minus hides a plot and leaves a restore chip. The expand icon opens a wider native focus dialog with individual legend toggles, Pin day, and PNG download. |
| Navigation and pinning | Desktop click opens the day in World. Shift-click or touch pins it, and Shift-drag sets a custom date range. Arrow keys, Home and End select days, Space pins, and Enter replays. The pinned card shows the population, births, and deaths plus View table, Show sense circles, Watch day, and Clear. |

**Trait Space** has a dark outlined plot area and an adjacent creature inspector. Select a completed day and drag to rotate the three axes. Dots use species colors and the selected creature is identified separately. Reset view restores the default angle. Choose a creature from the inspector to watch it in World. The histogram below lets you select the trait, set 5–50 bins, switch to percentage, and overlay a comparison day.

## 6. Compare, dialogs, and learning

**Compare runs** begins with blue `#83B3CE` on the left and copper `#F6AD73` on the right. Those colors repeat in the run captions and paired chart traces. Day controls stop at the shorter completed history. The species dropdown offers common enabled species. Sense circles, Overhead, and Fit both boards act on both views. Side by side keeps a straight dividing seam. Reveal mode stacks the fields and clips each against a movable 2 px mint divider. **Emphasis** offers Both boards, Left board, or Right board. Choosing a side reduces the other board to 43% brightness and keeps both captions readable. Camera selections are independent. Play and the shared percentage slider keep both views at the same fraction of their days. The table shows Left, Right and Right − Left, followed by six paired trend plots.

Task dialogs use a warm-black `#191918` surface, an ivory mono heading, a thin border, and a blurred backdrop. Their circled X or Escape closes them. The primary action sits in the footer next to a quieter action. Most are 470 px wide, with 820 px available for the Library and table.

| Dialog or surface | What each control does |
| --- | --- |
| Quick Sim | Additional generations or Complete through day changes the target input. Watching, Computing, and Saved through distinguish the open replay from the simulation frontier. A teal destination explains what will complete. A completed target opens as replay. |
| Batch progress | A thin teal bar and completed-day counts reflect worker results. Hide progress closes the dialog. Stop after this day commits the current day first. On completion, Watch last day opens the result. |
| More Generations | Current and new limits preview the added days. Extend saves the larger horizon up to Day 1,000. |
| Numeric table and Download | The table has a sticky header and aligned mono values. Click a day number for its replay. Download offers a scoped and date-bounded CSV or setup JSON. |
| Run Library | Search and Import setup sit beside New experiment. Saved rows show the run and seed with Resume, Compare, and Actions. Actions provide View results, Rename, Duplicate, Export setup, Copy setup link, and Delete for inactive runs, with a confirmation row for deletion. |
| Branch here | Day and plant-supply fields preview the next affected day. Create branch keeps completed history. Edit branch rules opens the branch Settings draft. |
| About and tour | About uses an ivory mono headline, muted explanatory copy, numbered chapter buttons, Back/Next, Open World, and on-demand reference video tiles. Experiment cards load a setup. The separate tour has a miniature tabletop and six chapters, with play/pause, Skip, Back, Next, and Open World. |

## 7. Responsive behavior and implementation choices

Above 1,000 px the graphs sit three across and all six current stats have room for long labels. From 701–1,000 px the graphs sit two across and stat labels shorten. At 700 px and below the charts and paired Settings fields stack. The chart key moves above the plots and compresses into two columns of line samples. The header keeps navigation at the top and centers the Settings pill on a second line. Field tools move to the top-right edge, show text when Layers is open, and the player moves above a separate Quick Sim and clock row. The stat dock becomes a three-column, two-row grid. The ribbon stays horizontally scrollable and defaults to a folded key on small screens when opened fresh. Form columns and dialogs scroll vertically. Narrow tables scroll within their container.

The spotlight is a controllable visualization. It uses the selected trait and camera projection, with near-plane clipping for large circles. The speed key uses the day’s opening cohort so a death does not recolor all remaining bodies mid-day. Compare’s emphasis changes brightness without altering either replay. The app uses a JavaScript worker and procedural 3D meshes, with the user-requested species, percentiles, headless simulation and archive features integrated into the reference’s visual layout. The [release source](https://github.com/minutelabsio/evolution-simulator/tree/3b99f358b70a608f5fb3e34fe8f410ba85aec7f3) is the reference for the original site. The local model and browser controls are described in the [README](../README.md).
