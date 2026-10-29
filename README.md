# Train Driver — A Western Line Cab Ride

You are in the driving cab of a Western Line express. Three connected lines, a
fleet of locals and long-distance services, and a whole evening of timetable to
run. Look out of the windscreen; the instruments are in front of you.

No build step, no frameworks, no bundler. A static server and ES modules.

```bash
npm start      # http://localhost:5173
npm test       # node --test: sim, world, rendering and a headless boot of the app
```

## The view

The default presentation is the **cab**: a first-person view down the track with
a pseudo-3D scene (rails, sleepers, catenary, lineside poles and trees, platforms
and canopies, station buildings, oncoming stock) drawn from the train's own
odometer, so the world moves at exactly line speed.

The dashboard carries an analogue speedometer, power and brake levers, lamp
repeaters (DOOR / SIGNAL / LIMIT / HORN), a next-stop strip with distance, two
wing mirrors and a speed-limit roundel.

Press **M** to pull back to the whole network map. Press **M** again to return
to the cab.

## Controls

| Input | Action |
| --- | --- |
| `W` / `↑` | power (hold) |
| `S` / `↓` | brake (hold) |
| `Space` | emergency brake / horn |
| `D` | doors, at a platform |
| `M` | cab ⇄ network map |
| `Tab` | take the next train |
| `P` / `Esc` | pause |
| click a train on the map | take control of it |
| drag / wheel (map) | pan / zoom |

## The network

* **main** — 5.8 km, the trunk line through the suburbs and the city end.
* **harbour** — 2.3 km, the dockside branch.
* **link** — 1.5 km, the connecting chord.

25 station records across the three lines. Seven trains run the timetable:
two expresses, three suburban locals, a harbour shuttle and a short link
working. The player starts as the **Saurashtra Express**, standing at the
platform with the doors open.

Stop anywhere alongside the platform to count as an arrival; stop near the board
for the accuracy bonus. Run through a station and it is logged as missed.

## How the simulation works

`src/sim.js` is DOM-free and takes a delta time plus a control object, so the
same code runs in the browser, in tests and in the headless traces.

* Speeds are metres per second throughout; `KMH = 3.6` is the only conversion.
* AI drivers brake for the platform, obey signals and hold their distance behind
  the train in front — following at line speed is traffic, not a collision.
* Signals are block-based and only consider the asking train's own direction.
* Doors only release at a platform; passengers exchange once they are open.
* A train held at a red signal is *waiting*, never a missed stop.

## Files

| File | What it holds |
| --- | --- |
| `src/world.js` | network geometry, stations, fleet, liveries |
| `src/sim.js` | physics, signals, doors, AI, scoring |
| `src/cab.js` | the first-person cab renderer and dashboard |
| `src/render.js` | the network map renderer |
| `src/geo.js` | curves, path sampling, projection helpers |
| `src/main.js` | boot, input, camera, HUD, overlays |
