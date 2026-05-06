export interface CurrencyRate {
  from: string;
  to: string;
  rate: string;
}

export async function getExchangeRate(from: string, to: string): Promise<CurrencyRate> {
  try {
    const url = `https://api.exchangerate-api.com/v4/latest/${from}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Exchange rate fetch failed');
    const data = await res.json();
    return {
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      rate: data.rates[to.toUpperCase()]?.toString() || 'N/A'
    };
  } catch (e) {
    console.error("Currency Error:", e);
    return {} as CurrencyRate;
  }
}
