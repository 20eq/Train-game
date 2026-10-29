# Train Driver — Indian Locals

A browser driving sim: you sit in the cab of a real 3D railway, on four
different networks in four different cities, running locals and
long-distance expresses to a timetable.

No build step and no CDN. three.js is vendored in `vendor/`, so the game runs
from any static server, offline.

```bash
npm start     # http://localhost:5173
npm test      # 41 node tests: cities, sim, 3D scene, headless app boot
python3 -m unittest discover -s test   # 27 tests for auth.py
```

| | |
| --- | --- |
| ![Mumbai](docs/cab-mumbai.png) | ![Delhi](docs/cab-delhi.png) |
| *Mumbai — Western Line, from the cab* | *Delhi — Ring Railway on approach* |
| ![Kolkata](docs/lineside-kolkata.png) | ![Chennai](docs/chase-chennai.png) |
| *Kolkata — lineside camera* | *Chennai — chase camera* |

## Four cities, four locals

Pick a city on the title card; each one builds its own railway from its own
seed, with its own stations, livery, palette and rolling stock.

| City | Line | Local livery | Character |
| --- | --- | --- | --- |
| Mumbai | Western Line | maroon, cream band | coastal trunk, 12-car expresses |
| Delhi | Ring Railway | blue, yellow band | wide flats, hazy light |
| Kolkata | Circular Railway | deep blue, cream band | riverside curve, green |
| Chennai | South Line | green, cream band | hot light, long straights |

Every network has a trunk line and a branch that leaves it at a junction.
Six trains work each one: a long-distance express you start in, a fast
express, three locals and a branch shuttle.

## The view

Three cameras, cycled with **C** (or drag the scene to swing the lineside
camera around):

* **cab** — first person, at the head of the train, with the windscreen frame,
  A-pillars and headlining drawn in 3D around you;
* **chase** — just above the roof, looking down the train;
* **lineside** — orbit the train from the lineside and watch it go past.

The HUD carries the analogue speedo, the power and brake levers, lamp
repeaters (doors, signal, limit, horn), the next stop with distance and the
three after it, plus the clock and the score.

## Controls

| Input | Action |
| --- | --- |
| `W` / `↑` | power |
| `S` / `↓` | brake |
| `Space` | emergency brake |
| `D` | doors, at a platform |
| `H` | horn (two-tone, synthesised) |
| `C` | cycle camera |
| `Tab` | take the next train (the cab comes with you) |
| `T` | hand over to the autopilot |
| `P` / `Esc` | pause |
| `1` `2` `3` | jump straight to cab / chase / lineside |

## How it works

* `src/cities.js` — the four cities: stations, liveries, palettes, seeds.
* `src/world.js` — grows a network from a city seed: trunk, branch, station
  records, signals, and a fleet with routes resolved in the direction of travel.
* `src/sim.js` — metres per second throughout; braking-curve AI that stops at
  the board, block signals that consider only the asking direction, doors that
  only release at a platform, and traffic that holds its distance instead of
  rear-ending itself.
* `src/scene3d.js` — the 3D world: ballast, rails, instanced sleepers, catenary
  masts and wire, platforms with canopy and name boards, station buildings,
  lineside trees and town blocks, signal lamps, rolling stock and the cab.
* `src/app.js` — boot, cities, input, cameras, HUD, horn, pause.

Rendering is plain three.js WebGL. The tests boot the real app headlessly with
a renderer stub, and the scene tests count meshes and triangles in every city
so an empty world cannot pass.

## auth.py

The lean password/session module, kept from the earlier review work: PBKDF2 with
a per-user salt, constant-time comparison, a decoy hash so unknown usernames cost
the same as known ones, bounded lockout counters and opaque expiring sessions.
27 `unittest` cases, including timing and lockout-expiry behaviour.
