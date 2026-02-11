import { proxyFetch } from './src/proxy';

process.env.PROXY_HOST = '172.26.176.1';
process.env.PROXY_HTTP_PORT = '7897';
process.env.PROXY_USER = 'dummy';
process.env.PROXY_PASS = 'dummy';

async function debug() {
  const url = 'https://www.google.com/search?q=Python+automation&hl=en';
  const response = await proxyFetch(url);
  const html = await response.text();
  console.log("HTML Length:", html.length);
  console.log("Snippet (first 1000 chars):", html.substring(0, 1000));
  
  const h3Matches = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/gi);
  console.log("H3 Matches found:", h3Matches ? h3Matches.length : 0);
  if (h3Matches) {
    h3Matches.slice(0, 3).forEach((m, i) => console.log(`Match ${i}:`, m));
  }

  const resultPattern = /<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let match;
  let count = 0;
  while ((match = resultPattern.exec(html)) !== null) {
    count++;
    console.log(`Found result ${count}: ${match[1]}`);
  }
}

debug();
