/**
 * Coordinates of the MyBus cities and of the boarding / dropping / via stops used by the catalogue.
 * Used by the seed (stops get lat/lon) and by the route planner (quick picks and the search fallback
 * when the map provider is not available). Approximate public locations, WGS84.
 */
export type LatLon = [number, number];

export const CITY_COORDS: Record<string, LatLon> = {
  Agra: [27.1767, 78.0081],
  Ahmedabad: [23.0225, 72.5714],
  Bengaluru: [12.9716, 77.5946],
  Chennai: [13.0827, 80.2707],
  Delhi: [28.6139, 77.209],
  Goa: [15.4909, 73.8278],
  Hyderabad: [17.385, 78.4867],
  Jaipur: [26.9124, 75.7873],
  Mumbai: [19.076, 72.8777],
  Pune: [18.5204, 73.8567],
};

/** Stop name (without the ", City" suffix used for boarding / dropping points) → coordinates. */
export const STOP_COORDS: Record<string, LatLon> = {
  // Mumbai
  'Dadar East': [19.0178, 72.8478],
  'Sion Circle': [19.043, 72.862],
  'Vashi Plaza': [19.0771, 72.9986],
  'Borivali West': [19.2307, 72.8567],
  // Pune
  Swargate: [18.5018, 73.8636],
  Shivajinagar: [18.5308, 73.8475],
  'Wakad Bridge': [18.5987, 73.7652],
  Hadapsar: [18.5089, 73.926],
  // Delhi
  'Kashmere Gate ISBT': [28.6675, 77.228],
  'Anand Vihar ISBT': [28.6469, 77.316],
  'Dhaula Kuan': [28.5918, 77.1617],
  // Jaipur
  'Sindhi Camp': [26.926, 75.8],
  'Narayan Singh Circle': [26.903, 75.805],
  Durgapura: [26.846, 75.79],
  // Agra
  'Idgah Bus Stand': [27.166, 78.005],
  Bijlighar: [27.188, 78.02],
  Sikandra: [27.22, 77.95],
  // Bengaluru
  Majestic: [12.9767, 77.5713],
  Madiwala: [12.9226, 77.6174],
  Hebbal: [13.0358, 77.597],
  'Electronic City': [12.8452, 77.6602],
  // Chennai
  'Koyambedu CMBT': [13.0694, 80.1948],
  Guindy: [13.0067, 80.2206],
  Tambaram: [12.9249, 80.1],
  // Hyderabad
  Ameerpet: [17.4375, 78.4482],
  Kukatpally: [17.4948, 78.3996],
  Mehdipatnam: [17.3916, 78.4398],
  'LB Nagar': [17.3457, 78.5522],
  // Ahmedabad
  Paldi: [23.012, 72.56],
  'Geeta Mandir': [23.013, 72.595],
  'Iskcon Cross Road': [23.027, 72.507],
  // Goa
  'Panaji Kadamba Stand': [15.496, 73.829],
  Mapusa: [15.5916, 73.8089],
  Margao: [15.2832, 73.9862],
  // Via towns
  Lonavala: [18.7546, 73.4062],
  Chiplun: [17.532, 73.515],
  Kankavli: [16.265, 73.711],
  Vapi: [20.3893, 72.9106],
  Surat: [21.1702, 72.8311],
  Vadodara: [22.3072, 73.1812],
  Satara: [17.6805, 74.0183],
  Kolhapur: [16.705, 74.2433],
  Belagavi: [15.8497, 74.4977],
  Solapur: [17.6599, 75.9064],
  Zaheerabad: [17.6815, 77.6074],
  Hosur: [12.7409, 77.8253],
  Vellore: [12.9165, 79.1325],
  Anantapur: [14.6819, 77.6006],
  Kurnool: [15.8281, 78.0373],
  Tumakuru: [13.3379, 77.1173],
  Hubballi: [15.3647, 75.124],
  Nellore: [14.4426, 79.9865],
  Ongole: [15.5057, 80.0499],
  Gurugram: [28.4595, 77.0266],
  Behror: [27.8886, 76.286],
  Noida: [28.5355, 77.391],
  Mathura: [27.4924, 77.6737],
  Dausa: [26.8932, 76.3375],
  Bharatpur: [27.2152, 77.493],
  Ajmer: [26.4499, 74.6399],
  Udaipur: [24.5854, 73.7125],
};

/** Coordinates of a stop as stored on a route ("Dadar East, Mumbai" or "Lonavala"). */
export function stopCoords(name: string): LatLon | undefined {
  return STOP_COORDS[name] ?? STOP_COORDS[name.split(',')[0].trim()];
}
