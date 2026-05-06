import * as cheerio from 'cheerio';

export interface StockQuote {
  symbol: string;
  price: string;
  change: string;
  changePercent: string;
}

export async function getStockQuote(symbol: string): Promise<StockQuote> {
  try {
    const url = `https://www.google.com/finance/quote/${symbol}:NASDAQ`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const $ = cheerio.load(html);
    
    const price = $('.YMlKec').text();
    const change = $('.uy359e').text().split('\n')[0];
    const percent = $('.uy359e').text().split('\n')[1] || '';

    return {
      symbol: symbol.toUpperCase(),
      price: price || 'N/A',
      change: change || 'N/A',
      changePercent: percent || ''
    };
  } catch (e) {
    return { symbol: symbol.toUpperCase(), price: 'N/A', change: 'N/A', changePercent: '' };
  }
}
