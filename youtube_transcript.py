#!/usr/bin/env python3
"""
YouTube Transcript Scraper
Extract video transcripts with timestamps from YouTube videos.
Pure Python implementation - no external dependencies.
"""

import re
import json
import urllib.request
import urllib.parse
from typing import Optional, List, Dict, Any


class YouTubeTranscriptScraper:
    """Extract transcripts from YouTube videos."""
    
    def __init__(self):
        self.base_url = "https://www.youtube.com"
        self.transcript_url = "https://www.youtube.com/api/timedtext"
    
    def extract_video_id(self, url: str) -> Optional[str]:
        """
        Extract video ID from various YouTube URL formats.
        
        Supports:
        - https://www.youtube.com/watch?v=VIDEO_ID
        - https://youtu.be/VIDEO_ID
        - https://www.youtube.com/embed/VIDEO_ID
        - https://www.youtube.com/v/VIDEO_ID
        """
        patterns = [
            r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})',
            r'^([a-zA-Z0-9_-]{11})$'  # Direct video ID
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        
        return None
    
    def get_video_info(self, video_id: str) -> Dict[str, Any]:
        """Get video information from YouTube watch page."""
        url = f"{self.base_url}/watch?v={video_id}"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        }
        
        req = urllib.request.Request(url, headers=headers)
        
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                html = response.read().decode('utf-8')
                
                # Extract player config
                config_match = re.search(r'ytplayer\.config\s*=\s*(\{.*?\});', html)
                if config_match:
                    config = json.loads(config_match.group(1))
                    return {
                        'success': True,
                        'config': config,
                        'html': html
                    }
                
                return {'success': False, 'error': 'Could not extract player config'}
                
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def get_transcript_languages(self, video_id: str) -> List[Dict[str, str]]:
        """Get available transcript languages for a video."""
        info = self.get_video_info(video_id)
        
        if not info['success']:
            return []
        
        languages = []
        
        try:
            # Try to extract from captions object
            captions = info['config'].get('args', {}).get('player_response', {})
            if isinstance(captions, str):
                captions = json.loads(captions)
            
            caption_tracks = captions.get('captions', {}).get('playerCaptionsTracklistRenderer', {}).get('captionTracks', [])
            
            for track in caption_tracks:
                languages.append({
                    'language_code': track.get('languageCode', ''),
                    'language_name': track.get('name', {}).get('simpleText', ''),
                    'base_url': track.get('baseUrl', ''),
                    'is_auto_generated': track.get('kind', '') == 'asr'
                })
        except Exception:
            pass
        
        return languages
    
    def fetch_transcript(self, video_id: str, language: str = 'en') -> Dict[str, Any]:
        """
        Fetch transcript for a video in specified language.
        
        Args:
            video_id: YouTube video ID
            language: Language code (default: 'en')
            
        Returns:
            Dictionary with transcript data and metadata
        """
        # Get available languages
        languages = self.get_transcript_languages(video_id)
        
        if not languages:
            return {
                'success': False,
                'error': 'No transcripts available for this video',
                'video_id': video_id
            }
        
        # Find requested language or fallback to English
        transcript_url = None
        selected_lang = None
        
        for lang in languages:
            if lang['language_code'] == language:
                transcript_url = lang['base_url']
                selected_lang = lang
                break
        
        # Fallback to English if requested language not found
        if not transcript_url:
            for lang in languages:
                if lang['language_code'] == 'en':
                    transcript_url = lang['base_url']
                    selected_lang = lang
                    break
        
        # Use first available language as last resort
        if not transcript_url and languages:
            transcript_url = languages[0]['base_url']
            selected_lang = languages[0]
        
        if not transcript_url:
            return {
                'success': False,
                'error': f'Language {language} not available',
                'available_languages': languages,
                'video_id': video_id
            }
        
        # Fetch transcript XML
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        try:
            req = urllib.request.Request(transcript_url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as response:
                xml_data = response.read().decode('utf-8')
                
                # Parse XML manually (no external dependencies)
                transcripts = self._parse_transcript_xml(xml_data)
                
                return {
                    'success': True,
                    'video_id': video_id,
                    'language': selected_lang,
                    'transcript': transcripts,
                    'duration': self._get_total_duration(transcripts)
                }
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'video_id': video_id
            }
    
    def _parse_transcript_xml(self, xml_data: str) -> List[Dict[str, Any]]:
        """Parse YouTube transcript XML into list of segments."""
        transcripts = []
        
        # Extract text, start, and duration from XML
        text_pattern = r'<text start="([^"]+)" dur="([^"]+)">(.*?)</text>'
        
        for match in re.finditer(text_pattern, xml_data, re.DOTALL):
            start = float(match.group(1))
            duration = float(match.group(2))
            text = match.group(3)
            
            # Decode HTML entities
            text = text.replace('&amp;', '&')
            text = text.replace('&lt;', '<')
            text = text.replace('&gt;', '>')
            text = text.replace('&quot;', '"')
            text = text.replace('&#39;', "'")
            
            # Clean up whitespace
            text = ' '.join(text.split())
            
            transcripts.append({
                'start': start,
                'duration': duration,
                'text': text,
                'offset': self._format_timestamp(start)
            })
        
        return transcripts
    
    def _format_timestamp(self, seconds: float) -> str:
        """Convert seconds to HH:MM:SS format."""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{secs:02d}"
        else:
            return f"{minutes:02d}:{secs:02d}"
    
    def _get_total_duration(self, transcripts: List[Dict]) -> float:
        """Calculate total duration from transcripts."""
        if not transcripts:
            return 0.0
        
        last_segment = transcripts[-1]
        return last_segment['start'] + last_segment['duration']
    
    def get_transcript_text(self, video_id: str, language: str = 'en') -> str:
        """Get transcript as plain text."""
        result = self.fetch_transcript(video_id, language)
        
        if not result['success']:
            return f"Error: {result.get('error', 'Unknown error')}"
        
        return '\n'.join([segment['text'] for segment in result['transcript']])
    
    def get_transcript_with_timestamps(self, video_id: str, language: str = 'en') -> str:
        """Get transcript with timestamps."""
        result = self.fetch_transcript(video_id, language)
        
        if not result['success']:
            return f"Error: {result.get('error', 'Unknown error')}"
        
        lines = []
        for segment in result['transcript']:
            lines.append(f"[{segment['offset']}] {segment['text']}")
        
        return '\n'.join(lines)


def main():
    """CLI interface for YouTube Transcript Scraper."""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python youtube_transcript.py <video_url_or_id> [language]")
        print("Example: python youtube_transcript.py https://youtu.be/dQw4w9WgXcQ en")
        sys.exit(1)
    
    video_input = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else 'en'
    
    scraper = YouTubeTranscriptScraper()
    video_id = scraper.extract_video_id(video_input)
    
    if not video_id:
        print(f"Error: Could not extract video ID from '{video_input}'")
        sys.exit(1)
    
    print(f"Fetching transcript for video: {video_id}")
    print(f"Language: {language}")
    print("-" * 60)
    
    result = scraper.fetch_transcript(video_id, language)
    
    if result['success']:
        print(f"Duration: {result['duration']:.1f} seconds")
        print(f"Language: {result['language']['language_name']} ({result['language']['language_code']})")
        print("-" * 60)
        
        for segment in result['transcript'][:20]:  # Show first 20 segments
            print(f"[{segment['offset']}] {segment['text']}")
        
        if len(result['transcript']) > 20:
            print(f"\n... and {len(result['transcript']) - 20} more segments")
    else:
        print(f"Error: {result.get('error', 'Unknown error')}")
        if 'available_languages' in result:
            print("\nAvailable languages:")
            for lang in result['available_languages']:
                print(f"  - {lang['language_name']} ({lang['language_code']})")


if __name__ == '__main__':
    main()
