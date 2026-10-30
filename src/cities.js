/**
 * Four cities, four locals, and the stock that runs on each.
 *
 * Each entry owns its own station list, rolling stock, livery, sky/ground
 * palette and a seed that grows its own track geometry, so the maps are
 * genuinely different places rather than the same map with different labels.
 *
 * `stock` describes what actually turns up at the platform:
 *   local   — the suburban rake: car count, door colour, end colour
 *   express — the long-distance working: a locomotive plus a full rake
 */

export const CITIES = [
  {
    id: 'mumbai',
    city: 'Mumbai',
    line: 'Western Line',
    tagline: 'Fast locals down the Arabian Sea coast',
    blurb: '12-car rakes with blue doors, packed platforms, and a 100 km/h run to Virar.',
    seed: 7,
    palette: {
      skyTop: '#5d9ec7', skyLow: '#e8e2cb', fog: '#d9dfd8', sun: '#fff2cf',
      ground: ['#8fa26a', '#9cae74', '#83975f', '#a8b781'],
      ballast: '#8b8377', sleepers: '#5c564c', rail: '#b9bcb8',
      platform: '#d8cfb8', building: '#c2a88a', roof: '#a97560',
    },
    livery: { local: '#b23a3a', stripe: '#f3e7cd', roof: '#8a3434', door: '#2f6fa8', end: '#f0d35c', trim: '#2c3a45' },
    express: {
      body: '#274a86', stripe: '#eef2f8', roof: '#1c3560', door: '#203c6d', end: '#274a86', trim: '#8d99ab',
      loco: { body: '#c4452f', stripe: '#f2e2c4', roof: '#8e2f20', nose: '#a8381f' },
    },
    stock: {
      local: { cars: 12, style: 'emu', capacity: 110 },
      express: { cars: 18, style: 'lhb', capacity: 72, name: 'Saurashtra Express' },
    },
    stations: [
      ['Churchgate', 0.02], ['Marine Lines', 0.08], ['Charni Road', 0.14],
      ['Grant Road', 0.2], ['Mumbai Central', 0.26], ['Mahalaxmi', 0.32],
      ['Lower Parel', 0.38], ['Dadar', 0.44], ['Matunga Road', 0.5],
      ['Mahim', 0.56], ['Bandra', 0.62], ['Santacruz', 0.68],
      ['Andheri', 0.75], ['Goregaon', 0.82], ['Borivali', 0.9], ['Virar', 0.97],
    ],
    branch: [['Mahalaxmi', 0], ['Wadala Road', 0.2], ['Sewri', 0.38], ['Reay Road', 0.56], ['Dockyard Road', 0.74], ['Masjid', 1]],
  },
  {
    id: 'delhi',
    city: 'Delhi',
    line: 'Ring Railway',
    tagline: 'The loop line around the capital',
    blurb: 'Blue rakes with a yellow band, wide open flats and hazy afternoons.',
    seed: 23,
    palette: {
      skyTop: '#7ba7c9', skyLow: '#f0e2c2', fog: '#e2dcc8', sun: '#fff0c8',
      ground: ['#b5a878', '#c0b184', '#a89c6e', '#c8b98f'],
      ballast: '#94897a', sleepers: '#5a5449', rail: '#c3c4bd',
      platform: '#ded5c0', building: '#cbb695', roof: '#a5846a',
    },
    livery: { local: '#2f64a8', stripe: '#f2d976', roof: '#234a7c', door: '#e6d26a', end: '#f0d35c', trim: '#1b3c66' },
    express: {
      body: '#8a3f2e', stripe: '#f4e6d0', roof: '#65301f', door: '#78351f', end: '#8a3f2e', trim: '#c9a276',
      loco: { body: '#2f5aa8', stripe: '#f0e2c4', roof: '#22447c', nose: '#26488a' },
    },
    stock: {
      local: { cars: 8, style: 'emu', capacity: 116 },
      express: { cars: 20, style: 'lhb', capacity: 72, name: 'Rajdhani Express' },
    },
    stations: [
      ['Hazrat Nizamuddin', 0.02], ['Lajpat Nagar', 0.1], ['Sewa Nagar', 0.18],
      ['Lodi Colony', 0.26], ['Safdarjung', 0.34], ['Sarojini Nagar', 0.42],
      ['INA', 0.5], ['Dhaula Kuan', 0.58], ['Delhi Cantt', 0.66],
      ['Patel Nagar', 0.74], ['Dayabasti', 0.82], ['Sabzi Mandi', 0.9], ['Kishanganj', 0.97],
    ],
    branch: [['Safdarjung', 0], ['Hauz Khas', 0.3], ['Okhla', 0.62], ['Tughlakabad', 1]],
  },
  {
    id: 'kolkata',
    city: 'Kolkata',
    line: 'Circular Railway',
    tagline: 'Along the Hooghly, past the maidan',
    blurb: 'Deep blue rakes, wet platforms, and the riverside curve into Ballygunge.',
    seed: 41,
    palette: {
      skyTop: '#6fa3bf', skyLow: '#e4e6cf', fog: '#d6ded6', sun: '#fdf0cd',
      ground: ['#7f9a63', '#8ea96f', '#73905a', '#9db47c'],
      ballast: '#867f74', sleepers: '#555046', rail: '#b6b9b4',
      platform: '#d5cdb9', building: '#c6ac8d', roof: '#96807a',
    },
    livery: { local: '#25618f', stripe: '#eaf0f6', roof: '#1b4a6e', door: '#1d4f75', end: '#e8d47a', trim: '#123a58' },
    express: {
      body: '#33507c', stripe: '#f0eee4', roof: '#243a5c', door: '#2a4468', end: '#33507c', trim: '#a8b6c6',
      loco: { body: '#b8442c', stripe: '#f0e0c2', roof: '#8b3020', nose: '#a03a22' },
    },
    stock: {
      local: { cars: 9, style: 'emu', capacity: 112 },
      express: { cars: 17, style: 'lhb', capacity: 72, name: 'Duronto Express' },
    },
    stations: [
      ['Dum Dum', 0.02], ['Belgachia', 0.09], ['Tala', 0.16], ['Bagbazar', 0.23],
      ['Sovabazar', 0.3], ['Bara Bazar', 0.37], ['Prinsep Ghat', 0.45],
      ['Eden Gardens', 0.53], ['Ballygunge', 0.62], ['Park Circus', 0.71],
      ['Santoshpur', 0.8], ['Brace Bridge', 0.89], ['Majerhat', 0.97],
    ],
    branch: [['Eden Gardens', 0], ['Esplanade', 0.28], ['Sealdah', 0.6], ['Bidhan Nagar', 1]],
  },
  {
    id: 'chennai',
    city: 'Chennai',
    line: 'South Line',
    tagline: 'Beach to Tambaram, nine coaches long',
    blurb: 'Green rakes with yellow ends, hot rails and a long run down the coast.',
    seed: 88,
    palette: {
      skyTop: '#5aa6c9', skyLow: '#f5e7c6', fog: '#dfe4d6', sun: '#fff4d2',
      ground: ['#9aa86a', '#a6b276', '#8d9c5e', '#b3be86'],
      ballast: '#928778', sleepers: '#5d564a', rail: '#c0c2bb',
      platform: '#dbd2ba', building: '#c8b18f', roof: '#a8836a',
    },
    livery: { local: '#2f7a4f', stripe: '#f4ecd6', roof: '#22593a', door: '#266342', end: '#f0d35c', trim: '#1a4630' },
    express: {
      body: '#4a5f8a', stripe: '#f1f2ea', roof: '#34456a', door: '#3c4f74', end: '#4a5f8a', trim: '#aeb9cd',
      loco: { body: '#2f7a4f', stripe: '#f0e6c8', roof: '#22593a', nose: '#28653f' },
    },
    stock: {
      local: { cars: 9, style: 'emu', capacity: 112 },
      express: { cars: 19, style: 'lhb', capacity: 72, name: 'Coromandel Express' },
    },
    stations: [
      ['Chennai Beach', 0.02], ['Chennai Fort', 0.08], ['Park', 0.14], ['Egmore', 0.2],
      ['Chetpet', 0.27], ['Nungambakkam', 0.34], ['Kodambakkam', 0.41],
      ['Mambalam', 0.48], ['Saidapet', 0.55], ['Guindy', 0.62],
      ['St Thomas Mount', 0.7], ['Palavanthangal', 0.78], ['Chromepet', 0.86],
      ['Tambaram', 0.96],
    ],
    branch: [['Guindy', 0], ['Velachery', 0.34], ['Taramani', 0.66], ['Thiruvanmiyur', 1]],
  },
];

export const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));

export function getCity(id) {
  return CITY_BY_ID.get(id) || CITIES[0];
}

/** What a city runs: used by the sim and by the 3D builder. */
export function stockFor(city, kind) {
  const stock = city.stock || {};
  if (kind === 'express') {
    return { style: 'lhb', cars: 18, capacity: 72, ...(stock.express || {}) };
  }
  return { style: 'emu', cars: 9, capacity: 110, ...(stock.local || {}) };
}

/** The livery a given train wears, including the locomotive for expresses. */
export function liveryFor(city, kind) {
  return kind === 'express' ? city.express : city.livery;
}
