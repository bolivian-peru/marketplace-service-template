#!/usr/bin/env python3
"""
YouTube Transcript Scraper for Proxies.sx x402 Marketplace
Bounty: $50 in $SX tokens
"""

import requests
import json
from typing import Optional, Dict, Any

class YouTubeTranscriptScraper:
    """Fetch YouTube video transcripts"""
    
    def __init__(self, api_key: Optional[str] = None):
        self.base_url = "https://www.youtube.com/watch"
    
    def extract_video_id(self, url: str) -> str:
        """Extract video ID from YouTube URL"""
        if "youtu.be/" in url:
            return url.split("youtu.be/")[-1].split("?")[0]
        elif "watch?v=" in url:
            return url.split("watch?v=")[-1].split("&")[0]
        else:
            return url
    
    def get_transcript(self, video_id: str) -> Dict[str, Any]:
        """Fetch transcript for a YouTube video"""
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            transcript = YouTubeTranscriptApi.get_transcript(video_id)
            full_text = " ".join([entry['text'] for entry in transcript])
            
            return {
                'success': True,
                'video_id': video_id,
                'transcript': full_text,
                'segments': transcript,
                'duration': len(transcript) * 30
            }
        except ImportError:
            return {
                'success': False,
                'error': 'Install youtube-transcript-api: pip install youtube-transcript-api',
                'video_id': video_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'video_id': video_id
            }

if __name__ == '__main__':
    import sys
    scraper = YouTubeTranscriptScraper()
    video_id = sys.argv[1] if len(sys.argv) > 1 else input("Enter YouTube video ID or URL: ")
    result = scraper.get_transcript(video_id)
    
    if result['success']:
        print(f"\n✅ Transcript for {video_id}:")
        print("-" * 50)
        print(result['transcript'][:500] + "..." if len(result['transcript']) > 500 else result['transcript'])
        print("-" * 50)
    else:
        print(f"\n❌ Error: {result['error']}")
    
    with open(f"transcript_{video_id}.json", 'w') as f:
        json.dump(result, f, indent=2)
    print(f"\n💾 Saved to transcript_{video_id}.json")
