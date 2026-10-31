'use strict';
/* ============================================================
   Bharat Rail Sim — routes & services
   Distances/positions are approximate, tuned for gameplay.
   ============================================================ */
function st(n, loc, km, o) { return Object.assign({ n, loc, km: km * KM, plat: 250 }, o || {}); }

const ROUTES = {
  /* ------------------------------------------------ Mumbai Western */
  wr: {
    id: 'wr', title: 'Mumbai Western Line', sub: 'Churchgate → Virar', city: 'Mumbai', theme: 'mumbai',
    cat: 'Suburban', badge: 'EMU', double: true, electrified: true, km: 64.2, block: 1400, elev0: 12,
    stationLimit: 65, annLang: 'hi',
    stations: [
      st('Churchgate', 'चर्चगेट', 0, { term: true, plat: 280 }), st('Marine Lines', 'मरीन लाइन्स', 1.5),
      st('Charni Road', 'चर्नी रोड', 2.9), st('Grant Road', 'ग्रांट रोड', 4.3),
      st('Mumbai Central', 'मुंबई सेंट्रल', 6.2, { plat: 280 }), st('Mahalaxmi', 'महालक्ष्मी', 8.3),
      st('Lower Parel', 'लोअर परेल', 9.9), st('Elphinstone Road', 'एल्फिन्स्टन रोड', 11.7),
      st('Dadar', 'दादर', 13.9, { plat: 280 }), st('Matunga Road', 'माटुंगा रोड', 15.3),
      st('Mahim', 'माहिम', 16.9), st('Bandra', 'बांद्रा', 19.4, { plat: 280 }),
      st('Khar Road', 'खार रोड', 21.4), st('Santacruz', 'सांताक्रूज़', 23.3),
      st('Vile Parle', 'विले पर्ले', 25.4), st('Andheri', 'अंधेरी', 28.5, { plat: 280 }),
      st('Jogeshwari', 'जोगेश्वरी', 31.6), st('Goregaon', 'गोरेगांव', 33.8),
      st('Malad', 'मालाड', 36.5), st('Kandivali', 'कांदिवली', 39.3),
      st('Borivali', 'बोरीवली', 42.5, { plat: 280 }), st('Dahisar', 'दहिसर', 46.1),
      st('Mira Road', 'मीरा रोड', 49.1), st('Bhayandar', 'भायंदर', 51.9),
      st('Naigaon', 'नायगांव', 54.6), st('Vasai Road', 'वसई रोड', 57.3, { plat: 280 }),
      st('Nalasopara', 'नालासोपारा', 60.5), st('Virar', 'विरार', 64.2, { term: true, plat: 280 }),
    ],
    gradients: [[0, 64.2, 0]], limits: [[0, 26, 100], [26, 31, 80], [31, 64.2, 100]],
    tunnels: [], viaducts: [[18.2, 19.3], [55.8, 58.4]], crossings: [24.8, 47.5],
    services: [{
      id: 'wr-fast', label: 'Fast Local — Virar', train: 'wr_emu12', depart: '09:12',
      to: 'Virar', stops: ['Mumbai Central', 'Dadar', 'Bandra', 'Andheri', 'Borivali', 'Bhayandar', 'Vasai Road', 'Virar'],
      pace: 47, dwell: 22, ann: 'VIRAR FAST', difficulty: 2,
      ai: {
        chase: { train: 'wr_emu12', label: '09:02 Bhayandar Slow', t0: -260, pace: 36, stops: 'all', dwell: 24 },
        opposite: { every: [210, 390], trains: ['wr_emu12', 'wr_emu12', 'konkan_exp'] },
      },
    }],
  },

  /* ------------------------------------------------ Mumbai Central */
  cr: {
    id: 'cr', title: 'Mumbai Central Line', sub: 'CSMT → Kalyan', city: 'Mumbai', theme: 'mumbai_cr',
    cat: 'Suburban', badge: 'EMU', double: true, electrified: true, km: 54, block: 1500, elev0: 8,
    stationLimit: 65, annLang: 'hi',
    stations: [
      st('CSMT', 'छत्रपति शिवाजी महाराज टर्मिनस', 0, { term: true, plat: 300 }), st('Masjid', 'मसजिद', 1.3),
      st('Sandhurst Road', 'सैंडहर्स्ट रोड', 2.5), st('Byculla', 'भायखला', 4.5),
      st('Chinchpokli', 'चिंचपोकली', 6.0), st('Currey Road', 'करी रोड', 7.2),
      st('Parel', 'परेल', 8.6), st('Dadar', 'दादर', 10.0, { plat: 280 }),
      st('Matunga', 'माटुंगा', 11.5), st('Sion', 'शीव', 13.2),
      st('Kurla', 'कुर्ला', 15.7, { plat: 280 }), st('Vidyavihar', 'विद्याविहार', 17.5),
      st('Ghatkopar', 'घाटकोपर', 19.0, { plat: 280 }), st('Vikhroli', 'विक्हरोली', 21.4),
      st('Kanjurmarg', 'कांजूरमार्ग', 23.4), st('Bhandup', 'भांडुप', 25.3),
      st('Nahur', 'नाहूर', 27.0), st('Mulund', 'मुलुंड', 28.6),
      st('Thane', 'थाणे', 32.8, { plat: 300 }), st('Kalwa', 'कळवा', 35.0),
      st('Mumbra', 'मुंब्रा', 39.0), st('Diwa', 'दिवा', 42.0, { plat: 280 }),
      st('Kopar', 'कोपर', 44.6), st('Dombivli', 'डोंबिवली', 47.0, { plat: 280 }),
      st('Thakurli', 'ठाकुरली', 49.5), st('Kalyan', 'कल्याण', 54.0, { term: true, plat: 300 }),
    ],
    gradients: [[0, 54, 0]], limits: [[0, 38, 100], [38, 41.5, 65], [41.5, 54, 100]],
    tunnels: [[36.0, 38.6]], viaducts: [[29.5, 32.7]], crossings: [43.5],
    services: [{
      id: 'cr-fast', label: 'Fast Local — Kalyan', train: 'cr_emu15', depart: '08:15',
      to: 'Kalyan', stops: ['Byculla', 'Dadar', 'Kurla', 'Ghatkopar', 'Thane', 'Diwa', 'Dombivli', 'Kalyan'],
      pace: 46, dwell: 22, ann: 'KALYAN FAST', difficulty: 2,
      ai: {
        chase: { train: 'cr_emu15', label: '08:05 Thane Slow', t0: -230, pace: 35, stops: 'all', dwell: 24 },
        opposite: { every: [220, 400], trains: ['cr_emu15', 'cr_emu15', 'konkan_exp'] },
      },
    }],
  },

  /* ------------------------------------------------ Chennai */
  chennai: {
    id: 'chennai', title: 'Chennai suburban', sub: 'Chennai Beach → Tambaram', city: 'Chennai', theme: 'chennai',
    cat: 'Suburban', badge: 'EMU', double: true, electrified: true, km: 27.6, block: 1200, elev0: 6,
    stationLimit: 55, annLang: 'ta',
    stations: [
      st('Chennai Beach', 'சென்னை கடற்கரை', 0, { term: true, plat: 280 }), st('Chennai Fort', 'சென்னைக் கோட்டை', 1.4),
      st('Park Town', 'பார்க் டவுன்', 2.6), st('Chennai Egmore', 'எழும்பூர்', 4.3, { plat: 280 }),
      st('Chetpet', 'செட்பேட்', 5.6), st('Nungambakkam', 'நுங்கம்பாக்கம்', 6.9),
      st('Kodambakkam', 'கொடம்பாக்கம்', 8.5), st('Mambalam', 'மாம்பலம்', 9.8),
      st('Saidapet', 'சைதாப்பேட்டை', 11.4), st('Guindy', 'கிண்டி', 13.0),
      st('St Thomas Mount', 'பரங்கிமலை', 14.4, { plat: 280 }), st('Pazhavanthangal', 'பழவந்தாங்கல்', 15.7),
      st('Meenambakkam', 'மீனம்பாக்கம்', 17.1), st('Tirusulam', 'திருசூலம்', 18.7),
      st('Pallavaram', 'பல்லாவரம்', 20.2), st('Chromepet', 'குரோம்பேட்டை', 22.1),
      st('Tambaram San.', 'தாம்பரம் சானடோரியம்', 24.4), st('Tambaram', 'தாம்பரம்', 27.6, { term: true, plat: 280 }),
    ],
    gradients: [[0, 27.6, 0]], limits: [[0, 27.6, 85]], tunnels: [], viaducts: [[25.4, 26.6]],
    crossings: [16.2, 23.4],
    services: [{
      id: 'ch-local', label: 'EMU Local — Tambaram', train: 'ch_emu9', depart: '07:45',
      to: 'Tambaram', stops: 'all', pace: 33, dwell: 20, ann: 'TAMBARAM', difficulty: 3,
      ai: {
        chase: { train: 'ch_emu9', label: '07:35 Beach Local', t0: -190, pace: 30, stops: 'all', dwell: 20 },
        opposite: { every: [190, 360], trains: ['ch_emu9', 'ch_emu9', 'vb_express'] },
      },
    }],
  },

  /* ------------------------------------------------ Kolkata */
  kol: {
    id: 'kol', title: 'Howrah–Bardhaman Main', sub: 'Howrah → Bandel Jn', city: 'Kolkata', theme: 'kolkata',
    cat: 'Suburban', badge: 'EMU', double: true, electrified: true, km: 41, block: 1600, elev0: 12,
    stationLimit: 60, annLang: 'bn',
    stations: [
      st('Howrah', 'হাওড়া', 0, { term: true, plat: 300 }), st('Liluah', 'লীলুয়াহ', 5.2),
      st('Salkia', 'শালকিয়া', 6.8), st('Belur', 'বেলুড়', 8.9),
      st('Bally', 'বালি', 11.2), st('Hindmotor', 'হিন্দমোটর', 13.6),
      st('Konnagar', 'কোন্নগর', 15.6), st('Rishra', 'রিশরা', 17.6),
      st('Serampore', 'শ্রীরামপুর', 20.3, { plat: 280 }), st('Sheoraphuli', 'শিয়ড়ফুলি', 23.1),
      st('Baidyabati', 'বৈদ্যবাটি', 25.2), st('Bhadreswar', 'ভাদ্রেশ্বর', 27.2),
      st('Champdani', 'চাঁপদানি', 29.2), st('Chandannagar', 'চন্দননগর', 32.3),
      st('Chinsurah', 'চুঁচুড়া', 36.2), st('Hooghly', 'হুগলি', 38.3),
      st('Bandel Jn', 'বাঁদেল', 41.0, { term: true, plat: 280 }),
    ],
    gradients: [[0, 41, 0]], limits: [[0, 41, 100]], tunnels: [], viaducts: [[33.4, 34.6]],
    crossings: [10.4, 30.1, 37.9],
    services: [{
      id: 'kol-local', label: 'Main Line EMU — Bandel', train: 'kol_emu12', depart: '08:35',
      to: 'Bandel Jn', stops: 'all', pace: 42, dwell: 22, ann: 'BANDEL', difficulty: 2,
      ai: {
        chase: { train: 'kol_emu12', label: '08:25 Katwa Local', t0: -250, pace: 36, stops: 'all', dwell: 22 },
        opposite: { every: [230, 420], trains: ['kol_emu12', 'kol_emu12', 'konkan_exp'] },
      },
    }],
  },

  /* ------------------------------------------------ Delhi MEMU */
  del: {
    id: 'del', title: 'Delhi MEMU', sub: 'New Delhi → Ghaziabad', city: 'Delhi NCR', theme: 'delhi',
    cat: 'Suburban', badge: 'MEMU', double: true, electrified: true, km: 19.8, block: 1500, elev0: 216,
    stationLimit: 60, annLang: 'hi',
    stations: [
      st('New Delhi', 'नई दिल्ली', 0, { term: true, plat: 300 }), st('Tilak Bridge', 'तिलक ब्रिज', 2.1),
      st('Shahdara', 'शाहदरा', 6.6), st('Anand Vihar', 'आनंद विहार', 9.2),
      st('Sahibabad', 'साहिबाबाद', 12.1), st('Ghaziabad', 'गाज़ियाबाद', 19.8, { term: true, plat: 300 }),
    ],
    gradients: [[0, 19.8, 0]], limits: [[0, 19.8, 100]], tunnels: [], viaducts: [[3.6, 4.8]],
    crossings: [15.3],
    services: [{
      id: 'del-memu', label: 'MEMU — Ghaziabad', train: 'memu_del', depart: '06:50',
      to: 'Ghaziabad', stops: 'all', pace: 42, dwell: 25, ann: 'GHAZIABAD', difficulty: 1,
      ai: {
        chase: { train: 'memu_del', label: '06:40 Shakurbasti MEMU', t0: -300, pace: 38, stops: 'all', dwell: 25 },
        opposite: { every: [260, 480], trains: ['memu_del', 'deccan_queen', 'konkan_exp'] },
      },
    }],
  },

  /* ------------------------------------------------ Mysuru DMU */
  mys: {
    id: 'mys', title: 'Chamarajanagar branch', sub: 'Mysuru → Chamarajanagar', city: 'Mysuru', theme: 'mysuru',
    cat: 'Branch line', badge: 'DMU', double: false, electrified: false, km: 61, block: 0, elev0: 763,
    stationLimit: 50, annLang: 'kn',
    stations: [
      st('Mysuru Jn', 'ಮೈಸೂರು', 0, { term: true, plat: 280 }), st('Naganahalli', 'ನಾಗನಹಳ್ಳಿ', 9),
      st('Kadakola', 'ಕಡಕೋಲ', 15), st('Nanjangud Town', 'ನಂಜನಗೂಡು', 26, { plat: 200 }),
      st('Sujathapuram', 'ಸುಜಾತಾಪುರ', 46, { plat: 120 }), st('Chamarajanagar', 'ಚಾಮರಾಜನಗರ', 61, { term: true, plat: 200 }),
    ],
    gradients: [[0, 61, 0]], limits: [[0, 61, 100]], tunnels: [], viaducts: [[37.5, 38.9]],
    crossings: [7.2, 18.5, 31.4, 42.8, 55.1],
    services: [{
      id: 'mys-dmu', label: 'DMU — Chamarajanagar', train: 'dmu_mys', depart: '06:15',
      to: 'Chamarajanagar', stops: 'all', pace: 43, dwell: 25, ann: 'CHAMARAJANAGAR', difficulty: 2,
      meets: [{ at: 'Nanjangud Town', aiTrain: 'dmu_mys', aiLabel: '05:50 Mysuru DMU (Up)', aheadKm: 2.4, triggerKm: 1.9 }],
    }],
  },

  /* ------------------------------------------------ Konkan Railway */
  konkan: {
    id: 'konkan', title: 'Konkan Railway', sub: 'Ratnagiri → Madgaon', city: 'Konkan Coast', theme: 'konkan',
    cat: 'Scenic express', badge: 'WDP-4D', double: false, electrified: false, km: 195, block: 0, elev0: 30,
    stationLimit: 50, annLang: 'mr',
    stations: [
      st('Ratnagiri', 'रत्नागिरी', 0, { term: true, plat: 300 }), st('Rajapur Road', 'राजापूर रोड', 30, { plat: 180 }),
      st('Vaibhavwadi Road', 'वैभववाडी रोड', 55, { plat: 180 }), st('Kankavali', 'कणकवली', 82, { plat: 300 }),
      st('Sindhudurg', 'सिंधुदुर्ग', 105, { plat: 300 }), st('Kudal', 'कुडाळ', 122, { plat: 300 }),
      st('Sawantwadi Road', 'सावंतवाडी रोड', 145, { plat: 300 }), st('Pernem', 'पेडणे', 168, { plat: 300 }),
      st('Thivim', 'थिवीं', 180, { plat: 300 }), st('Madgaon Jn', 'मडगांव', 195, { term: true, plat: 300 }),
    ],
    gradients: [[0, 20, 0.004], [20, 45, -0.006], [45, 70, 0.005], [70, 95, -0.004], [95, 120, 0.006], [120, 150, -0.005], [150, 170, 0.004], [170, 195, 0.002]],
    limits: [[0, 12, 90], [12, 46, 110], [46, 58, 85], [58, 96, 110], [96, 130, 90], [130, 165, 110], [165, 178, 85], [178, 195, 100]],
    tunnels: [[12, 13.2], [26.5, 28.9], [38, 39.5], [57, 59.8], [77, 78.6], [88, 90.2], [96, 101.5], [108, 110], [124, 125.3], [133, 134.2], [152, 153.5], [161, 162.2], [176, 177], [186, 187.2]],
    viaducts: [[15, 16.2], [33, 34.5], [52, 53], [66, 67.5], [92, 93.5], [118, 119.5], [140, 141.5], [157, 158], [173, 174.5], [188, 190.5]],
    crossings: [21.5, 47.5, 69.5, 118.5, 143.5],
    services: [
      {
        id: 'konkan-exp', label: 'Konkan Express — Madgaon', train: 'konkan_exp', depart: '07:20',
        to: 'Madgaon Jn', stops: ['Kankavali', 'Kudal', 'Sawantwadi Road', 'Thivim', 'Madgaon Jn'],
        pace: 56, dwell: 40, ann: 'MADGAON', difficulty: 3,
        meets: [{ at: 'Pernem', aiTrain: 'konkan_exp', aiLabel: '10111 Konkan Kanya (Up)', aheadKm: 2.6, triggerKm: 1.9 }],
      },
      {
        id: 'konkan-vb', label: 'Vande Bharat — Madgaon', train: 'vb_express', depart: '14:25',
        to: 'Madgaon Jn', stops: ['Kudal', 'Thivim', 'Madgaon Jn'],
        pace: 68, dwell: 30, ann: 'MADGAON', difficulty: 3,
        meets: [{ at: 'Kudal', aiTrain: 'wdg_freight', aiLabel: 'BOXN Freight (Up)', aheadKm: 2.8, triggerKm: 2.0 }],
      },
    ],
  },

  /* ------------------------------------------------ Nilgiri Mountain Railway */
  nilgiri: {
    id: 'nilgiri', title: 'Nilgiri Mountain Railway', sub: 'Mettupalayam → Ooty', city: 'Nilgiris', theme: 'nilgiri',
    cat: 'Heritage scenic', badge: 'Steam', double: false, electrified: false, rack: true, rackSpans: [[9.7, 31]], km: 46, block: 0, elev0: 330,
    stationLimit: 25, annLang: 'ta',
    stations: [
      st('Mettupalayam', 'மேட்டுப்பாளையம்', 0, { term: true, plat: 120 }), st('Kallar', 'கல்லர்', 8, { plat: 80 }),
      st('Adderly', 'அடர்லி', 12.5, { plat: 45 }), st('Hillgrove', 'ஹில்க்ரோவ்', 17, { plat: 60 }),
      st('Runneymede', 'ரன்னிமீட்', 21.5, { plat: 45 }), st('Kateri Road', 'கடேரி ரோடு', 24, { plat: 45 }),
      st('Coonoor', 'குன்னூர்', 27, { plat: 140 }), st('Wellington', 'வெல்லிங்டன்', 32, { plat: 80 }),
      st('Aravankad', 'அரவங்காடு', 35.5, { plat: 45 }), st('Ketti', 'கேட்டி', 39, { plat: 60 }),
      st('Lovedale', 'லவ்டேல்', 42, { plat: 60 }), st('Ooty', 'உதகமண்டலம்', 46, { term: true, plat: 140 }),
    ],
    gradients: [[0, 8, 0.012], [8, 12.5, 0.055], [12.5, 17, 0.06], [17, 21.5, 0.058], [21.5, 24, 0.05], [24, 27, 0.045], [27, 32, 0.028], [32, 35.5, 0.03], [35.5, 39, 0.026], [39, 42, 0.02], [42, 46, 0.028]],
    limits: [[0, 8, 30], [8, 27, 16], [27, 46, 26]],
    tunnels: [[9.2, 9.7], [13.2, 13.7], [14.9, 16.1], [18.2, 18.8], [22.2, 22.8], [25.1, 25.6], [31, 31.5], [36, 36.5], [40, 40.5], [43, 43.4]],
    viaducts: [[12.1, 12.4], [20.9, 21.3]], crossings: [5.5, 28.5, 40.5],
    services: [{
      id: 'nmr-up', label: 'Mountain Railway — Ooty', train: 'nmr_x', depart: '07:10',
      to: 'Ooty', stops: 'all', pace: 13, dwell: 45, ann: 'OOTY', difficulty: 4,
      meets: [{ at: 'Hillgrove', aiTrain: 'nmr_x', aiLabel: 'Down train exchanging staff', aheadKm: 4.5, triggerKm: 2.2 }],
    }],
  },

  /* ------------------------------------------------ Deccan Queen */
  deccan: {
    id: 'deccan', title: 'Bhor Ghat — Deccan Queen', sub: 'Mumbai CSMT → Pune', city: 'Mumbai–Pune', theme: 'deccan',
    cat: 'Long distance', badge: 'WAP-7', double: true, electrified: true, km: 192, block: 1800, elev0: 8,
    stationLimit: 75, annLang: 'mr',
    stations: [
      st('Mumbai CSMT', 'मुंबई छ. शिवाजी टर्मिनस', 0, { term: true, plat: 300 }), st('Dadar', 'दादर', 9, { plat: 300 }),
      st('Thane', 'थाणे', 22, { plat: 300 }), st('Kalyan Jn', 'कल्याण', 36.5, { plat: 300 }),
      st('Karjat', 'कर्जत', 90, { plat: 300 }), st('Khandala', 'खंडाला', 108, { plat: 200 }),
      st('Lonavala', 'लोणावळा', 112, { plat: 300 }), st('Kamshet', 'कामशेत', 120, { plat: 200 }),
      st('Shivajinagar', 'शिवाजीनगर', 186, { plat: 280 }), st('Pune Jn', 'पुणे', 192, { term: true, plat: 300 }),
    ],
    gradients: [[0, 36, 0], [36, 90, 0.0012], [90, 112, 0.025], [112, 192, -0.0004]],
    limits: [[0, 90, 105], [90, 112, 60], [112, 140, 90], [140, 192, 105]],
    tunnels: [[92.5, 93.3], [95.2, 96.1], [99.3, 100.4], [103.8, 104.9], [108.6, 109.8]],
    viaducts: [[97.2, 98.1], [106, 107]], crossings: [85.5, 124.5, 151.5, 165.5],
    services: [{
      id: 'dq', label: 'Deccan Queen — Pune', train: 'deccan_queen', depart: '17:10',
      to: 'Pune Jn', stops: ['Dadar', 'Kalyan Jn', 'Karjat', 'Lonavala', 'Pune Jn'],
      pace: 57, dwell: 45, ann: 'PUNE', difficulty: 3,
      karjatHold: 300,
      ai: {
        chase: { train: 'konkan_exp', label: 'Koyna Express', t0: -420, pace: 50, stops: ['Kalyan Jn', 'Karjat', 'Pune Jn'], dwell: 60 },
        opposite: { every: [420, 700], trains: ['wdg_freight', 'vb_express', 'wdg_freight'] },
      },
    }],
  },
};

/* ============================================================
   Derived data: apply real geo (when available), then build
   elevations, gradients and timetables from it.
   ============================================================ */
for (const r of Object.values(ROUTES)) {
  const g = typeof GEO !== 'undefined' && GEO[r.id];
  const oldKm = r.km;
  if (g && g.stations.length === r.stations.length) {
    r.geo = g;
    for (let i = 0; i < r.stations.length; i++) {
      const gs = g.stations[i];
      if (gs && (gs.n === r.stations[i].n || Math.abs(gs.km - r.stations[i].km / KM) < oldKm)) {
        const s = r.stations[i];
        s.km = gs.km * KM; s.elev = gs.elev; s.lat = gs.lat; s.lon = gs.lon;
      }
    }
    r.km = r.stations[r.stations.length - 1].km / KM;
    // rescale structural km positions from old length to real length
    const k = r.km / oldKm;
    const sc = (arr) => (arr || []).map(([a, b]) => [a * k, b * k]);
    r.tunnels = sc(r.tunnels);
    r.viaducts = sc(r.viaducts);
    r.crossings = (r.crossings || []).map((c) => c * k);
    if (r.limits) r.limits = r.limits.map(([a, b, v]) => [a * k, b * k, v]);
  }
  // elevation & gradients from real station elevations
  if (r.stations[0].elev !== undefined) {
    r.gradients = [];
    for (let i = 1; i < r.stations.length; i++) {
      const a = r.stations[i - 1], b = r.stations[i];
      const seg = Math.max(0.5, (b.km - a.km) / KM);
      r.gradients.push([a.km / KM, b.km / KM, (b.elev - a.elev) / 1000 / seg]);
    }
  }
  r.elevAt = buildElevation(r.gradients, r.stations[0].elev || r.elev0 || 0);
  for (const s of r.stations) { if (s.plat === undefined) s.plat = 250; }
  for (const svc of r.services) svc.timetable = buildTimetable(r, svc);
  r.gradList = r.gradients;
}
function routeKmLen(r) { return r.km * KM; }

function stationByName(r, n) { return r.stations.find((s) => s.n === n); }

function serviceStops(route, svc) {
  const list = svc.stops === 'all' ? route.stations.map((s) => s.n) : svc.stops;
  return list.map((n) => stationByName(route, n)).filter(Boolean);
}

/* build timetable (seconds from midnight) for a service */
function buildTimetable(route, svc) {
  const tr = TRAINS[svc.train];
  let stops = serviceStops(route, svc);
  const dep0 = parseClock(svc.depart);
  // non-'all' services list only calling points: start the clock at the true origin
  if (svc.stops !== 'all' && stops[0] && stops[0].km > 0) {
    stops = [route.stations[0]].concat(stops);
  }
  const vC = svc.pace * MPS, vmax = tr.vmax, a = 0.65;
  const tt = [];
  let t = dep0;
  for (let i = 0; i < stops.length; i++) {
    if (i > 0) {
      const d = (stops[i].km - stops[i - 1].km);
      t += estimateRun(d, vC, vmax, a) * 1.13 + (i === 1 ? 25 : 0); // start-up allowance
    }
    const arr = Math.round(t);
    const isTerm = i === stops.length - 1;
    const isOrigin = i === 0;
    const dwl = isTerm || isOrigin ? 0 : svc.dwell + (route.rack ? 20 : 0);
    t = arr + dwl;
    tt.push({ st: stops[i], arr, dep: isTerm ? arr : Math.round(t), halt: !isTerm && !isOrigin });
  }
  return tt;
}

