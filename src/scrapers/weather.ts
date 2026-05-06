export interface WeatherData {
  city: string;
  temp: string;
  humidity: string;
  wind: string;
  description: string;
}

export async function getWeather(city: string): Promise<WeatherData> {
  try {
    // Using wttr.in public API (free, no key required)
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Weather fetch failed');
    const data = await res.json();
    
    const current = data.current_condition?.[0] || {};
    const area = data.nearest_area?.[0]?.areaName?.[0]?.value || city;

    return {
      city: area,
      temp: `${current.temp_C}°C`,
      humidity: `${current.humidity}%`,
      wind: `${current.windSpeedKmph} km/h`,
      description: current.weatherDesc?.[0]?.value || 'Unknown'
    };
  } catch (e) {
    console.error("Weather Error:", e);
    return {} as WeatherData;
  }
}
