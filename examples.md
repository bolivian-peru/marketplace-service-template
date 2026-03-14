# YouTube Transcript Scraper - Examples

## 📚 Usage Examples

### Basic Usage

#### Extract Transcript from URL

```bash
python youtube_transcript.py https://youtu.be/dQw4w9WgXcQ
```

#### Extract with Specific Language

```bash
python youtube_transcript.py https://www.youtube.com/watch?v=VIDEO_ID es
```

#### Using Direct Video ID

```bash
python youtube_transcript.py dQw4w9WgXcQ
```

---

## 🔌 API Examples

### cURL Examples

#### Health Check

```bash
curl http://localhost:8000/health
```

Response:
```json
{
  "status": "healthy",
  "service": "youtube-transcript-scraper",
  "version": "1.0.0"
}
```

#### Get Transcript (JSON)

```bash
curl http://localhost:8000/api/transcript/dQw4w9WgXcQ
```

#### Get Transcript (Plain Text)

```bash
curl http://localhost:8000/api/transcript/dQw4w9WgXcQ?format=text
```

#### Get Transcript with Timestamps

```bash
curl http://localhost:8000/api/transcript/dQw4w9WgXcQ?format=timestamps
```

#### Get Available Languages

```bash
curl http://localhost:8000/api/languages/dQw4w9WgXcQ
```

#### POST Request with JSON

```bash
curl -X POST http://localhost:8000/api/transcript \
  -H "Content-Type: application/json" \
  -d '{
    "video_id": "dQw4w9WgXcQ",
    "language": "en",
    "format": "json"
  }'
```

---

### Python Examples

#### Using urllib (Standard Library)

```python
import urllib.request
import json

url = "http://localhost:8000/api/transcript/dQw4w9WgXcQ"

with urllib.request.urlopen(url) as response:
    data = json.loads(response.read().decode('utf-8'))
    
    if data['success']:
        print(f"Video: {data['video_id']}")
        print(f"Language: {data['language']['language_name']}")
        print(f"Duration: {data['duration']:.1f} seconds")
        print("\nFirst 5 lines:")
        for segment in data['transcript'][:5]:
            print(f"  [{segment['offset']}] {segment['text']}")
```

#### With Error Handling

```python
import urllib.request
import urllib.error
import json

def get_transcript(video_id, language='en'):
    url = f"http://localhost:8000/api/transcript/{video_id}?lang={language}"
    
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code == 402:
            return {"error": "Payment required", "code": 402}
        return {"error": f"HTTP {e.code}", "code": e.code}
    except Exception as e:
        return {"error": str(e)}

# Usage
result = get_transcript("dQw4w9WgXcQ")
if 'error' not in result:
    print(result['transcript'][0]['text'])
```

#### POST Request Example

```python
import urllib.request
import json

data = {
    "video_id": "dQw4w9WgXcQ",
    "language": "en",
    "format": "timestamps"
}

req = urllib.request.Request(
    "http://localhost:8000/api/transcript",
    data=json.dumps(data).encode('utf-8'),
    headers={"Content-Type": "application/json"},
    method="POST"
)

with urllib.request.urlopen(req) as response:
    result = json.loads(response.read().decode('utf-8'))
    print(result)
```

---

### JavaScript/Node.js Examples

#### Using fetch

```javascript
async function getTranscript(videoId, language = 'en') {
  const url = `http://localhost:8000/api/transcript/${videoId}?lang=${language}`;
  
  try {
    const response = await fetch(url);
    
    if (response.status === 402) {
      const paymentInfo = await response.json();
      console.log('Payment required:', paymentInfo);
      return null;
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
}

// Usage
getTranscript('dQw4w9WgXcQ').then(data => {
  if (data) {
    console.log('Transcript:', data.transcript[0].text);
  }
});
```

#### With Payment

```javascript
async function getTranscriptWithPayment(videoId, paymentPayload) {
  const url = `http://localhost:8000/api/transcript/${videoId}`;
  
  const response = await fetch(url, {
    headers: {
      'X-Payment-Version': 'x402-v1',
      'X-Payment-Scheme': 'x402-solana',
      'Authorization': `x402 ${JSON.stringify(paymentPayload)}`
    }
  });
  
  return await response.json();
}
```

---

## 💰 x402 Payment Examples

### Payment Flow Example

```python
import urllib.request
import json
from x402_payment import X402PaymentHandler

def fetch_with_payment(video_id):
    url = f"http://localhost:8000/api/transcript/{video_id}"
    handler = X402PaymentHandler(wallet_address='YourWalletAddress')
    
    # Step 1: Initial request
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code != 402:
            raise
        
        # Step 2: Parse payment requirements
        payment_info = handler.parse_payment_required(dict(e.headers))
        print(f"Payment required: {payment_info}")
        
        # Step 3: Create payment
        payment_payload = handler.create_payment_payload(
            payment_info, 
            {'video_id': video_id}
        )
        
        # Step 4: Retry with payment
        payment_headers = handler.create_payment_headers(payment_payload)
        
        req = urllib.request.Request(url)
        for key, value in payment_headers.items():
            req.add_header(key, value)
        
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))

# Usage
result = fetch_with_payment('dQw4w9WgXcQ')
print(result)
```

---

## 🧪 Testing Examples

### Test Different Video Formats

```python
from youtube_transcript import YouTubeTranscriptScraper

scraper = YouTubeTranscriptScraper()

# Test URL formats
urls = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "dQw4w9WgXcQ"
]

for url in urls:
    video_id = scraper.extract_video_id(url)
    print(f"{url} -> {video_id}")
```

### Test Multiple Languages

```python
languages = ['en', 'es', 'fr', 'de', 'ja', 'ko']

for lang in languages:
    result = scraper.fetch_transcript('dQw4w9WgXcQ', lang)
    if result['success']:
        print(f"✓ {lang}: {result['language']['language_name']}")
    else:
        print(f"✗ {lang}: {result.get('error')}")
```

---

## 🎯 Real-World Use Cases

### 1. Content Analysis

```python
def analyze_video_content(video_id):
    result = scraper.fetch_transcript(video_id)
    
    if not result['success']:
        return None
    
    # Word count
    words = ' '.join([seg['text'] for seg in result['transcript']]).split()
    
    # Speaking rate
    duration = result['duration']
    words_per_minute = len(words) / (duration / 60)
    
    return {
        'duration': duration,
        'word_count': len(words),
        'speaking_rate': f"{words_per_minute:.1f} WPM",
        'segments': len(result['transcript'])
    }
```

### 2. Subtitle Generation

```python
def generate_srt(video_id, output_file='subtitles.srt'):
    result = scraper.fetch_transcript(video_id)
    
    if not result['success']:
        return False
    
    with open(output_file, 'w', encoding='utf-8') as f:
        for i, segment in enumerate(result['transcript'], 1):
            start = format_srt_time(segment['start'])
            end = format_srt_time(segment['start'] + segment['duration'])
            f.write(f"{i}\n{start} --> {end}\n{segment['text']}\n\n")
    
    return True

def format_srt_time(seconds):
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
```

### 3. Search in Transcript

```python
def search_transcript(video_id, query):
    result = scraper.fetch_transcript(video_id)
    
    if not result['success']:
        return []
    
    matches = []
    query_lower = query.lower()
    
    for segment in result['transcript']:
        if query_lower in segment['text'].lower():
            matches.append({
                'offset': segment['offset'],
                'text': segment['text'],
                'start': segment['start']
            })
    
    return matches
```

---

## 🚀 Production Deployment

### Docker Example

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY youtube_transcript.py x402_payment.py api_server.py ./

EXPOSE 8000

CMD ["python", "api_server.py", "8000"]
```

### Docker Compose

```yaml
version: '3'
services:
  transcript-api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - PAYMENT_ENABLED=true
      - WALLET_ADDRESS=YourWalletAddress
```

---

**Happy Scraping! 🎬**
