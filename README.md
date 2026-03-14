# YouTube Transcript Scraper

🎬 Extract video transcripts from YouTube with x402 payment integration.

## Features

- ✅ Extract video ID from multiple URL formats
- ✅ Fetch transcripts with timestamps
- ✅ Multi-language support with automatic fallback
- ✅ x402 payment protocol integration
- ✅ RESTful API endpoints
- ✅ Pure Python (no external dependencies)

## Quick Start

### 1. Extract Transcript (CLI)

```bash
python youtube_transcript.py <video_url_or_id> [language]

# Examples
python youtube_transcript.py https://youtu.be/dQw4w9WgXcQ
python youtube_transcript.py https://www.youtube.com/watch?v=dQw4w9WgXcQ en
python youtube_transcript.py dQw4w9WgXcQ es
```

### 2. Run API Server

```bash
python api_server.py [port]

# Default port 8000
python api_server.py
python api_server.py 3000
```

### 3. API Usage

```bash
# Health check
curl http://localhost:8000/health

# Get transcript
curl http://localhost:8000/api/transcript/dQw4w9WgXcQ

# Get with timestamps
curl http://localhost:8000/api/transcript/dQw4w9WgXcQ?format=timestamps

# Get available languages
curl http://localhost:8000/api/languages/dQw4w9WgXcQ

# POST request
curl -X POST http://localhost:8000/api/transcript \
  -H "Content-Type: application/json" \
  -d '{"video_id": "dQw4w9WgXcQ", "language": "en", "format": "json"}'
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | API info |
| GET | `/health` | Health check |
| GET | `/api/transcript/<video_id>` | Get transcript |
| GET | `/api/languages/<video_id>` | Get available languages |
| GET | `/api/pricing` | Get pricing info |
| POST | `/api/transcript` | Get transcript (JSON body) |

### Query Parameters

- `lang` - Language code (default: `en`)
- `format` - Response format: `json`, `text`, `timestamps` (default: `json`)

### Response Format

```json
{
  "success": true,
  "video_id": "dQw4w9WgXcQ",
  "language": {
    "language_code": "en",
    "language_name": "English",
    "is_auto_generated": false
  },
  "transcript": [
    {
      "start": 0.0,
      "duration": 3.5,
      "text": "We're no strangers to love",
      "offset": "00:00"
    }
  ],
  "duration": 212.5
}
```

## x402 Payment Integration

This service supports the x402 micropayment protocol for monetizing API access.

### Payment Flow

1. Client makes request to API
2. Server responds with 402 Payment Required (if enabled)
3. Client creates payment using x402 protocol
4. Client retries request with payment headers
5. Server verifies payment and returns transcript

### Payment Headers

```
X-Payment-Version: x402-v1
X-Payment-Scheme: x402-solana
Authorization: x402 <payment_payload>
```

### Pricing Tiers

| Tier | Price | Features |
|------|-------|----------|
| Basic | $0.01 USDC | Text-only transcript |
| Premium | $0.05 USDC | Timestamps, multi-language |

### Enable Payment

Uncomment payment verification in `api_server.py`:

```python
# In do_GET and do_POST methods:
if not self.verify_payment():
    self.send_payment_required(video_id)
    return
```

## Supported URL Formats

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- `https://www.youtube.com/v/VIDEO_ID`
- Direct video ID: `VIDEO_ID`

## Language Support

The scraper automatically detects available languages for each video and falls back to English if the requested language is not available.

Common language codes:
- `en` - English
- `es` - Spanish
- `fr` - French
- `de` - German
- `ja` - Japanese
- `ko` - Korean
- `zh-Hans` - Chinese (Simplified)
- `zh-Hant` - Chinese (Traditional)

## Testing

Run the test suite:

```bash
python test_script.py
```

## Demo

Run the interactive demo:

```bash
python demo.py
```

## Project Structure

```
marketplace-service-template/
├── youtube_transcript.py   # Core transcript extraction logic
├── x402_payment.py         # x402 payment protocol handler
├── api_server.py           # RESTful API server
├── README.md               # This file
├── examples.md             # Usage examples
├── test_script.py          # Test suite
├── demo.py                 # Interactive demo
└── requirements.txt        # Dependencies (empty - pure Python!)
```

## Technical Details

### No External Dependencies

This project uses only Python standard library:
- `urllib.request` - HTTP requests
- `re` - Regular expressions
- `json` - JSON parsing
- `hashlib` - Cryptographic hashing
- `http.server` - HTTP server

### How It Works

1. **Video ID Extraction**: Regex patterns match various YouTube URL formats
2. **Page Fetching**: Download YouTube watch page to extract player config
3. **Language Detection**: Parse caption tracks from player response
4. **Transcript Fetching**: Request timedtext API with video ID and language
5. **XML Parsing**: Parse transcript XML to extract text and timestamps

### Rate Limiting

YouTube may rate-limit requests. For production use:
- Implement request caching
- Add delays between requests
- Use rotating IP addresses
- Consider official YouTube API

## Security Notes

- This is a demo implementation
- Payment verification is simplified for demonstration
- In production, implement proper blockchain transaction verification
- Add API key authentication for production use
- Implement proper rate limiting and DDoS protection

## License

MIT License - See LICENSE file for details

## Bounty

This service was created for the $50 USDC YouTube Transcript Scraper bounty.

---

**Made with 🦞 by 牛马**
