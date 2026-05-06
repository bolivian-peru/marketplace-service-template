export interface SpotifyTrack {
  rank: string;
  title: string;
  artist: string;
  streams: string;
  link: string;
}

export async function getSpotifyTop50(): Promise<SpotifyTrack[]> {
  try {
    // Mock/Scrape fallback since Spotify blocks bots often
    return [
      { rank: '1', title: 'Espresso', artist: 'Sabrina Carpenter', streams: '5.2M', link: 'https://spotify.com' },
      { rank: '2', title: 'Die With A Smile', artist: 'Lady Gaga', streams: '4.8M', link: 'https://spotify.com' }
    ];
  } catch (e) {
    return [];
  }
}
