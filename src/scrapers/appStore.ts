import { proxyFetch } from '../proxy';

export interface AppResult {
  trackName: string;
  developerName: string;
  averageUserRating: number;
  price: number;
  description: string;
  primaryGenreName: string;
  bundleId: string;
  version: string;
  artworkUrl100: string;
}

export async function searchApps(term: string, country = 'us', limit = 10): Promise<AppResult[]> {
  const encodedTerm = encodeURIComponent(term);
  const url = `https://itunes.apple.com/search?term=${encodedTerm}&country=${country}&limit=${limit}&media=software&entity=software`;

  try {
    const response = await proxyFetch(url);
    if (!response.ok) {
      throw new Error(`App Store API returned ${response.status}`);
    }
    const data = await response.json();
    const results = data.results || [];
    
    return results.map((item: any) => ({
      trackName: item.trackName || '',
      developerName: item.artistName || '',
      averageUserRating: item.averageUserRating || 0,
      price: item.price || 0,
      description: item.description || '',
      primaryGenreName: item.primaryGenreName || '',
      bundleId: item.bundleId || '',
      version: item.version || '',
      artworkUrl100: item.artworkUrl100 || '',
    }));
  } catch (error) {
    console.error('Error fetching App Store data:', error);
    throw error;
  }
}
