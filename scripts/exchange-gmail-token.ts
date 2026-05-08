/**
 * Gmail API OAuth2 Token Exchange Script
 * 
 * Run this once to get your refresh token:
 * 
 *   1. Get CLIENT_ID and CLIENT_SECRET from Google Cloud Console
 *   2. Build the auth URL and open it in browser
 *   3. Copy the authorization code from the URL
 *   4. Run: bun run scripts/exchange-token.ts <code>
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.argv[2];
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || process.argv[3];
const AUTH_CODE = process.argv[4];

if (!CLIENT_ID || !CLIENT_SECRET || !AUTH_CODE) {
  console.log(`
Gmail API OAuth2 Token Exchange Script
=====================================

Usage:
  bun run scripts/exchange-token.ts <auth_code> [client_id] [client_secret]

Environment variables (alternative to args):
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET

Steps to get auth code:
1. Go to: https://console.cloud.google.com/apis/credentials
2. Create OAuth2 Client ID (Desktop app type)
3. Build auth URL:
   https://accounts.google.com/o/oauth2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob&scope=https://www.googleapis.com/auth/gmail.readonly&response_type=code&access_type=offline
4. Open URL in browser, authorize, copy the code from the URL
5. Exchange: bun run scripts/exchange-token.ts <code>

The refresh token will be saved to REFRESH_TOKEN.txt
`);
  process.exit(1);
}

async function exchangeCode(code: string, clientId: string, clientSecret: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    console.error('Error:', data.error, data.error_description);
    process.exit(1);
  }

  console.log('✅ Success! Here are your credentials:\n');
  console.log('REFRESH_TOKEN=' + data.refresh_token);
  console.log('\nAdd these to your .env file:');
  console.log(`GOOGLE_CLIENT_ID=${clientId}`);
  console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
  console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}`);
  
  // Save to file
  const fs = await import('fs');
  fs.writeFileSync('REFRESH_TOKEN.txt', data.refresh_token);
  console.log('\nSaved to REFRESH_TOKEN.txt');
}

exchangeCode(AUTH_CODE, CLIENT_ID, CLIENT_SECRET);
