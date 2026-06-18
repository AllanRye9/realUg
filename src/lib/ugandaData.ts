// District centers for fallback positioning
export const DISTRICT_CENTRES: Record<string, { lat: number; lng: number }> = {
  'Gulu': { lat: 2.7725, lng: 32.2990 },
  'Nwoya': { lat: 2.6500, lng: 31.9000 },
  'Amuru': { lat: 3.0000, lng: 32.0800 },
  'Omoro': { lat: 2.9500, lng: 32.5000 },
  'Pader': { lat: 3.0167, lng: 33.2333 },
  'Kampala Central': { lat: 0.3283, lng: 32.5911 },
  'Wakiso': { lat: 0.3980, lng: 32.6395 },
  'Mukono': { lat: 0.3544, lng: 32.7481 },
  'Entebbe': { lat: 0.0512, lng: 32.4637 },
  'Jinja': { lat: 0.4244, lng: 33.2042 },
  'Mbarara': { lat: -0.6074, lng: 30.6545 },
  'Arua': { lat: 3.0167, lng: 30.9119 },
  'Lira': { lat: 2.2499, lng: 32.9000 },
  'Soroti': { lat: 1.7148, lng: 33.6116 },
  'Mbale': { lat: 1.0821, lng: 34.1750 },
  'Masaka': { lat: -0.3333, lng: 31.7341 },
  'Fort Portal': { lat: 0.6710, lng: 30.2750 },
};

export const ALL_DISTRICTS = Object.keys(DISTRICT_CENTRES);

export const WEIGHTS: Record<string, number> = {
  'Kampala Central': 1.4,
  'Entebbe': 1.1,
  'Wakiso': 0.9,
  'Mukono': 0.7,
  'Jinja': 0.7,
  'Mbarara': 0.6,
  'Arua': 0.55,
  'Gulu': 0.5,
  'Nwoya': 0.5,
  'Amuru': 0.5,
  'Omoro': 0.5,
  'Pader': 0.4,
  'Lira': 0.45,
  'Soroti': 0.4,
  'Mbale': 0.5,
  'Masaka': 0.45,
  'Fort Portal': 0.55,
};

// Known Uganda locations with coordinates
export const UG_LOCATIONS: Record<string, [number, number]> = {
  // Gulu district areas
  'gulu': [2.7725, 32.2990],
  'gulu city': [2.7725, 32.2990],
  'pece': [2.7800, 32.2800],
  'pece division': [2.7800, 32.2800],
  'laroo': [2.7900, 32.3100],
  'laroo division': [2.7900, 32.3100],
  'layibi': [2.7600, 32.3200],
  'layibi division': [2.7600, 32.3200],
  'bardege': [2.8000, 32.2700],
  'bardege division': [2.8000, 32.2700],
  'bar dege': [2.8000, 32.2700],
  'unyama': [2.8200, 32.3000],
  'awach': [2.9000, 32.4000],
  'abwoch': [2.9000, 32.4000],
  'abwoch parish': [2.9000, 32.4000],
  'patiko': [3.0000, 32.3200],
  'palaro': [3.1000, 32.2000],
  'koro': [2.9000, 32.6000],
  'lalogi': [2.8500, 32.4500],
  'atede': [2.8800, 32.4200],
  'atyang': [2.9200, 32.3800],

  // Nwoya district
  'nwoya': [2.6500, 31.9000],
  'anaka': [2.5000, 31.9500],
  'purongo': [2.8000, 31.7000],

  // Amuru district
  'amuru': [3.0000, 32.0800],
  'atiak': [3.2000, 32.0500],
  'pabbo': [3.0500, 31.9000],
  'mutema': [3.1000, 32.0000],
  'bana': [2.9800, 32.1200],

  // Omoro district
  'omoro': [2.9500, 32.5000],

  // Pader district
  'pader': [3.0167, 33.2333],
  'agago': [2.9000, 33.3000],
  'angagura': [3.1000, 33.1500],

  // Kitgum
  'kitgum': [3.2784, 32.8858],

  // Kampala areas
  'kampala': [0.3283, 32.5911],
  'nakasero': [0.3200, 32.5800],
  'kololo': [0.3400, 32.5900],
  'ntinda': [0.3600, 32.6100],
  'bugolobi': [0.3100, 32.6100],
  'muyenga': [0.2800, 32.6000],
  'makindye': [0.2900, 32.5800],
  'rubaga': [0.3100, 32.5500],
  'kawempe': [0.3700, 32.5700],
  'nansana': [0.3600, 32.5100],
  'kireka': [0.3300, 32.6500],
  'kira': [0.3700, 32.6400],
  'kyaliwajjala': [0.3500, 32.6600],
  'bweyogerere': [0.3300, 32.6800],
  'kasubi': [0.3400, 32.5500],
  'namungoona': [0.3200, 32.5300],
  'busega': [0.3000, 32.5200],
  ' Nateete': [0.3000, 32.5400],

  // Wakiso areas
  'wakiso': [0.3980, 32.6395],
  'gayaza': [0.4500, 32.6200],
  'matugga': [0.5000, 32.5800],
  'kasangati': [0.4300, 32.6000],
  'najjera': [0.3700, 32.6300],
  'namugongo': [0.3700, 32.6500],
  'kyengera': [0.2600, 32.5400],
  'kitende': [0.2200, 32.4900],
  'bunamwaya': [0.2400, 32.5100],
  'lungujja': [0.2800, 32.5600],

  // Entebbe
  'entebbe': [0.0512, 32.4637],
  'kitoro': [0.0600, 32.4700],

  // Mukono areas
  'mukono': [0.3544, 32.7481],
  'njeru': [0.4300, 33.1800],
  'lugazi': [0.4100, 33.0200],
  'seeta': [0.3800, 32.7200],

  // Jinja areas
  'jinja': [0.4244, 33.2042],
  'bugembe': [0.4500, 33.2200],
  'kakira': [0.5000, 33.2500],

  // Mbarara areas
  'mbarara': [-0.6074, 30.6545],
  'kakoba': [-0.6200, 30.6400],
  'nyamitanga': [-0.6400, 30.6600],
  'rukuba': [-0.5900, 30.6700],

  // Other cities
  'arua': [3.0167, 30.9119],
  'lira': [2.2499, 32.9000],
  'soroti': [1.7148, 33.6116],
  'mbale': [1.0821, 34.1750],
  'masaka': [-0.3333, 31.7341],
  'fort portal': [0.6710, 30.2750],
};

// Location keywords that indicate a place reference
export const LOCATION_PREPOSITIONS = [
  'in', 'at', 'located in', 'located at', 'situated in', 'situated at',
  'near', 'around', 'close to', 'adjacent to', 'off', 'along',
  'behind', 'opposite', 'next to', 'within', 'inside',
  'plot in', 'land in', 'plot at', 'land at', 'acres in', 'acres at',
  'house in', 'house at', 'property in', 'property at',
];

// Size-related keywords/patterns
export const SIZE_PATTERNS = [
  { regex: /(\d+(?:\.\d+)?)\s*(?:x|X|by|BY|×)\s*(\d+(?:\.\d+)?)\s*(?:m|meters|metres|ft|feet)?/i, type: 'dimensions' },
  { regex: /(\d+(?:\.\d+)?)\s*(?:acres?|acre)/i, type: 'acres' },
  { regex: /(half|0\.5)\s*(?:an?\s*)?acres?/i, type: 'acres' },
  { regex: /(\d+(?:\.\d+)?)\s*(?:sqm|sq\.?\s*m|m²|square\s*meters?)/i, type: 'sqm' },
  { regex: /(\d+(?:\.\d+)?)\s*(?:hectares?|hectare|ha)\b/i, type: 'hectares' },
  { regex: /(\d+(?:\.\d+)?)\s*(?:decimals?|decima)/i, type: 'decimals' },
];

// Price patterns
export const PRICE_PATTERNS = [
  { regex: /(\d+(?:[.,]\d+)?)\s*(?:billion|b)(?!\w)/i, multiplier: 1000 },
  { regex: /(\d+(?:[.,]\d+)?)\s*(?:million|millions?|m\b|M\b)/i, multiplier: 1 },
  { regex: /(\d+(?:[.,]\d+)?)\s*k\b/i, multiplier: 0.001 },
  { regex: /(?:ugx|shs?)\s*(\d+(?:[.,]\d+)?)/i, multiplier: null }, // special handling
];

// Agent/contact keywords
export const AGENT_KEYWORDS = [
  'call', 'contact', 'whatsapp', 'tel', 'telephone', 'phone', 'reach',
  'feel free to', 'inquire', 'enquiries', 'contact number', 'call me',
  'contact me', 'call us', 'contact us', 'reach out', 'for details',
];

// Name patterns after agent keywords
export const AGENT_NAME_PATTERN = /(?:call|contact|whatsapp|reach)\s+(?:me\s+|us\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i;

// Phone number patterns for Uganda
export const PHONE_PATTERNS = [
  /(?:\+?256[\s\-]?\(0\)?[\s\-]?\d{2}[\s\-]?\d{3}[\s\-]?\d{4})/,
  /07\d{2}[\s\-]?\d{3}[\s\-]?\d{3,4}/,
  /\+256\d{9}/,
];

export function localGeocode(query: string): { lat: number; lng: number } | null {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;

  // Direct match
  if (UG_LOCATIONS[q]) {
    const [lat, lng] = UG_LOCATIONS[q];
    return { lat, lng };
  }

  // Partial match - query contains a known location
  for (const [name, coords] of Object.entries(UG_LOCATIONS)) {
    if (q.includes(name) || name.includes(q)) {
      return { lat: coords[0], lng: coords[1] };
    }
  }

  // Check for district match
  const districtKey = ALL_DISTRICTS.find(d =>
    q.includes(d.toLowerCase())
  );
  if (districtKey) {
    const c = DISTRICT_CENTRES[districtKey];
    return { lat: c.lat, lng: c.lng };
  }

  return null;
}
