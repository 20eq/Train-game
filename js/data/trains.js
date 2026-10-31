'use strict';
/* ============================================================
   Bharat Rail Sim — rolling stock & traction data
   ============================================================ */
/* car kinds: dtc driving-trailer(cab) | mc motor coach | tc trailer | memu-m motor |
   dmu-p power pack car | loco-e electric | loco-d diesel | steam | tender |
   coach types: ac1 ac2 ac3 sl gs pc dq (Deccan Queen) vb rack boxn flat tank */
const CAR_MASS = { dtc: 39, mc: 55, tc: 42, 'memu-m': 50, 'dmu-p': 46, 'loco-e': 123, 'loco-d': 117, wdg4: 135, steam: 42, tender: 25, ac1: 46, ac2: 48, ac3: 50, sl: 48, gs: 44, pc: 46, dq: 44, vb: 48, rack: 20, boxn: 78, flat: 50, tank: 70 };

function emuCars(n, livery, pattern) {
  // pattern e.g. 12-car: D M T T M T M T T M T D
  const pats = {
    12: ['dtc', 'mc', 'tc', 'tc', 'mc', 'tc', 'mc', 'tc', 'tc', 'mc', 'tc', 'dtc'],
    15: ['dtc', 'mc', 'tc', 'tc', 'mc', 'tc', 'mc', 'tc', 'tc', 'mc', 'tc', 'tc', 'mc', 'tc', 'dtc'],
    9: ['dtc', 'mc', 'tc', 'mc', 'tc', 'mc', 'tc', 'mc', 'dtc'],
  };
  return pats[n].map((k) => ({ k, len: 23, livery, panto: k === 'mc' }));
}
function coach(kind, livery, len) { return { k: kind, len: len || (livery === 'icf' ? 23 : 24), livery }; }

const TRAINS = {
  wr_emu12: {
    id: 'wr_emu12', name: 'WR 12-Car Local EMU', cls: 'EMU', sound: 'emu', horn: 'emu',
    desc: 'Siemens 3-phase EMU. Sharp acceleration, regenerative brakes — the everyday workhorse of Mumbai.',
    cars: emuCars(12, 'wr_violet'), power: 3820e3, fMax: 430e3, vmax: 100 * MPS,
    brake: 0.95, emerg: 1.35, jerk: 0.75, pantoCars: true,
  },
  cr_emu15: {
    id: 'cr_emu15', name: 'CR 15-Car Local EMU', cls: 'EMU', sound: 'emu', horn: 'emu',
    desc: 'Central Railway 15-car local. Heavy, powerful, always crowded.',
    cars: emuCars(15, 'cr_crimson'), power: 4700e3, fMax: 480e3, vmax: 100 * MPS,
    brake: 0.9, emerg: 1.3, jerk: 0.7, pantoCars: true,
  },
  ch_emu9: {
    id: 'ch_emu9', name: 'Chennai 9-Car EMU', cls: 'EMU', sound: 'emu', horn: 'emu',
    desc: 'Southern Railway EMU in its classic dark green livery. Beach–Tambaram sector veteran.',
    cars: emuCars(9, 'ch_green'), power: 2100e3, fMax: 300e3, vmax: 85 * MPS,
    brake: 0.9, emerg: 1.3, jerk: 0.7, pantoCars: true,
  },
  kol_emu12: {
    id: 'kol_emu12', name: 'Eastern Rly EMU (12-car)', cls: 'EMU', sound: 'emu', horn: 'emu',
    desc: 'Howrah main-line EMU. 25 kV AC, twin-beam headlamps, packed with office-goers.',
    cars: emuCars(12, 'kol_blue'), power: 3600e3, fMax: 400e3, vmax: 100 * MPS,
    brake: 0.85, emerg: 1.25, jerk: 0.65, pantoCars: true,
  },
  memu_del: {
    id: 'memu_del', name: 'MEMU (Delhi division)', cls: 'MEMU', sound: 'memu', horn: 'loco',
    desc: 'Mainline Electric Multiple Unit — EMU comfort on long suburban runs.',
    cars: (() => { const p = ['dtc', 'tc', 'mc', 'tc', 'tc', 'mc', 'tc', 'dtc']; return p.map((k) => ({ k: k === 'mc' ? 'memu-m' : k, len: 23, livery: 'memu', panto: k === 'mc' })); })(),
    power: 2300e3, fMax: 245e3, vmax: 105 * MPS, brake: 0.8, emerg: 1.2, jerk: 0.6, pantoCars: true,
  },
  dmu_mys: {
    id: 'dmu_mys', name: 'DMU (Mysuru division)', cls: 'DMU', sound: 'dmu', horn: 'loco',
    desc: 'Non-electrified sector Diesel Multiple Unit. Under the windmills of Nanjangud.',
    cars: [
      { k: 'dmu-p', len: 23, livery: 'dmu', cab: 1 }, coach('gs', 'dmu', 23), { k: 'dmu-p', len: 23, livery: 'dmu', cab: -1 },
    ],
    power: 940e3, fMax: 100e3, vmax: 100 * MPS, brake: 0.75, emerg: 1.15, jerk: 0.55,
  },
  konkan_exp: {
    id: 'konkan_exp', name: 'Konkan Express · WDP-4D + LHB', cls: 'Express', sound: 'diesel', horn: 'loco',
    desc: 'ESG WDP-4D hauled express on the scenic Konkan line — tunnels, creeks and the Arabian Sea.',
    cars: [{ k: 'loco-d', len: 26.4, livery: 'wdp4d' },
      coach('gs', 'lhb'), coach('sl', 'lhb'), coach('sl', 'lhb'), coach('ac3', 'lhb'), coach('ac3', 'lhb'), coach('ac2', 'lhb'),
      coach('pc', 'lhb'), coach('sl', 'lhb'), coach('sl', 'lhb'), coach('sl', 'lhb'), coach('ac3', 'lhb'), coach('ac3', 'lhb'),
      coach('ac2', 'lhb'), coach('ac2', 'lhb'), coach('ac1', 'lhb'), coach('gs', 'lhb')],
    power: 3350e3, fMax: 400e3, vmax: 120 * MPS, brake: 0.55, emerg: 0.95, jerk: 0.4,
  },
  vb_express: {
    id: 'vb_express', name: 'Vande Bharat Express', cls: 'Express', sound: 'emu', horn: 'vb',
    desc: 'Train-18 set. Sleek acceleration, aircraft-style interiors — India\'s flagship train.',
    cars: [{ k: 'dtc', len: 24, livery: 'vb', cab: 1 }, coach('vb', 'vb'), { k: 'mc', len: 24, livery: 'vb', panto: true },
      coach('vb', 'vb'), { k: 'mc', len: 24, livery: 'vb', panto: true }, coach('vb', 'vb'),
      { k: 'mc', len: 24, livery: 'vb', panto: true }, { k: 'dtc', len: 24, livery: 'vb', cab: -1 }],
    power: 6800e3, fMax: 350e3, vmax: 130 * MPS, brake: 1.0, emerg: 1.4, jerk: 0.85, pantoCars: true,
  },
  deccan_queen: {
    id: 'deccan_queen', name: 'Deccan Queen · WAP-7 + heritage rake', cls: 'Express', sound: 'electric', horn: 'loco',
    desc: 'India\'s beloved 1930 premier train. WAP-7 over the Bhor Ghat to Pune.',
    cars: [{ k: 'loco-e', len: 20.6, livery: 'wap7' },
      coach('dq', 'icf'), coach('dq', 'icf'), coach('dq', 'icf'), coach('dq', 'icf'), coach('dq', 'icf'),
      coach('pc', 'icf'), coach('dq', 'icf'), coach('dq', 'icf'), coach('dq', 'icf'), coach('dq', 'icf'),
      coach('dq', 'icf'), coach('dq', 'icf'), coach('dq', 'icf'), coach('dq', 'icf'), coach('dq', 'icf'),
      coach('dq', 'icf'), coach('gs', 'icf')],
    power: 4700e3, fMax: 322e3, vmax: 130 * MPS, brake: 0.5, emerg: 0.9, jerk: 0.35,
  },
  nmr_x: {
    id: 'nmr_x', name: 'NMR X-Class Rack Steam', cls: 'Steam', sound: 'steam', horn: 'steam',
    desc: '1908 Swiss-designed X class on the Abt rack. Mettupalayam → Ooty, 1-in-12 gradients.',
    cars: [{ k: 'steam', len: 11, livery: 'nmr' }, { k: 'tender', len: 8, livery: 'nmr' },
      coach('rack', 'nmr'), coach('rack', 'nmr'), coach('rack', 'nmr'), coach('rack', 'nmr'), coach('rack', 'nmr')],
    power: 625e3, fMax: 158e3, vmax: 33 * MPS, brake: 0.6, emerg: 1.0, jerk: 0.35, rack: true,
  },
  wdg_freight: {
    id: 'wdg_freight', name: 'WDG-4 Freight (BOXN rake)', cls: 'Freight', sound: 'diesel', horn: 'loco',
    desc: 'Heavy freight — scenery and signalling obstruction, not for the impatient.',
    cars: (() => { const c = [{ k: 'wdg4', len: 22.8, livery: 'wdg4' }]; for (let i = 0; i < 40; i++) c.push({ k: 'boxn', len: 13.7, livery: 'boxn' }); return c; })(),
    power: 4000e3, fMax: 520e3, vmax: 75 * MPS, brake: 0.28, emerg: 0.5, jerk: 0.2, aiOnly: true,
  },
};

/* derive mass & length */
for (const t of Object.values(TRAINS)) {
  t.mass = 0; t.length = 0;
  for (const c of t.cars) { c.mass = (CAR_MASS[c.k] || 45) * 1000; t.mass += c.mass; t.length += c.len; }
  t.length += (t.cars.length - 1) * 0.7; // gangways
  if (!t.aiOnly) t.aiOnly = false;
}
