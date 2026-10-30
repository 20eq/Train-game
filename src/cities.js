/**
 * Four cities, three real lines each, and the stock that runs on them.
 *
 * Every line carries its own station list, its own alignment and its own
 * traffic, so Mumbai reads as Western/Central/Harbour rather than one generic
 * track with different labels. Services pick a line: the suburban local runs
 * the line it really runs, and the express leaves from the terminus it really
 * leaves from.
 *
 * `rolling` holds the three rakes a city actually turns out:
 *   emu — the suburban rake (doors, cab ends, band colour)
 *   icf — the loco-hauled passenger rake: cream and ribbed
 *   lhb — the express rake: sealed windows, full-length roof
 */

const ROLLING = {
  mumbai: {
    emu: { body: '#e4e7e9', stripe: '#243b8f', roof: '#a6adb2', door: '#243b8f', end: '#f2c53d', trim: '#39474f' },
    icf: { body: '#f0e6cf', stripe: '#b8342a', roof: '#7d2a22', door: '#b8342a', end: '#b8342a', trim: '#5c2c26' },
    lhb: { body: '#25407c', stripe: '#eef2f8', roof: '#1b2f5c', door: '#25407c', end: '#25407c', trim: '#93a1b6' },
  },
  delhi: {
    emu: { body: '#e7e9e6', stripe: '#b8342a', roof: '#a7aaa4', door: '#b8342a', end: '#f0d35c', trim: '#3c4448' },
    icf: { body: '#efe4cc', stripe: '#2f64a8', roof: '#5a6f8c', door: '#2f64a8', end: '#2f64a8', trim: '#3a4a60' },
    lhb: { body: '#8a3f2e', stripe: '#f4e6d0', roof: '#65301f', door: '#78351f', end: '#8a3f2e', trim: '#c9a276' },
  },
  kolkata: {
    emu: { body: '#e3e6e2', stripe: '#1f5c99', roof: '#a3a8a5', door: '#1f5c99', end: '#e8d47a', trim: '#2b3a46' },
    icf: { body: '#f1e8d4', stripe: '#1f5c99', roof: '#4e6478', door: '#1f5c99', end: '#1f5c99', trim: '#33475c' },
    lhb: { body: '#33507c', stripe: '#f0eee4', roof: '#243a5c', door: '#2a4468', end: '#33507c', trim: '#a8b6c6' },
  },
  chennai: {
    emu: { body: '#e6e8e1', stripe: '#2f7a4f', roof: '#a5aaa1', door: '#2f7a4f', end: '#f0d35c', trim: '#33473a' },
    icf: { body: '#f2ead6', stripe: '#2f7a4f', roof: '#55684f', door: '#2f7a4f', end: '#2f7a4f', trim: '#3a4a3c' },
    lhb: { body: '#4a5f8a', stripe: '#f1f2ea', roof: '#34456a', door: '#3c4f74', end: '#4a5f8a', trim: '#aeb9cd' },
  },
};

export const CITIES = [
  {
    id: 'mumbai',
    city: 'Mumbai',
    line: 'Western Line',
    tagline: 'Three lines, twelve-car locals, the Arabian Sea on the right',
    blurb: 'Western, Central and Harbour. 12-car rakes with blue doors, packed platforms, and a 100 km/h run to Virar.',
    seed: 7,
    palette: {
      skyTop: '#5d9ec7', skyLow: '#e8e2cb', fog: '#d9dfd8', sun: '#fff2cf',
      ground: ['#8fa26a', '#9cae74', '#83975f', '#a8b781'],
      ballast: '#8b8377', sleepers: '#5c564c', rail: '#b9bcb8',
      platform: '#d8cfb8', building: '#c2a88a', roof: '#a97560',
    },
    lines: [
      {
        id: 'western',
        name: 'Western Line',
        colour: '#243b8f',
        note: 'Churchgate to Virar, fast locals down the coast',
        offset: 0,
        stations: [
          ['Churchgate', 0.01], ['Marine Lines', 0.05], ['Charni Road', 0.09],
          ['Grant Road', 0.13], ['Mumbai Central', 0.18], ['Mahalaxmi', 0.23],
          ['Lower Parel', 0.28], ['Dadar', 0.34], ['Matunga Road', 0.39],
          ['Mahim', 0.44], ['Bandra', 0.49], ['Santacruz', 0.55],
          ['Vile Parle', 0.6], ['Andheri', 0.65], ['Jogeshwari', 0.7],
          ['Goregaon', 0.75], ['Malad', 0.8], ['Kandivali', 0.85],
          ['Borivali', 0.9], ['Dahisar', 0.94], ['Mira Road', 1],
        ],
      },
      {
        id: 'central',
        name: 'Central Line',
        colour: '#b8342a',
        note: 'CSMT up through Dadar, Kurla and Thane to Kalyan',
        offset: 340,
        stations: [
          ['Chhatrapati Shivaji Maharaj Terminus', 0.01], ['Masjid', 0.05],
          ['Sandhurst Road', 0.09], ['Byculla', 0.13], ['Chinchpokli', 0.17],
          ['Currey Road', 0.21], ['Parel', 0.25], ['Dadar', 0.3],
          ['Matunga', 0.35], ['Sion', 0.4], ['Kurla', 0.45],
          ['Vidyavihar', 0.5], ['Ghatkopar', 0.55], ['Vikhroli', 0.6],
          ['Bhandup', 0.65], ['Mulund', 0.7], ['Thane', 0.76],
          ['Diva', 0.83], ['Dombivli', 0.89], ['Kalyan', 0.96],
        ],
      },
      {
        id: 'harbour',
        name: 'Harbour Line',
        colour: '#c99a1e',
        note: 'The dockyard run: CSMT, Wadala, Kurla, Vashi, Panvel',
        offset: 680,
        stations: [
          ['Chhatrapati Shivaji Maharaj Terminus', 0.01], ['Masjid', 0.06],
          ['Dockyard Road', 0.11], ['Reay Road', 0.16], ['Cotton Green', 0.21],
          ['Sewri', 0.27], ['Wadala Road', 0.33], ['Chunabhatti', 0.39],
          ['Kurla', 0.45], ['Tilak Nagar', 0.5], ['Chembur', 0.56],
          ['Ghatkopar', 0.62], ['Vashi', 0.7], ['Nerul', 0.78],
          ['Belapur', 0.86], ['Kharghar', 0.92], ['Panvel', 0.99],
        ],
      },
    ],
    rolling: ROLLING.mumbai,
    stock: {
      local: { cars: 12, style: 'emu', capacity: 110 },
      passenger: { cars: 10, style: 'icf', capacity: 90 },
      express: { cars: 18, style: 'lhb', capacity: 72 },
    },
    services: services('mumbai', [
      { id: 'local', line: 'western', name: 'Western Line Local', kind: 'Suburban EMU · 12 cars',
        stock: 'emu', cars: 12, loco: null, stops: 'all', vmax: 21, accel: 1.45, brake: 1.95,
        blurb: 'A 12-car rake on the fast line. Doors every stop, quick off the mark, packed at Dadar.' },
      { id: 'passenger', line: 'central', name: 'Panvel Passenger', kind: 'ICF rake · WAP-4',
        stock: 'icf', cars: 10, loco: 'WAP4', stops: 'all', vmax: 23, accel: 0.9, brake: 1.5,
        blurb: 'Ten ICF coaches behind a WAP-4. Heavy, slow away from the platform, and she stops everywhere.' },
      { id: 'express', line: 'central', name: 'Mumbai Rajdhani', kind: 'LHB rake · WAP-7',
        stock: 'lhb', cars: 18, loco: 'WAP7', stops: 'majors', vmax: 28, accel: 1.05, brake: 1.6,
        blurb: 'Eighteen LHB coaches out of CSMT. Few stops, high speed, and the board decides your score.' },
    ]),
  },
  {
    id: 'delhi',
    city: 'Delhi',
    line: 'Ring Railway',
    tagline: 'The loop, the Gurgaon road and the Ghaziabad run',
    blurb: 'Red-banded rakes, wide open flats, hazy afternoons and a 20-coach Rajdhani.',
    seed: 23,
    palette: {
      skyTop: '#7ba7c9', skyLow: '#f0e2c2', fog: '#e2dcc8', sun: '#fff0c8',
      ground: ['#b5a878', '#c0b184', '#a89c6e', '#c8b98f'],
      ballast: '#94897a', sleepers: '#5a5449', rail: '#c3c4bd',
      platform: '#ded5c0', building: '#cbb695', roof: '#a5846a',
    },
    lines: [
      {
        id: 'ring',
        name: 'Ring Railway',
        colour: '#b8342a',
        note: 'The loop around the capital, Nizamuddin to Sarai Rohilla',
        offset: 0,
        stations: [
          ['Hazrat Nizamuddin', 0.01], ['Lajpat Nagar', 0.07], ['Sewa Nagar', 0.13],
          ['Lodi Colony', 0.19], ['Safdarjung', 0.25], ['Sarojini Nagar', 0.31],
          ['INA', 0.37], ['Dhaula Kuan', 0.43], ['Delhi Cantt', 0.5],
          ['Patel Nagar', 0.58], ['Dayabasti', 0.66], ['Sabzi Mandi', 0.74],
          ['Kishanganj', 0.82], ['Sarai Rohilla', 0.9], ['Delhi Junction', 0.97],
        ],
      },
      {
        id: 'gurgaon',
        name: 'Gurgaon Line',
        colour: '#2f64a8',
        note: 'New Delhi down the Rewari road through Gurgaon',
        offset: 340,
        stations: [
          ['New Delhi', 0.01], ['Delhi Sarai Rohilla', 0.08], ['Naraina Vihar', 0.15],
          ['Delhi Cantt', 0.23], ['Palam', 0.31], ['Shahabad Mohammadpur', 0.39],
          ['Bijwasan', 0.47], ['Gurgaon', 0.57], ['Basai Dhankot', 0.66],
          ['Garhi Harsaru', 0.75], ['Pataudi Road', 0.85], ['Rewari', 0.97],
        ],
      },
      {
        id: 'ghaziabad',
        name: 'Ghaziabad Line',
        colour: '#c99a1e',
        note: 'Delhi Junction east to Sahibabad, Ghaziabad and Meerut',
        offset: 680,
        stations: [
          ['Delhi Junction', 0.01], ['Delhi Shahdara', 0.08], ['Vivek Vihar', 0.15],
          ['Sahibabad', 0.23], ['Ghaziabad', 0.32], ['New Ghaziabad', 0.4],
          ['Guldhar', 0.47], ['Duhai', 0.54], ['Muradnagar', 0.62],
          ['Modinagar', 0.72], ['Partapur', 0.82], ['Meerut Cantt', 0.91],
          ['Meerut City', 0.98],
        ],
      },
    ],
    rolling: ROLLING.delhi,
    stock: {
      local: { cars: 8, style: 'emu', capacity: 116 },
      passenger: { cars: 10, style: 'icf', capacity: 90 },
      express: { cars: 20, style: 'lhb', capacity: 72 },
    },
    services: services('delhi', [
      { id: 'local', line: 'ring', name: 'Ring Railway Local', kind: 'Suburban EMU · 8 cars',
        stock: 'emu', cars: 8, loco: null, stops: 'all', vmax: 20, accel: 1.4, brake: 1.9,
        blurb: 'The loop line around the capital. Short rake, tight curves, a platform every few minutes.' },
      { id: 'passenger', line: 'gurgaon', name: 'Rewari Passenger', kind: 'ICF rake · WAP-4',
        stock: 'icf', cars: 10, loco: 'WAP4', stops: 'all', vmax: 23, accel: 0.9, brake: 1.5,
        blurb: 'Out of New Delhi down the Rewari road, stopping at every halt through Gurgaon.' },
      { id: 'express', line: 'ghaziabad', name: 'Bhopal Shatabdi', kind: 'LHB rake · WAP-5',
        stock: 'lhb', cars: 20, loco: 'WAP5', stops: 'majors', vmax: 29, accel: 1.1, brake: 1.65,
        blurb: 'A WAP-5 and twenty LHB coaches. The fastest thing in this game, and it barely stops.' },
    ]),
  },
  {
    id: 'kolkata',
    city: 'Kolkata',
    line: 'Circular Railway',
    tagline: 'The circular line, the Hooghly bank and the Sealdah locals',
    blurb: 'White and blue rakes, wet platforms, and the riverside curve into Ballygunge.',
    seed: 41,
    palette: {
      skyTop: '#6fa3bf', skyLow: '#e4e6cf', fog: '#d6ded6', sun: '#fdf0cd',
      ground: ['#7f9a63', '#8ea96f', '#73905a', '#9db47c'],
      ballast: '#867f74', sleepers: '#555046', rail: '#b6b9b4',
      platform: '#d5cdb9', building: '#c6ac8d', roof: '#96807a',
    },
    lines: [
      {
        id: 'circular',
        name: 'Circular Railway',
        colour: '#1f5c99',
        note: 'Dum Dum round the maidan to Majerhat',
        offset: 0,
        stations: [
          ['Dum Dum', 0.01], ['Belgachia', 0.07], ['Tala', 0.13], ['Bagbazar', 0.19],
          ['Sovabazar', 0.25], ['Bara Bazar', 0.31], ['Prinsep Ghat', 0.39],
          ['Eden Gardens', 0.47], ['Ballygunge', 0.56], ['Park Circus', 0.64],
          ['Santoshpur', 0.72], ['Brace Bridge', 0.81], ['Majerhat', 0.9],
          ['New Alipore', 0.96],
        ],
      },
      {
        id: 'sealdah',
        name: 'Sealdah South',
        colour: '#c99a1e',
        note: 'Sealdah down through Ballygunge and Jadavpur to Baruipur',
        offset: 340,
        stations: [
          ['Sealdah', 0.01], ['Park Circus', 0.08], ['Ballygunge', 0.15],
          ['Dhakuria', 0.22], ['Jadavpur', 0.3], ['Bagha Jatin', 0.38],
          ['Garia', 0.46], ['Sonarpur', 0.55], ['Narendrapur', 0.63],
          ['Baruipur', 0.73], ['Dakshin Barasat', 0.83], ['Jaynagar Majilpur', 0.92],
          ['Lakshmikantapur', 0.99],
        ],
      },
      {
        id: 'howrah',
        name: 'Howrah Main',
        colour: '#2f7a4f',
        note: 'Howrah up the right bank to Serampore and Bandel',
        offset: 680,
        stations: [
          ['Howrah', 0.01], ['Liluah', 0.08], ['Belur Math', 0.15], ['Bally', 0.22],
          ['Uttarpara', 0.29], ['Hindmotor', 0.36], ['Konnagar', 0.43],
          ['Rishra', 0.5], ['Serampore', 0.58], ['Sheoraphuli', 0.66],
          ['Chandernagore', 0.74], ['Chinsurah', 0.82], ['Hooghly', 0.9],
          ['Bandel', 0.98],
        ],
      },
    ],
    rolling: ROLLING.kolkata,
    stock: {
      local: { cars: 9, style: 'emu', capacity: 112 },
      passenger: { cars: 10, style: 'icf', capacity: 90 },
      express: { cars: 17, style: 'lhb', capacity: 72 },
    },
    services: services('kolkata', [
      { id: 'local', line: 'circular', name: 'Circular Railway Local', kind: 'Suburban EMU · 9 cars',
        stock: 'emu', cars: 9, loco: null, stops: 'all', vmax: 20, accel: 1.4, brake: 1.9,
        blurb: 'Nine coaches round the maidan. Tight, riverside curves and a stop every two minutes.' },
      { id: 'passenger', line: 'sealdah', name: 'Bandel Passenger', kind: 'ICF rake · WAP-4',
        stock: 'icf', cars: 10, loco: 'WAP4', stops: 'all', vmax: 22, accel: 0.9, brake: 1.5,
        blurb: 'The long Sealdah South working: ten coaches, every halt, and a lot of wet platform.' },
      { id: 'express', line: 'howrah', name: 'Howrah Duronto', kind: 'LHB rake · WAP-7',
        stock: 'lhb', cars: 17, loco: 'WAP7', stops: 'majors', vmax: 28, accel: 1.05, brake: 1.6,
        blurb: 'Seventeen LHB coaches out of Howrah. Run the platform or run past it — the board decides.' },
    ]),
  },
  {
    id: 'chennai',
    city: 'Chennai',
    line: 'South Line',
    tagline: 'Beach to Tambaram, the MRTS and the north line to Tiruvallur',
    blurb: 'Green-banded rakes, hot rails, and a long run down the Coromandel coast.',
    seed: 88,
    palette: {
      skyTop: '#5aa6c9', skyLow: '#f5e7c6', fog: '#dfe4d6', sun: '#fff4d2',
      ground: ['#9aa86a', '#a6b276', '#8d9c5e', '#b3be86'],
      ballast: '#928778', sleepers: '#5d564a', rail: '#c0c2bb',
      platform: '#dbd2ba', building: '#c8b18f', roof: '#a8836a',
    },
    lines: [
      {
        id: 'south',
        name: 'South Line',
        colour: '#2f7a4f',
        note: 'Beach to Tambaram and on to Chengalpattu',
        offset: 0,
        stations: [
          ['Chennai Beach', 0.01], ['Chennai Fort', 0.06], ['Park', 0.11],
          ['Egmore', 0.17], ['Chetpet', 0.23], ['Nungambakkam', 0.29],
          ['Kodambakkam', 0.35], ['Mambalam', 0.41], ['Saidapet', 0.48],
          ['Guindy', 0.55], ['St Thomas Mount', 0.62], ['Palavanthangal', 0.68],
          ['Chromepet', 0.75], ['Tambaram', 0.83], ['Vandalur', 0.9],
          ['Chengalpattu', 0.98],
        ],
      },
      {
        id: 'north',
        name: 'North Line',
        colour: '#b8342a',
        note: 'Central up through Perambur and Avadi to Tiruvallur',
        offset: 340,
        stations: [
          ['Chennai Central', 0.01], ['Basin Bridge', 0.07], ['Vyasarpadi', 0.13],
          ['Perambur', 0.2], ['Villivakkam', 0.27], ['Ambattur', 0.35],
          ['Pattaravakkam', 0.42], ['Avadi', 0.5], ['Hindu College', 0.58],
          ['Pattabiram', 0.66], ['Nemilichery', 0.74], ['Tiruvallur', 0.86],
          ['Arakkonam', 0.97],
        ],
      },
      {
        id: 'mrts',
        name: 'MRTS',
        colour: '#c99a1e',
        note: 'Beach along the coast to Velachery',
        offset: 680,
        stations: [
          ['Chennai Beach', 0.01], ['Chennai Fort', 0.06], ['Park Town', 0.12],
          ['Chintadripet', 0.18], ['Chepauk', 0.24], ['Tiruvallikeni', 0.3],
          ['Light House', 0.36], ['Mundakakanni Amman Koil', 0.42],
          ['Thirumayilai', 0.48], ['Mandaveli', 0.54], ['Greenways Road', 0.6],
          ['Kotturpuram', 0.66], ['Kasturba Nagar', 0.72], ['Indira Nagar', 0.78],
          ['Adyar', 0.84], ['Thiruvanmiyur', 0.9], ['Velachery', 0.98],
        ],
      },
    ],
    rolling: ROLLING.chennai,
    stock: {
      local: { cars: 9, style: 'emu', capacity: 112 },
      passenger: { cars: 10, style: 'icf', capacity: 90 },
      express: { cars: 19, style: 'lhb', capacity: 72 },
    },
    services: services('chennai', [
      { id: 'local', line: 'south', name: 'Beach–Tambaram Local', kind: 'Suburban EMU · 9 cars',
        stock: 'emu', cars: 9, loco: null, stops: 'all', vmax: 21, accel: 1.45, brake: 1.95,
        blurb: 'The classic south line: Beach, Egmore, Guindy, Tambaram and every halt between.' },
      { id: 'passenger', line: 'north', name: 'Arakkonam Passenger', kind: 'ICF rake · WAP-4',
        stock: 'icf', cars: 10, loco: 'WAP4', stops: 'all', vmax: 22, accel: 0.9, brake: 1.5,
        blurb: 'Ten ICF coaches north through Perambur and Avadi. Slow away, and it stops all the way.' },
      { id: 'express', line: 'north', name: 'Coromandel Express', kind: 'LHB rake · WAP-7',
        stock: 'lhb', cars: 19, loco: 'WAP7', stops: 'majors', vmax: 28, accel: 1.05, brake: 1.6,
        blurb: 'Nineteen LHB coaches out of Central. Long rake, big speed, very few stops.' },
    ]),
  },
];

/** Livery and shape for the locomotive classes used on the services. */
export const LOCOS = {
  WAP4: { class: 'WAP-4', body: '#b8342a', stripe: '#f0e6cf', roof: '#7d2a22', nose: '#a02f26', diesel: false },
  WAP5: { class: 'WAP-5', body: '#1f4e8c', stripe: '#e8edf4', roof: '#173c6c', nose: '#1b447c', diesel: false },
  WAP7: { class: 'WAP-7', body: '#23486f', stripe: '#e8d24e', roof: '#1a3554', nose: '#1d3d60', diesel: false },
  WDG3A: { class: 'WDG-3A', body: '#c78518', stripe: '#3a3a34', roof: '#8a5c10', nose: '#b07514', diesel: true },
};

export const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));

export function getCity(id) {
  return CITY_BY_ID.get(id) || CITIES[0];
}

export function getService(city, serviceId) {
  const list = city.services || [];
  if (!serviceId) return list.find((sv) => sv.id === 'express') || list[0];
  return list.find((sv) => sv.id === serviceId) || list[0];
}

export function getLine(city, lineId) {
  const list = city.lines || [];
  return list.find((l) => l.id === lineId) || list[0];
}

/**
 * The services a city runs, in the spirit of Indian Train Simulator's Drive
 * menu: a suburban local, a loco-hauled passenger, and a named express. Each
 * one names the line it works and the stock it turns out.
 */
function services(city, defs) {
  return defs.map((def) => ({ ...def, type: def.id, kindLabel: def.kind }));
}

// resolve each service's line once the city table exists (the definitions above
// are written before CITIES is built, so the lookup cannot live inside them)
for (const city of CITIES) {
  for (const sv of city.services) {
    const line = city.lines.find((l) => l.id === sv.line) || city.lines[0];
    sv.lineName = line.name;
    sv.lineColour = line.colour;
  }
}

/** What a city runs: used by the sim and by the 3D builder. */
export function stockFor(city, kind) {
  const stock = city.stock || {};
  if (kind === 'express') return { style: 'lhb', cars: 18, capacity: 72, ...(stock.express || {}) };
  if (kind === 'passenger') return { style: 'icf', cars: 10, capacity: 90, ...(stock.passenger || {}) };
  return { style: 'emu', cars: 9, capacity: 110, ...(stock.local || {}) };
}

/** The colours a rake wears: one set per style, per city. */
export function liveryFor(city, style) {
  const rolling = city.rolling || {};
  return rolling[style] || rolling.emu || city.livery;
}
