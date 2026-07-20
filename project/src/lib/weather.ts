export interface WeatherData {
  temp: number;
  feelsLike: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  isCold: boolean;
  isHot: boolean;
  isRainy: boolean;
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

export async function getCurrentWeather(): Promise<WeatherData | null> {
  try {
    // Get user's location
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 600000, // 10 minute cache
      });
    });

    const { latitude, longitude } = position.coords;

    // Use Open-Meteo (free, no API key needed)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Weather API failed');

    const data = await response.json();
    const current = data.current;

    const temp = Math.round(current.temperature_2m);
    const feelsLike = Math.round(current.apparent_temperature);
    const condition = WMO_CODE_MAP[current.weather_code] || 'Unknown';

    return {
      temp,
      feelsLike,
      condition,
      humidity: current.relative_humidity_2m,
      windSpeed: Math.round(current.wind_speed_10m),
      isCold: feelsLike < 50,
      isHot: feelsLike > 82,
      isRainy: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(current.weather_code),
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
