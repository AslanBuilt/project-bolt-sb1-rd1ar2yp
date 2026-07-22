export interface WeatherData {
  temp: number;
  feelsLike: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  precipitationProbability: number | null;
  isCold: boolean;
  isHot: boolean;
  isRainy: boolean;
}

export interface GeocodedLocation {
  lat: number;
  lon: number;
  name: string;
}

const WMO_CODE_MAP: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
};

/**
 * Resolve a free-typed city name to coordinates using Open-Meteo's free
 * geocoding API (no key needed, same provider as the forecast itself).
 * Resolved once and stored - not called on every recommendation.
 */
export async function geocodeLocation(query: string): Promise<GeocodedLocation | null> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Geocoding API failed');

    const data = await response.json();
    const result = data.results?.[0];
    if (!result) return null;

    const nameParts = [result.name, result.admin1, result.country].filter(Boolean);
    return { lat: result.latitude, lon: result.longitude, name: nameParts.join(', ') };
  } catch (error) {
    console.error('Geocoding failed:', error);
    return null;
  }
}

/**
 * Fetch today's forecast for a stored lat/lon (not live browser geolocation -
 * the location is resolved once via geocodeLocation() and saved in Settings,
 * so this works reliably without a permission prompt every time).
 */
export async function getCurrentWeather(lat: number, lon: number): Promise<WeatherData | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=precipitation_probability_max&temperature_unit=fahrenheit&timezone=auto`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Weather API failed');

    const data = await response.json();
    const current = data.current;
    const precipitationProbability: number | null = data.daily?.precipitation_probability_max?.[0] ?? null;

    const temp = Math.round(current.temperature_2m);
    const feelsLike = Math.round(current.apparent_temperature);
    const condition = WMO_CODE_MAP[current.weather_code] || 'Unknown';

    const rainyByCode = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(current.weather_code);

    return {
      temp,
      feelsLike,
      condition,
      humidity: current.relative_humidity_2m,
      windSpeed: Math.round(current.wind_speed_10m),
      precipitationProbability,
      isCold: feelsLike < 50,
      isHot: feelsLike > 82,
      // Prefer the explicit daily precipitation probability (spec's >50% threshold)
      // when available; fall back to the WMO weather-code check otherwise.
      isRainy: precipitationProbability !== null ? precipitationProbability > 50 : rainyByCode,
    };
  } catch (error) {
    console.error('Weather fetch failed:', error);
    return null;
  }
}

export function getWeatherRecommendation(weather: WeatherData | null): string[] {
  if (!weather) return [];

  const hints: string[] = [];

  if (weather.isCold) {
    hints.push('Consider layering - it\'s cold outside');
    if (weather.feelsLike < 41) {
      hints.push('Wear warm outerwear');
    }
  }

  if (weather.isHot) {
    hints.push('Light, breathable fabrics recommended');
    hints.push('Skip the outerwear today');
  }

  if (weather.isRainy) {
    hints.push('Bring an umbrella or waterproof layer');
  }

  if (weather.condition.includes('thunderstorm')) {
    hints.push('Avoid wearing suede or delicate fabrics');
  }

  return hints;
}
