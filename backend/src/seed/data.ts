// Static catalogue used by the seed script.

export const CITY_POINTS: Record<string, string[]> = {
  Mumbai: ['Dadar East', 'Sion Circle', 'Vashi Plaza', 'Borivali West'],
  Pune: ['Swargate', 'Shivajinagar', 'Wakad Bridge', 'Hadapsar'],
  Delhi: ['Kashmere Gate ISBT', 'Anand Vihar ISBT', 'Dhaula Kuan'],
  Jaipur: ['Sindhi Camp', 'Narayan Singh Circle', 'Durgapura'],
  Agra: ['Idgah Bus Stand', 'Bijlighar', 'Sikandra'],
  Bengaluru: ['Majestic', 'Madiwala', 'Hebbal', 'Electronic City'],
  Chennai: ['Koyambedu CMBT', 'Guindy', 'Tambaram'],
  Hyderabad: ['Ameerpet', 'Kukatpally', 'Mehdipatnam', 'LB Nagar'],
  Ahmedabad: ['Paldi', 'Geeta Mandir', 'Iskcon Cross Road'],
  Goa: ['Panaji Kadamba Stand', 'Mapusa', 'Margao'],
};

// [cityA, cityB, distanceKm, durationMinutes, via stops from A to B]
export const ROUTE_PAIRS: [string, string, number, number, string[]][] = [
  ['Mumbai', 'Pune', 150, 210, ['Lonavala']],
  ['Mumbai', 'Goa', 590, 660, ['Chiplun', 'Kankavli']],
  ['Mumbai', 'Ahmedabad', 530, 540, ['Vapi', 'Surat', 'Vadodara']],
  ['Pune', 'Goa', 450, 540, ['Satara', 'Kolhapur', 'Belagavi']],
  ['Pune', 'Hyderabad', 560, 600, ['Solapur', 'Zaheerabad']],
  ['Bengaluru', 'Chennai', 350, 390, ['Hosur', 'Vellore']],
  ['Bengaluru', 'Hyderabad', 570, 600, ['Anantapur', 'Kurnool']],
  ['Bengaluru', 'Goa', 560, 660, ['Tumakuru', 'Hubballi']],
  ['Chennai', 'Hyderabad', 630, 660, ['Nellore', 'Ongole']],
  ['Delhi', 'Jaipur', 280, 330, ['Gurugram', 'Behror']],
  ['Delhi', 'Agra', 230, 240, ['Noida', 'Mathura']],
  ['Jaipur', 'Agra', 240, 270, ['Dausa', 'Bharatpur']],
  ['Jaipur', 'Ahmedabad', 670, 720, ['Ajmer', 'Udaipur']],
];

export const CITY_CODES: Record<string, string> = {
  Mumbai: 'MUM',
  Pune: 'PNQ',
  Delhi: 'DEL',
  Jaipur: 'JAI',
  Agra: 'AGR',
  Bengaluru: 'BLR',
  Chennai: 'MAA',
  Hyderabad: 'HYD',
  Ahmedabad: 'AMD',
  Goa: 'GOI',
};

export const OPERATORS = [
  { name: 'SwiftWays Travels', phone: '+91 22 4000 1001', email: 'care@swiftways.example' },
  { name: 'Konkan Rider', phone: '+91 20 4000 2002', email: 'help@konkanrider.example' },
  { name: 'Royal Desert Lines', phone: '+91 141 400 3003', email: 'support@royaldesert.example' },
  { name: 'Deccan Star Travels', phone: '+91 40 4000 4004', email: 'care@deccanstar.example' },
  { name: 'Coastal Comfort', phone: '+91 44 4000 5005', email: 'hello@coastalcomfort.example' },
  { name: 'MetroLiner Express', phone: '+91 80 4000 6006', email: 'support@metroliner.example' },
];

export const BUS_MODELS = [
  { name: 'Volvo 9600 Multi-Axle A/C Sleeper (2+1)', type: 'sleeper', ac: true, amenities: ['wifi', 'charging', 'water', 'blanket', 'reading_light', 'cctv', 'gps'] },
  { name: 'Scania Metrolink A/C Seater (2+2)', type: 'seater', ac: true, amenities: ['charging', 'water', 'tv', 'cctv', 'gps'] },
  { name: 'BharatBenz A/C Sleeper (2+1)', type: 'sleeper', ac: true, amenities: ['charging', 'water', 'blanket', 'reading_light', 'gps'] },
  { name: 'Ashok Leyland Non A/C Seater (2+2)', type: 'seater', ac: false, amenities: ['water', 'gps'] },
  { name: 'Eicher Skyline Non A/C Sleeper (2+1)', type: 'sleeper', ac: false, amenities: ['charging', 'reading_light'] },
  { name: 'Volvo 9400 B11R A/C Seater (2+2)', type: 'seater', ac: true, amenities: ['wifi', 'charging', 'water', 'snacks', 'tv', 'cctv'] },
] as const;

// Rate per km by bus category.
export const FARE_PER_KM = { seater: { ac: 1.4, nonac: 1.0 }, sleeper: { ac: 2.0, nonac: 1.5 } } as const;

// Daily departures (IST hour, minute): short hops run through the day, long routes mostly overnight.
export const SHORT_DEPARTURES: [number, number][] = [
  [6, 0],
  [10, 30],
  [15, 0],
  [19, 30],
];
export const LONG_DEPARTURES: [number, number][] = [
  [7, 0],
  [19, 30],
  [21, 0],
  [22, 30],
];
