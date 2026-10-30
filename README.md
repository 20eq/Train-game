# Train Driver — Indian Locals

A browser driving sim: you sit in the cab of a real 3D railway, on four
different networks in four different cities, running suburban locals, loco-
hauled passengers and long-distance expresses to a timetable.

No build step and no CDN. three.js is vendored in `vendor/`, so the game runs
from any static server, offline.

```bash
npm start     # http://localhost:5173
npm test      # 46 node tests: cities, sim, 3D scene, headless app boot
python3 -m unittest discover -s test   # 27 tests for auth.py
```

| | |
| --- | --- |
| ![The picker](docs/menu.png) | ![Drive menu](docs/services.png) |
| *Pick a city — every one runs three real lines* | *Then pick your train: local, passenger or express* |
| ![Mumbai cab](docs/cab-mumbai.png) | ![Kolkata chase](docs/chase-kolkata.png) |
| *Mumbai — Western Line, from the cab* | *Kolkata — chase camera off the shoulder* |
| ![Chennai lineside](docs/lineside-chennai.png) | ![Mumbai network](docs/network-mumbai.png) |
| *Chennai — a nine-car local at a halt* | *Mumbai — Western, Central and Harbour in one corridor* |

## Four cities, three real lines each

Choose a city on the title card — click a row or press `1`–`4` — then choose
which train to drive on its Drive menu. Each city grows its own network from
its own seed, and its lines run as parallel corridors, so from the cab you can
see the next line's masts, platforms and trains.

| City | Lines | Local | Passenger | Express |
| --- | --- | --- | --- | --- |
| Mumbai | Western · Central · Harbour | 12-car EMU, Western | Panvel Passenger, Central (ICF · WAP-4) | Mumbai Rajdhani, Central (18 LHB · WAP-7) |
| Delhi | Ring · Gurgaon · Ghaziabad | 8-car EMU, Ring | Rewari Passenger, Gurgaon (ICF · WAP-4) | Bhopal Shatabdi, Ghaziabad (20 LHB · WAP-5) |
| Kolkata | Circular · Sealdah South · Howrah Main | 9-car EMU, Circular | Bandel Passenger, Sealdah (ICF · WAP-4) | Howrah Duronto, Howrah (17 LHB · WAP-7) |
| Chennai | South · North · MRTS | 9-car EMU, South | Arakkonam Passenger, North (ICF · WAP-4) | Coromandel Express, North (19 LHB · WAP-7) |

**Three different machines, not three liveries.** A local is an EMU: flat cab
end, four doors a side, white body with the city's band, twelve cars in Mumbai
and eight or nine elsewhere, quick away and 20–21 m/s flat out. A passenger is
a WAP-4 and ten cream ICF coaches: ribbed sides, slow off the mark, stops at
every station. An express is a WAP-7 (or a WAP-5 in Delhi) and 17–20 LHB
coaches: navy or maroon sealed stock, 28–29 m/s, stops only at the majors.

Every network carries seven trains — yours, a superfast coming the other way,
a local ahead of you, and a local plus a passenger on each of the other two
lines — all held apart by block signals and a braking curve.

The stations are real: Churchgate, Mumbai Central, Dadar, Kurla, Thane, Kalyan;
Nizamuddin, Safdarjung, Gurgaon, Ghaziabad; Dum Dum, Bara Bazar, Eden Gardens,
Majerhat, Sealdah, Howrah, Bandel; Beach, Egmore, Guindy, Tambaram, Avadi,
Velachery. 58 stations in Mumbai alone, each with two platforms, a name board
in the line's colour, and a canopy or a halt shelter depending on its size.

## The view

Three cameras, cycled with **C** (drag the scene to swing the lineside camera):

* **cab** — first person in a built cab: windscreen frame, pillars, dash,
  traction and brake handles, headlining, and a bonnet you can see over;
* **chase** — a drone off the loco's shoulder, high enough to clear the coach
  roofs and pitched down the line so you can still drive on it;
* **lineside** — stand off the track and watch the whole 200–400 m rake go by.

The HUD carries the analogue speedo, the power and brake notch levers, lamp
repeaters (doors, signal, limit, horn), the next stop with distance and the
green-zone chip, the score and the run's message log.

## Controls

| Input | Action |
| --- | --- |
| `W` / `↑` | power notch up (8 notches) |
| `S` / `↓` | brake notch up (8 notches) |
| `X` | release both levers |
| `Space` | emergency brake |
| `D` | doors, at a platform |
| `H` | horn (two-tone, synthesised) |
| `C` | cycle camera |
| `Tab` | take the next train (the cab comes with you) |
| `T` | hand over to the autopilot |
| `P` / `Esc` | pause |
| `1` `2` `3` | jump straight to cab / chase / lineside |

## How it works

* `src/cities.js` — the four cities: three lines each with their stations,
  palettes, seeds, and the three rakes (EMU / ICF / LHB) a city owns.
* `src/world.js` — grows the network from a city seed: one base alignment, then
  each line offset into its own corridor, station records per line, signals,
  and a fleet with routes resolved in the direction of travel.
* `src/sim.js` — metres per second throughout; notched driving, braking-curve
  AI that stops at the board, block signals that consider only the asking
  direction, doors that release only at a platform, green-zone scoring with
  penalties and bonuses, and traffic that holds its distance.
* `src/scene3d.js` — the 3D world: ballast, rails, instanced sleepers, catenary
  masts and wire, platforms with canopy and name boards tinted to the line,
  station buildings (only at major stations), lineside trees and town blocks,
  signal lamps, instanced rolling stock, and the cab interior.
* `src/app.js` — boot, city and Drive menus, input, cameras, HUD, horn, pause,
  run summary.

Rendering is plain three.js WebGL, one draw call per coach part thanks to
instancing. The tests boot the real app headlessly with a renderer stub and the
scene tests count meshes and triangles in every city, so an empty world cannot
pass. Booting a second app detaches the first one's listeners, so the menu
stays driveable when the page is re-booted.

## auth.py

The lean password/session module, kept from the earlier review work: PBKDF2 with
a per-user salt, constant-time comparison, a decoy hash so unknown usernames cost
the same as known ones, bounded lockout counters and opaque expiring sessions.
27 `unittest` cases, including timing and lockout-expiry behaviour.
