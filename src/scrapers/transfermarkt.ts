export interface TransfermarktPlayer {
  name: string;
  club: string;
  value: string;
  position: string;
  link: string;
}
export async function searchTransfermarkt(query: string): Promise<TransfermarktPlayer[]> {
  // Placeholder - Transfermarkt is hard to scrape without headers
  return [
    { name: query || 'Player', club: 'Unknown', value: '€10M', position: 'Forward', link: 'https://transfermarkt.com' }
  ];
}
