# भारत रेल सिम · Bharat Rail Sim

A browser-based **3D Indian Railways train simulator**, rebuilt on **real geography** — every route is laid out from real station coordinates, so distances, bearings, curves and station spacing match the real railway. Built with Three.js (vendored, no CDN, fully self-contained).

Design ideas borrowed from the best in the genre: cab immersion from **Train Sim World**, free-roam + free camera from **Trainz**, sandbox vibe from **Derail Valley**, Indian roster & station culture from **Indian Train Simulator**, physics discipline from **OpenRails**. All content, data structures and code are original.

## Run it

```bash
npm start          # python3 http.server on :8080
# open http://localhost:8080/            (the 3D game)
# run headless QA:  npm run qa           (node test/qa3d.js)
```

## Real-geo data layer

Station coordinates come from the open, OSM-derived [`prasenjit-27/Indian-Railway-Data`](https://github.com/prasenjit-27/Indian-Railway-Data) dataset (8,990 stations), matched to route stations by a multi-pass matcher (aliases, junction variants, null-island filtering, anchor continuity, per-route distance gating, interpolation between anchors). Reference data and the final matcher output live in `dataref/`.

- **True distances** — e.g. Konkan Ratnagiri→Madgaon 270 rail-km (straight-line × winding factor), Nilgiri Mettupalayam→Ooty 46.3 km vs 46 km real
- **Real elevations** — Nilgiri climb 330 m → Ooty ~1955 m (rack country), Bhor Ghat CSMT 8 m → Pune 560 m, Mysuru 763 → 812 m
- **Real bends** — the 3D path bends through the actual station anchors (equirectangular projection), with curvature eased to real-rail minima (~320 m radius)
- Gradients, timetables, tunnel/viaduct/crossing placements and speed limits all derive from the geo data

## Routes (9 lines)

| Route | Line | Traction | Highlights |
|---|---|---|---|
| Mumbai Western | Churchgate → Virar (66 km, 28 stn) | 12-car WR EMU | Fast local, sea views, skyline |
| Mumbai Central | CSMT → Kalyan (56 km, 26 stn) | 15-car CR EMU | Parsik tunnel, Thane creek viaduct |
| Chennai | Beach → Tambaram (29 km, 18 stn) | 9-car EMU | Dense halts — a driver's workout |
| Kolkata | Howrah → Bandel (43 km, 17 stn) | 12-car EMU | Hooghly riverside, colonial towns |
| Delhi NCR | New Delhi → Ghaziabad (28 km) | MEMU | Easy intro run |
| Mysuru | Mysuru → Chamarajanagar (68 km) | DMU | Single line, windmills, loop crossing |
| Konkan Railway | Ratnagiri → Madgaon (270 km) | WDP-4D express / Vande Bharat | 14 tunnels, sea cliffs, single-line crossings |
| Nilgiri MR | Mettupalayam → Ooty (46 km) | X-class rack steam | 1-in-12 gradients, rack rail, coffee hills |
| Bhor Ghat | CSMT → Pune (201 km) | WAP-7 + Deccan Queen | The ghat climb, monsoon waterfalls country |

## Features

- **True-3D world** — winding geo-accurate alignments over procedural terrain: coastlines (Mumbai, Konkan), the Hooghly, tea hills, the Bhor Ghat, windmill plains
- **Infrastructure** — tunnels with portals, viaducts with piers, platforms & canopies, catenary, level crossings with animated barriers
- **4 cameras** — driver's cab (C key), chase, free-orbit drone (drag + wheel), trackside posts
- **Free roam** on any line, or **Service runs** with full timetable & punctuality scoring
- **Day/night + monsoon** — sun/moon/stars, rain, lightning, slippery rail, headlamps, station lamps
- **AI traffic** — chase trains, passing expresses on the far track, single-line loop crossings at crossing stations
- **Physics** — power/tractive-effort curves per traction type, jerk-limited forces, Davis resistance, gradient forces, adhesion loss in monsoon, rack mode for the NMR
- **Signalling** — IR-style 4-aspect colour lights (G / YY / Y / R) with track-block occupancy, home & starter signals, SPAD enforcement

## Controls

`↑↓` throttle · `←→` brake · `Space` emergency · `H` horn · `C` / `1-4` cameras · drag orbit · wheel zoom · `T` time warp · `Tab` station board · `M` map · `P` pantograph · `Esc` pause

## Project layout

```
index.html            game entry (menu, HUD shell)
src/                  the engine, rebuilt from scratch:
                        util.js      math, formatting, route queries
                        signals.js   4-aspect blocks + single-line sections
                        physics.js   train dynamics + AI drivers
                        world.js     geo-anchored alignment, terrain, layout
                        game.js      orchestration, traffic, scoring (headless)
                        audio.js     procedural WebAudio
                        render3d.js  three.js renderer
                        main.js      loop, cameras, input, HUD
js/data/              routes, trains, themes + geo.js (real station coordinates)
vendor/               vendored three.js r152 (self-contained, no CDN)
test/qa3d.js          headless QA: geometry, physics, signalling, 4 service smokes
dataref/              open-data reference + final matcher output
```
