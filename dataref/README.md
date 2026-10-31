# dataref — real-geography reference data

Reference data used to rebuild the game's routes on real geography. The game
ships its own original data structures (`js/data/geo.js`, `js/data/routes.js`);
nothing here is loaded at runtime — it is build/reference material only.

## stations.json

Source: [prasenjit-27/Indian-Railway-Data](https://github.com/prasenjit-27/Indian-Railway-Data)
(open, OSM-derived dataset of Indian Railways stations, **MIT licensed**).
8,990 records: `{ code, name, state, zone, address, coordinates { latitude, longitude } }`.

Notes for reuse:

- Contains `(0, 0)` placeholder-coordinate records (null island) — filter
  `abs(lat) > 0.01 or abs(lon) > 0.01` before matching.
- Names are UPPERCASE with dataset-specific spellings (e.g. `MUMBAI CST`,
  `DOMBIVLI CTL`, `HIND MOTOR`, `CHANDAN NAGAR`, `DELHI SHAHDARA`), so an
  alias + junction-variant (`X`, `X Junction`, `X Jn`) pass is required.
- State field is mostly empty — do not rely on it for filtering.

## geo_final.json

Final output of the matching pipeline (v5): per-route station lists with
matched/interpolated `lat`, `lon`, real cumulative `km` (straight-line legs ×
per-route winding factor) and hand-anchored realistic `elev` (metres).
Consumed to generate `js/data/geo.js` (`const GEO`), which the engine applies
when station counts match: true distances, bearings, gradients, rescaled
tunnels/viaducts/crossings, rebuilt timetables.

Sanity checks vs reality: Nilgiri Mettupalayam→Ooty 46.3 km (real ≈ 46),
Konkan Ratnagiri→Madgaon 270 rail-km, Bhor Ghat CSMT→Pune 201 km (real ≈ 192).

`geo_routes.json` (v1–v3 intermediates) was removed as obsolete.
