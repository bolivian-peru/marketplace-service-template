// 5sim.net API integration for phone verification
// Utility functions for requesting and polling phone numbers

import axios from 'axios';

const API_KEY = process.env.FIVESIM_API_KEY;
const BASE_URL = 'https://5sim.net/v1';

export async function buyNumber(country = 'usa', product = 'google') {
  const url = `${BASE_URL}/user/buy/activation/${country}/${product}`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return res.data; // { id, phone, ... }
}

export async function pollSms(id, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const url = `${BASE_URL}/user/check/${id}`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (res.data.sms && res.data.sms.length > 0) {
      return res.data.sms[0].code;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('SMS code not received in time');
}

export async function cancelNumber(id) {
  const url = `${BASE_URL}/user/cancel/${id}`;
  await axios.get(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
}
