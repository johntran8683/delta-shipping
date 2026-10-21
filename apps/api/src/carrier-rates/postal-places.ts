import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * US ZIP → city and state, from GeoNames postal data (CC BY 4.0).
 * https://download.geonames.org/export/zip/US.zip
 * Canadian provinces come from the postal-code prefix, which is assigned
 * by province. The street is never used, and a code that is not in the
 * directory does not imply a different country.
 */
export type PostalPlace = {
  city: string;
  state: string;
};

export type ShipToAddressView = {
  name: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string;
  countryCode: string;
};

export type SuggestedAddress = {
  city: string | null;
  state: string;
  postalCode: string;
  countryCode: string;
};

export type AddressCheckResult = {
  /** ready: quote now. confirm: ask which address to quote. blocked: cannot quote. */
  status: 'ready' | 'confirm' | 'blocked';
  message: string | null;
  current: ShipToAddressView;
  suggestions: SuggestedAddress[];
};

export type AddressCheckInput = {
  name?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
};

const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  AS: 'American Samoa',
  GU: 'Guam',
  MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico',
  VI: 'Virgin Islands',
  AA: 'Armed Forces Americas',
  AE: 'Armed Forces Europe',
  AP: 'Armed Forces Pacific',
};

const CA_PROVINCE_NAMES: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

/** First letter of a Canadian postal code. X is shared by two territories. */
const CA_PREFIX: Record<string, string[]> = {
  A: ['NL'],
  B: ['NS'],
  C: ['PE'],
  E: ['NB'],
  G: ['QC'],
  H: ['QC'],
  J: ['QC'],
  K: ['ON'],
  L: ['ON'],
  M: ['ON'],
  N: ['ON'],
  P: ['ON'],
  R: ['MB'],
  S: ['SK'],
  T: ['AB'],
  V: ['BC'],
  X: ['NT', 'NU'],
  Y: ['YT'],
};

const US_NAME_TO_CODE = invert(US_STATE_NAMES, {
  'WASHINGTON DC': 'DC',
  'WASHINGTON D C': 'DC',
});
const CA_NAME_TO_CODE = invert(CA_PROVINCE_NAMES, {
  PEI: 'PE',
  PQ: 'QC',
  QUE: 'QC',
  NFLD: 'NL',
  NF: 'NL',
  NEWFOUNDLAND: 'NL',
  NWT: 'NT',
});

function invert(
  names: Record<string, string>,
  aliases: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...aliases };
  for (const [code, name] of Object.entries(names)) {
    out[name.toUpperCase()] = code;
  }
  return out;
}

let usZips: Record<string, PostalPlace[]> | null = null;

export function loadUsZipPlaces(): Record<string, PostalPlace[]> {
  if (usZips) return usZips;
  const raw = JSON.parse(
    readFileSync(join(__dirname, 'data', 'us-zip-places.json'), 'utf8'),
  ) as Record<string, [string, string][]>;
  const places: Record<string, PostalPlace[]> = {};
  for (const [zip, rows] of Object.entries(raw)) {
    places[zip] = rows
      .filter((row) => row[0] && row[1])
      .map(([city, state]) => ({ city, state }));
  }
  usZips = places;
  return places;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

function canonicalRegion(
  countryCode: string,
  raw: string | null,
): string | null {
  if (!raw) return null;
  const token = raw
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (countryCode === 'US') {
    if (US_STATE_NAMES[token]) return token;
    return US_NAME_TO_CODE[token] ?? null;
  }
  if (countryCode === 'CA') {
    if (CA_PROVINCE_NAMES[token]) return token;
    return CA_NAME_TO_CODE[token] ?? null;
  }
  return token;
}

function citiesMatch(entered: string | null, place: string): boolean {
  if (!entered) return true;
  const norm = (value: string) =>
    value.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  return norm(entered) === norm(place);
}

function currentOf(
  input: AddressCheckInput,
  countryCode: string,
): ShipToAddressView {
  return {
    name: blankToNull(input.name),
    street: blankToNull(input.street),
    city: blankToNull(input.city),
    state: blankToNull(input.state),
    postalCode: (input.postalCode ?? '').trim(),
    countryCode,
  };
}

export function checkPostalAddress(
  input: AddressCheckInput,
  zips: Record<string, PostalPlace[]> = loadUsZipPlaces(),
): AddressCheckResult {
  const postalCode = (input.postalCode ?? '').trim();
  const countryCode = (input.countryCode ?? '').trim().toUpperCase();
  const current = currentOf(input, countryCode);
  const missing = [
    !postalCode ? 'postal code' : null,
    !countryCode ? 'country code' : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      status: 'blocked',
      message: `The ship-to address is missing ${missing.join(' and ')}, so no quote can be requested.`,
      current,
      suggestions: [],
    };
  }

  if (countryCode === 'US') return checkUs(current, zips);
  if (countryCode === 'CA') return checkCanada(current);
  return { status: 'ready', message: null, current, suggestions: [] };
}

function checkUs(
  current: ShipToAddressView,
  zips: Record<string, PostalPlace[]>,
): AddressCheckResult {
  const compact = current.postalCode.replace(/\s+/g, '');
  const zip5 = compact.match(/^(\d{5})(?:-\d{4})?$/)?.[1];
  if (!zip5) {
    return {
      status: 'confirm',
      message: `"${current.postalCode}" is not a United States ZIP code. No city or state can be suggested from it.`,
      current,
      suggestions: [],
    };
  }
  const places = zips[zip5] ?? [];
  if (places.length === 0) {
    return {
      status: 'confirm',
      message: `"${zip5}" is not a known United States ZIP code. No city or state can be suggested from it.`,
      current,
      suggestions: [],
    };
  }

  const enteredState = canonicalRegion('US', current.state);
  const stateMatches = places.some((place) => place.state === enteredState);
  const cityMatches = places.some(
    (place) =>
      place.state === enteredState && citiesMatch(current.city, place.city),
  );
  if (stateMatches && cityMatches) {
    return { status: 'ready', message: null, current, suggestions: [] };
  }

  const suggestions: SuggestedAddress[] = places.map((place) => ({
    city: place.city,
    state: place.state,
    postalCode: current.postalCode,
    countryCode: 'US',
  }));
  const listed = places
    .map((place) => `${place.city}, ${place.state}`)
    .join('; ');
  const message =
    places.length === 1
      ? `ZIP ${zip5} is ${listed}.`
      : `ZIP ${zip5} is used by more than one city: ${listed}.`;
  return { status: 'confirm', message, current, suggestions };
}

function checkCanada(current: ShipToAddressView): AddressCheckResult {
  const compact = current.postalCode.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) {
    return {
      status: 'confirm',
      message: `"${current.postalCode}" is not a Canadian postal code. No province can be suggested from it.`,
      current,
      suggestions: [],
    };
  }
  const provinces = CA_PREFIX[compact[0]] ?? [];
  if (provinces.length === 0) {
    return {
      status: 'confirm',
      message: `"${current.postalCode}" is not a known Canadian postal code. No province can be suggested from it.`,
      current,
      suggestions: [],
    };
  }
  const entered = canonicalRegion('CA', current.state);
  if (entered && provinces.includes(entered)) {
    return { status: 'ready', message: null, current, suggestions: [] };
  }
  const suggestions: SuggestedAddress[] = provinces.map((state) => ({
    city: current.city,
    state,
    postalCode: current.postalCode,
    countryCode: 'CA',
  }));
  const names = provinces.map((code) => CA_PROVINCE_NAMES[code] ?? code);
  const where = names.length === 1 ? names[0] : `${names[0]} or ${names[1]}`;
  return {
    status: 'confirm',
    message: `Postal code ${compact} is in ${where}. The city on the note was left as entered.`,
    current,
    suggestions,
  };
}
