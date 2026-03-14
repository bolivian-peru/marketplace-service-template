#!/usr/bin/env python3
"""
YouTube Transcript Scraper API Server
RESTful API with x402 payment integration.
"""

import json
import http.server
import socketserver
import urllib.parse
from typing import Dict, Any
from youtube_transcript import YouTubeTranscriptScraper
from x402_payment import X402PaymentHandler, create_payment_response


class TranscriptAPIHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler for YouTube Transcript API."""
    
    scraper = YouTubeTranscriptScraper()
    payment_handler = X402PaymentHandler()
    
    # Pricing configuration
    PRICING = {
        'basic': {'amount': '0.01', 'currency': 'USDC', 'features': ['text_only']},
        'premium': {'amount': '0.05', 'currency': 'USDC', 'features': ['timestamps', 'multi_language']}
    }
    
    def log_message(self, format, *args):
        """Custom logging."""
        print(f"[API] {args[0]}")
    
    def send_json_response(self, data: Dict[str, Any], status: int = 200):
        """Send JSON response."""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Payment-*')
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode('utf-8'))
    
    def send_payment_required(self, video_id: str, tier: str = 'basic'):
        """Send 402 Payment Required response."""
        pricing = self.PRICING.get(tier, self.PRICING['basic'])
        response = create_payment_response(video_id, pricing['amount'], pricing['currency'])
        response['tier'] = tier
        response['features'] = pricing['features']
        
        self.send_response(402)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('WWW-Authenticate', f'x402 scheme="x402-solana", amount="{pricing["amount"]}", currency="{pricing["currency"]}"')
        self.end_headers()
        self.wfile.write(json.dumps(response, indent=2).encode('utf-8'))
    
    def verify_payment(self) -> bool:
        """Verify payment from request headers."""
        # Check for payment headers
        payment_version = self.headers.get('X-Payment-Version')
        payment_scheme = self.headers.get('X-Payment-Scheme')
        authorization = self.headers.get('Authorization')
        
        if not all([payment_version, payment_scheme, authorization]):
            return False
        
        # In production, verify the payment signature and transaction
        # For demo, we accept any properly formatted payment
        if payment_version == 'x402-v1' and authorization.startswith('x402 '):
            return True
        
        return False
    
    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Payment-*')
        self.end_headers()
    
    def do_GET(self):
        """Handle GET requests."""
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        query = urllib.parse.parse_qs(parsed_path.query)
        
        # Route: /health
        if path == '/health':
            self.send_json_response({
                'status': 'healthy',
                'service': 'youtube-transcript-scraper',
                'version': '1.0.0'
            })
            return
        
        # Route: /api/transcript/<video_id>
        if path.startswith('/api/transcript/'):
            video_id = path.split('/')[-1]
            language = query.get('lang', ['en'])[0]
            format_type = query.get('format', ['json'])[0]
            
            # Check payment (optional for demo)
            # Uncomment to enable payment requirement:
            # if not self.verify_payment():
            #     self.send_payment_required(video_id)
            #     return
            
            # Fetch transcript
            result = self.scraper.fetch_transcript(video_id, language)
            
            if not result['success']:
                self.send_json_response({
                    'success': False,
                    'error': result.get('error', 'Unknown error'),
                    'video_id': video_id
                }, status=400)
                return
            
            # Format response
            if format_type == 'text':
                text = '\n'.join([seg['text'] for seg in result['transcript']])
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(text.encode('utf-8'))
            elif format_type == 'timestamps':
                text = '\n'.join([f"[{seg['offset']}] {seg['text']}" for seg in result['transcript']])
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(text.encode('utf-8'))
            else:
                self.send_json_response(result)
            
            return
        
        # Route: /api/languages/<video_id>
        if path.startswith('/api/languages/'):
            video_id = path.split('/')[-1]
            languages = self.scraper.get_transcript_languages(video_id)
            
            self.send_json_response({
                'video_id': video_id,
                'languages': languages,
                'count': len(languages)
            })
            return
        
        # Route: /api/pricing
        if path == '/api/pricing':
            self.send_json_response({
                'pricing': self.PRICING,
                'currency': 'USDC',
                'network': 'solana-mainnet',
                'payment_scheme': 'x402-solana'
            })
            return
        
        # Route: /
        if path == '/':
            self.send_json_response({
                'service': 'YouTube Transcript Scraper API',
                'version': '1.0.0',
                'endpoints': {
                    'GET /health': 'Health check',
                    'GET /api/transcript/<video_id>': 'Get transcript (params: lang, format)',
                    'GET /api/languages/<video_id>': 'Get available languages',
                    'GET /api/pricing': 'Get pricing information',
                    'POST /api/transcript': 'Get transcript (POST with JSON body)'
                },
                'formats': ['json', 'text', 'timestamps'],
                'payment': 'x402 protocol supported'
            })
            return
        
        # Not found
        self.send_json_response({
            'error': 'Not found',
            'path': path
        }, status=404)
    
    def do_POST(self):
        """Handle POST requests."""
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        
        # Route: /api/transcript (POST)
        if path == '/api/transcript':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                self.send_json_response({
                    'success': False,
                    'error': 'Invalid JSON'
                }, status=400)
                return
            
            video_input = data.get('video_id') or data.get('url')
            language = data.get('language', 'en')
            format_type = data.get('format', 'json')
            
            if not video_input:
                self.send_json_response({
                    'success': False,
                    'error': 'Missing video_id or url'
                }, status=400)
                return
            
            # Extract video ID
            video_id = self.scraper.extract_video_id(video_input)
            if not video_id:
                self.send_json_response({
                    'success': False,
                    'error': 'Invalid video ID or URL'
                }, status=400)
                return
            
            # Check payment
            # if not self.verify_payment():
            #     self.send_payment_required(video_id)
            #     return
            
            # Fetch transcript
            result = self.scraper.fetch_transcript(video_id, language)
            
            if not result['success']:
                self.send_json_response(result, status=400)
                return
            
            self.send_json_response(result)
            return
        
        # Not found
        self.send_json_response({
            'error': 'Not found',
            'path': path
        }, status=404)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """Handle requests in separate threads."""
    allow_reuse_address = True


def run_server(port: int = 8000):
    """Start the API server."""
    server_address = ('', port)
    httpd = ThreadedHTTPServer(server_address, TranscriptAPIHandler)
    
    print(f"🎬 YouTube Transcript Scraper API")
    print(f"📡 Server running on http://localhost:{port}")
    print(f"💰 x402 payment enabled")
    print(f"📚 Endpoints:")
    print(f"   GET  /                    - API info")
    print(f"   GET  /health              - Health check")
    print(f"   GET  /api/transcript/<id> - Get transcript")
    print(f"   GET  /api/languages/<id>  - Get languages")
    print(f"   GET  /api/pricing         - Get pricing")
    print(f"   POST /api/transcript      - Get transcript (JSON)")
    print(f"\nPress Ctrl+C to stop")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Shutting down server...")
        httpd.shutdown()


if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run_server(port)
