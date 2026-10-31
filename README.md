# भारत रेल सिम · Bharat Rail Sim

A browser-based **Indian Railways train simulator** — two ways to play:

## 🛰️ Open World (3D) — `open-world.html`
True-3D regions built with Three.js (vendored, no CDN). Design ideas borrowed from the best in the genre: cab immersion from **Train Sim World**, free-roam + free camera from **Trainz**, sandbox vibe from **Derail Valley**, Indian roster & station culture from **Indian Train Simulator**, physics discipline from **OpenRails**.

- Winding 3D alignments over procedural terrain — coastlines (Mumbai, Konkan), the Hooghly, tea hills, the Bhor Ghat, windmill plains
- Tunnels with portals, viaducts with piers over valleys, platforms, canopies, catenary, level crossings with animated barriers
- **4 cameras**: driver's cab (C key), chase, free-orbit drone (drag + wheel), trackside posts
- **Free roam** on any line — no objectives, just drive the region; or **Service runs** with the full timetable & scoring
- Day/night with sun/moon/stars, monsoon with rain, lightning and slippery rail, headlamps, station lamps
- AI traffic: chase trains, passing trains on the far track, single-line loop crossings
- Same signalling, physics, audio and scoring core as the classic game (shared modules)

## 🎞️ Classic 2D — `classic.html`
The original side-on driving sim: full timetables, berth scoring, SPAD enforcement, spoken announcements.

## Routes (9 lines, 10 services) — both games

| Route | Line | Traction | Highlights |
|---|---|---|---|
| Mumbai Western | Churchgate → Virar (64 km, 28 stn) | 12-car WR EMU | Fast local, sea views, skyline |
| Mumbai Central | CSMT → Kalyan (54 km, 26 stn) | 15-car CR EMU | Parsik tunnel, Thane creek viaduct |
| Chennai | Beach → Tambaram (28 km, 18 stn) | 9-car EMU | Dense halts — a driver's workout |
| Kolkata | Howrah → Bandel (41 km, 17 stn) | 12-car EMU | Hooghly riverside, colonial towns |
| Delhi NCR | New Delhi → Ghaziabad (20 km) | MEMU | Easy intro run |
| Mysuru | Mysuru → Chamarajanagar (61 km) | DMU | Single line, windmills, loop crossing |
| Konkan Railway | Ratnagiri → Madgaon (195 km) | WDP-4D express / Vande Bharat | 14 tunnels, sea cliffs, single-line crossings |
| Nilgiri MR | Mettupalayam → Ooty (46 km) | X-class rack steam | 1-in-12 gradients, rack rail, coffee hills |
| Bhor Ghat | CSMT → Pune (192 km) | WAP-7 + Deccan Queen | The ghat climb, monsoon waterfalls country |

Plus AI traffic: chase trains, opposing expresses, and BOXN freight rakes.

## Systems

- **Physics** — power/tractive-effort curves per traction type, jerk-limited forces, Davis resistance, gradient forces, adhesion loss in monsoon, rack-mode for the NMR
- **Signalling** — IR-style 4-aspect colour lights (G / YY / Y / R) with track-block occupancy, station home & starter signals, SPAD enforcement
- **Single line** — tokenless working with loop crossings: opposing trains hold at crossing stations until you pass
- **Timetable** — full arrival/departure board with live actuals and punctuality scoring
- **Stations** — berth accuracy scoring, boarding with door beeps & guard whistle, missed-halt penalties
- **Audio** — procedurally synthesised: EMU motor whine, diesel thrash, steam chuffs synced to wheel revolution, brake squeal, IR announcement chime, horns, thunder; plus spoken station announcements via speech synthesis (English + local language where the browser has a voice)
- **Weather & time** — monsoon rain with lightning, or pick dawn / noon / dusk / night

## Controls

| Key | Action |
|---|---|
| `↑` / `W` | Notch up (throttle) |
| `↓` / `S` | Notch down / idle |
| `→` / `D` | Brake (apply) |
| `←` / `A` | Brake (release) |
| `Space` | Emergency brake |
| `H` | Horn (sound it near level crossings for bonus) |
| `P` | Pantograph up/down (traction off when down!) |
| `T` | Time compression 1×/2×/4×/8× |
| `Tab` | Timetable board |
| `M` | Route map |
| `+` / `−` | Zoom camera |
| `Esc` | Pause |

Touch buttons for throttle/brake/horn/emergency are on screen for mobile.

## Run

```bash
npm start          # serves on http://localhost:8080  (index → launcher)
npm run qa         # classic: autopilot drives every service end-to-end
npm run shot       # classic: render smoke test across all routes & times of day
npm run qa3d       # 3D: world geometry + sim integration tests (headless)
```

## Controls — 3D

| Key | Action |
|---|---|
| `↑`/`↓` | Throttle notch up / down |
| `←`/`→` | Brake apply / release (power bleeds the brake) |
| `Space` | Emergency |
| `C` / `1-4` | Camera: cab · chase · orbit · trackside |
| drag + wheel | Orbit & zoom (orbit cam) |
| `H` | Horn · `P` pantograph · `T` time-warp |
| `Tab` / `M` | Timetable board / route map · `Esc` pause |

## Scoring

Final grade blends punctuality, berth accuracy, signal discipline (SPADs), speed-limit adherence, smoothness (don't jump the brakes or depart with doors open), and crossing-horn bonus. Best scores are saved locally.

*Distances and timetables are approximate and lovingly simplified. Not affiliated with Indian Railways.*
