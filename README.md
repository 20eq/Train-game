# भारत रेल सिम · Bharat Rail Sim

A browser-based **Indian Railways train simulator** built with pure HTML5 Canvas + WebAudio — no engine, no assets, everything is procedurally drawn and synthesised.

## Routes (9 lines, 10 services)

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
npm start          # serves on http://localhost:8080
npm run qa         # headless autopilot drives every service end-to-end
npm run shot       # render smoke test across all routes & times of day
```

## Scoring

Final grade blends punctuality, berth accuracy, signal discipline (SPADs), speed-limit adherence, smoothness (don't jump the brakes or depart with doors open), and crossing-horn bonus. Best scores are saved locally.

*Distances and timetables are approximate and lovingly simplified. Not affiliated with Indian Railways.*
