# YouTube Transcript Scraper

x402 Service for Proxies.sx Marketplace - **$50 Bounty**

## Quick Start

```bash
pip install -r requirements.txt
python scraper.py <VIDEO_ID_OR_URL>
```

## Examples

```bash
# Using video ID
python scraper.py "dQw4w9WgXcQ"

# Using full URL
python scraper.py "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

## API Usage

```python
from scraper import YouTubeTranscriptScraper

scraper = YouTubeTranscriptScraper()
result = scraper.get_transcript("VIDEO_ID")

if result['success']:
    print(result['transcript'])
```

## x402 Integration

See main marketplace documentation for payment integration.

## Bounty Submission

- **Platform:** Proxies.sx
- **Reward:** $50 in $SX tokens
- **Status:** Ready for submission

## License

MIT
