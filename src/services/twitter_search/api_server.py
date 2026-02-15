#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
X/Twitter Real-Time Search API
Mobile proxy-based Twitter scraping without official API
"""

import os
import json
import time
import hashlib
import requests
from datetime import datetime
from typing import List, Dict, Optional
from dataclasses import dataclass
from flask import Flask, request, jsonify
import urllib.parse

app = Flask(__name__)

# Configuration
PROXY_SX_API_KEY = os.environ.get('PROXY_SX_API_KEY', '')
PROXY_BASE_URL = 'https://proxies.sx/api/v1'

@dataclass
class Tweet:
    """Represents a tweet"""
    id: str
    author_handle: str
    author_name: str
    author_followers: int
    author_verified: bool
    text: str
    created_at: str
    likes: int
    retweets: int
    replies: int
    views: int
    url: str
    media: List[str]
    hashtags: List[str]

@dataclass
class UserProfile:
    """Represents a Twitter user"""
    handle: str
    name: str
    followers: int
    following: int
    tweets: int
    verified: bool
    bio: str
    location: str
    created_at: str

@dataclass
class TrendingTopic:
    """Represents a trending topic"""
    name: str
    volume: int
    url: str
    promoted: bool

class MobileProxy:
    """Mobile proxy manager for X/Twitter"""
    
    def __init__(self, api_key: str = ''):
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        })
    
    def get_proxy(self) -> Optional[Dict]:
        """Get a mobile proxy"""
        if not self.api_key:
            # Return None for direct connection (development)
            return None
        
        try:
            resp = requests.get(
                f'{PROXY_BASE_URL}/allocate',
                params={'country': 'US', 'type': 'mobile'},
                headers={'Authorization': f'Bearer {self.api_key}'},
                timeout=10
            )
            if resp.status_code == 200:
                return resp.json()
        except:
            pass
        
        return None
    
    def search_tweets(self, query: str, limit: int = 20, sort: str = 'latest') -> List[Tweet]:
        """Search tweets using X's mobile site"""
        tweets = []
        
        # Build search URL
        encoded_query = urllib.parse.quote(query)
        url = f'https://mobile.x.com/search/{encoded_query}?src=typed_query&f={sort}'
        
        proxy = self.get_proxy()
        
        try:
            if proxy:
                # Use proxy
                resp = requests.get(url, proxies=proxy, timeout=30)
            else:
                # Direct connection (limited)
                resp = self.session.get(url, timeout=30)
            
            if resp.status_code == 200:
                # Parse HTML to extract tweets (simplified)
                tweets = self._parse_tweets(resp.text)
                tweets = tweets[:limit]
                
        except Exception as e:
            print(f"Search error: {e}")
        
        return tweets
    
    def get_user(self, handle: str) -> Optional[UserProfile]:
        """Get user profile"""
        url = f'https://mobile.x.com/{handle}'
        
        proxy = self.get_proxy()
        
        try:
            if proxy:
                resp = requests.get(url, proxies=proxy, timeout=30)
            else:
                resp = self.session.get(url, timeout=30)
            
            if resp.status_code == 200:
                return self._parse_user(resp.text, handle)
        except Exception as e:
            print(f"User fetch error: {e}")
        
        return None
    
    def get_user_tweets(self, handle: str, limit: int = 20) -> List[Tweet]:
        """Get tweets from a user"""
        url = f'https://mobile.x.com/{handle}'
        
        proxy = self.get_proxy()
        
        try:
            if proxy:
                resp = requests.get(url, proxies=proxy, timeout=30)
            else:
                resp = self.session.get(url, timeout=30)
            
            if resp.status_code == 200:
                tweets = self._parse_tweets(resp.text)
                return tweets[:limit]
        except Exception as e:
            print(f"Tweets fetch error: {e}")
        
        return []
    
    def get_trending(self, country: str = 'US') -> List[TrendingTopic]:
        """Get trending topics"""
        url = f'https://mobile.x.com/i/trends'
        
        proxy = self.get_proxy()
        
        try:
            if proxy:
                resp = requests.get(url, proxies=proxy, timeout=30)
            else:
                resp = self.session.get(url, timeout=30)
            
            if resp.status_code == 200:
                return self._parse_trending(resp.text)
        except Exception as e:
            print(f"Trending error: {e}")
        
        return []
    
    def get_thread(self, tweet_id: str) -> List[Tweet]:
        """Get full conversation thread from a tweet"""
        url = f'https://mobile.x.com/{self._get_handle_from_id(tweet_id)}/status/{tweet_id}'
        
        proxy = self.get_proxy()
        
        try:
            if proxy:
                resp = requests.get(url, proxies=proxy, timeout=30)
            else:
                resp = self.session.get(url, timeout=30)
            
            if resp.status_code == 200:
                return self._parse_thread(resp.text)
        except Exception as e:
            print(f"Thread error: {e}")
        
        return []
    
    def _parse_tweets(self, html: str) -> List[Tweet]:
        """Parse tweets from HTML"""
        tweets = []
        
        # Simplified parsing - in production, use proper HTML parser
        import re
        
        # Look for tweet patterns in HTML
        # This is a placeholder - real implementation needs better parsing
        
        # Demo data for testing without proxy
        if not self.api_key:
            demo_tweet = Tweet(
                id='1234567890',
                author_handle='demo_user',
                author_name='Demo User',
                author_followers=1000,
                author_verified=False,
                text='This is a demo tweet for testing the API.',
                created_at=datetime.now().isoformat(),
                likes=10,
                retweets=2,
                replies=1,
                views=100,
                url='https://x.com/demo_user/status/1234567890',
                media=[],
                hashtags=['demo', 'api']
            )
            tweets.append(demo_tweet)
        
        return tweets
    
    def _parse_user(self, html: str, handle: str) -> Optional[UserProfile]:
        """Parse user profile from HTML"""
        # Simplified - return demo data without proxy
        if not self.api_key:
            return UserProfile(
                handle=handle,
                name='Demo User',
                followers=1000,
                following=100,
                tweets=500,
                verified=False,
                bio='Demo user for testing',
                location='Internet',
                created_at='2020-01-01'
            )
        return None
    
    def _parse_trending(self, html: str) -> List[TrendingTopic]:
        """Parse trending topics from HTML"""
        trends = []
        
        if not self.api_key:
            trends = [
                TrendingTopic('#Python', 100000, '#', False),
                TrendingTopic('#AI', 50000, '#', False),
                TrendingTopic('#TechNews', 25000, '#', False),
            ]
        
        return trends
    
    def _parse_thread(self, html: str) -> List[Tweet]:
        """Parse thread from HTML"""
        return []
    
    def _get_handle_from_id(self, tweet_id: str) -> str:
        """Get handle from tweet ID (simplified)"""
        return 'user'


# Initialize proxy
proxy = MobileProxy(PROXY_SX_API_KEY)


# ============== API Endpoints ==============

@app.route('/health', methods=['GET'])
def health():
    """Health check"""
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/x/search', methods=['GET'])
def search_tweets():
    """
    Search tweets by keyword
    
    Query params:
    - query: Search keyword or hashtag
    - sort: latest | top (default: latest)
    - limit: Number of results (default: 20, max: 100)
    """
    query = request.args.get('query', '')
    sort = request.args.get('sort', 'latest')
    limit = min(int(request.args.get('limit', 20)), 100)
    
    if not query:
        return jsonify({'error': 'query parameter required'}), 400
    
    tweets = proxy.search_tweets(query, limit, sort)
    
    return jsonify({
        'query': query,
        'sort': sort,
        'results': [t.__dict__ for t in tweets],
        'meta': {
            'total_results': len(tweets),
            'timestamp': datetime.now().isoformat()
        }
    })

@app.route('/api/x/trending', methods=['GET'])
def trending():
    """
    Get trending topics by country
    
    Query params:
    - country: Country code (default: US)
    """
    country = request.args.get('country', 'US')
    
    trends = proxy.get_trending(country)
    
    return jsonify({
        'country': country,
        'trending': [t.__dict__ for t in trends],
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/x/user/<handle>', methods=['GET'])
def get_user(handle: str):
    """Get user profile"""
    user = proxy.get_user(handle)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    return jsonify(user.__dict__)

@app.route('/api/x/user/<handle>/tweets', methods=['GET'])
def get_user_tweets(handle: str):
    """Get tweets from a user"""
    limit = min(int(request.args.get('limit', 20)), 100)
    
    tweets = proxy.get_user_tweets(handle, limit)
    
    return jsonify({
        'handle': handle,
        'tweets': [t.__dict__ for t in tweets],
        'count': len(tweets)
    })

@app.route('/api/x/thread/<tweet_id>', methods=['GET'])
def get_thread(tweet_id: str):
    """Get full conversation thread"""
    thread = proxy.get_thread(tweet_id)
    
    return jsonify({
        'tweet_id': tweet_id,
        'thread': [t.__dict__ for t in thread],
        'count': len(thread)
    })


# ============== x402 Payment Integration ==============

@app.route('/api/x/search', methods=['POST'])
def search_with_payment():
    """
    Paid search with x402 protocol
    
    Headers:
    - Authorization: Bearer <payment_proof>
    """
    query = request.args.get('query', '')
    
    # Verify payment (placeholder)
    auth_header = request.headers.get('Authorization', '')
    
    # In production, verify x402 payment proof
    if auth_header.startswith('Bearer '):
        # Verify payment and allow request
        pass
    
    return search_tweets()


# ============== Main ==============

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('DEBUG', 'false').lower() == 'true'
    
    print('=' * 60)
    print('X/Twitter Real-Time Search API')
    print('=' * 60)
    print(f'Starting on port {port}...')
    print(f'Proxy API Key: {"Set" if PROXY_SX_API_KEY else "Not set (demo mode)"}')
    print()
    
    app.run(host='0.0.0.0', port=port, debug=debug)
