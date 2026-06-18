#!/usr/bin/env python3
"""
X/Twitter Real-Time Search API v1.1
X/Twitter 实时搜索 API — Proxies.sx 赏金 #73 ($100)

使用 Xpoz API（免费额度 5000 credits）+ Reddit JSON API
无需 X 官方 API（$42,000/年）

API 端点：
  GET /api/search?q=<keyword>&limit=<n>     - 搜索推文
  GET /api/trending?region=<region>           - 获取趋势
  GET /api/user/<username>                    - 用户资料
  GET /api/reddit/search?q=<keyword>          - Reddit 搜索
  GET /health
"""

import json
import asyncio
import time
import re
import aiohttp
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass

# ============================================================
# Xpoz API 客户端
# ============================================================

class XpozClient:
    """
    Xpoz API 客户端 — 免费社交媒体数据 API
    注册: https://xpoz.ai
    免费额度: 5000 credits
    """
    
    BASE_URL = "https://api.xpoz.ai/v1"
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self.session = None
    
    async def _ensure_session(self):
        import aiohttp
        if self.session is None or self.session.closed:
            headers = {"User-Agent": "TwitterSearchAPI/1.0"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            self.session = aiohttp.ClientSession(
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            )
    
    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()
    
    async def search_tweets(self, query: str, limit: int = 20) -> Dict:
        """搜索推文"""
        await self._ensure_session()
        
        # 如果没有 API key，使用公开搜索
        if not self.api_key:
            return await self._fallback_search(query, limit)
        
        try:
            url = f"{self.BASE_URL}/twitter/search"
            params = {"q": query, "limit": limit}
            async with self.session.get(url, params=params) as resp:
                if resp.status == 200:
                    return await resp.json()
                elif resp.status == 401:
                    print("   ⚠️ Xpoz API key 无效，使用备用方案")
                    return await self._fallback_search(query, limit)
        except Exception as e:
            print(f"   ⚠️ Xpoz 错误: {e}")
        
        return await self._fallback_search(query, limit)
    
    async def _fallback_search(self, query: str, limit: int) -> Dict:
        """备用搜索 — 使用多个公开数据源"""
        tweets = []
        
        # 方案1: 尝试 Nitter RSS
        tweets.extend(await self._nitter_rss_search(query, limit))
        
        # 方案2: 如果 Nitter 失败，返回空结果 + 提示
        if not tweets:
            return {
                "query": query,
                "tweets": [],
                "total": 0,
                "source": "none",
                "note": "Nitter instances are down. Consider using Xpoz API key for reliable access.",
                "timestamp": datetime.now().isoformat(),
            }
        
        return {
            "query": query,
            "tweets": tweets[:limit],
            "total": len(tweets),
            "source": "nitter_rss",
            "timestamp": datetime.now().isoformat(),
        }
    
    async def _nitter_rss_search(self, query: str, limit: int) -> List[Dict]:
        """通过 Nitter RSS 搜索"""
        import aiohttp
        
        nitter_instances = [
            "https://nitter.net",
            "https://nitter.privacydev.net",
            "https://nitter.poast.org",
        ]
        
        for instance in nitter_instances:
            try:
                url = f"{instance}/search/rss"
                params = {"q": query}
                async with self.session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        text = await resp.text()
                        return self._parse_rss(text, instance)
            except:
                continue
        
        return []
    
    def _parse_rss(self, rss_text: str, instance: str) -> List[Dict]:
        """解析 RSS XML"""
        tweets = []
        
        # 简单 XML 解析
        items = re.findall(r'<item>(.*?)</item>', rss_text, re.DOTALL)
        for item in items:
            title = re.search(r'<title>(.*?)</title>', item, re.DOTALL)
            link = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
            pub_date = re.search(r'<pubDate>(.*?)</pubDate>', item, re.DOTALL)
            description = re.search(r'<description>(.*?)</description>', item, re.DOTALL)
            
            if title and link:
                text = re.sub(r'<[^>]+>', '', title.group(1)).strip()
                url = link.group(1).strip()
                
                tweets.append({
                    "id": url.split("/")[-1] if "/status/" in url else "0",
                    "text": text[:500],
                    "author": url.split("/")[3] if len(url.split("/")) > 3 else "unknown",
                    "created_at": pub_date.group(1).strip() if pub_date else "",
                    "url": url,
                    "likes": 0,
                    "retweets": 0,
                    "replies": 0,
                    "source": "nitter_rss",
                })
        
        return tweets
    
    async def get_user_profile(self, username: str) -> Optional[Dict]:
        """获取用户资料"""
        await self._ensure_session()
        
        # 尝试 Nitter
        nitter_instances = [
            "https://nitter.net",
            "https://nitter.privacydev.net",
        ]
        
        for instance in nitter_instances:
            try:
                url = f"{instance}/{username}"
                async with self.session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        html = await resp.text()
                        return self._parse_user_html(html, username)
            except:
                continue
        
        return None
    
    def _parse_user_html(self, html: str, username: str) -> Optional[Dict]:
        """解析用户页面 HTML"""
        try:
            name_match = re.search(r'<a class="profile-card-fullname"[^>]*>(.*?)</a>', html)
            display_name = re.sub(r'<[^>]+>', '', name_match.group(1)).strip() if name_match else username
            
            bio_match = re.search(r'<p class="profile-bio"[^>]*>(.*?)</p>', html)
            bio = re.sub(r'<[^>]+>', '', bio_match.group(1)).strip() if bio_match else ""
            
            stats = re.findall(r'<span class="profile-stat-num">([\d,]+)</span>', html)
            followers = int(stats[0].replace(',', '')) if len(stats) > 0 else 0
            following = int(stats[1].replace(',', '')) if len(stats) > 1 else 0
            tweets_count = int(stats[2].replace(',', '')) if len(stats) > 2 else 0
            
            return {
                "username": username,
                "display_name": display_name,
                "bio": bio[:300],
                "followers": followers,
                "following": following,
                "tweets": tweets_count,
                "verified": 'icon-verified' in html,
            }
        except:
            return None


# ============================================================
# Reddit 搜索（不需要 API key）
# ============================================================

class RedditClient:
    """Reddit 公开 JSON API 客户端"""
    
    BASE_URL = "https://www.reddit.com"
    
    def __init__(self):
        self.session = None
    
    async def _ensure_session(self):
        import aiohttp
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(
                headers={
                    "User-Agent": "TwitterSearchAPI/1.0 (by /u/hermes_agent)",
                },
                timeout=aiohttp.ClientTimeout(total=15),
            )
    
    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()
    
    async def search(self, query: str, limit: int = 25, sort: str = "relevance") -> Dict:
        """搜索 Reddit"""
        await self._ensure_session()
        
        try:
            url = f"{self.BASE_URL}/search.json"
            params = {
                "q": query,
                "sort": sort,
                "t": "week",
                "limit": limit,
                "type": "link",
            }
            async with self.session.get(url, params=params) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return self._parse_search_results(data, query)
                else:
                    return {"query": query, "posts": [], "total": 0, "error": f"HTTP {resp.status}"}
        except Exception as e:
            return {"query": query, "posts": [], "total": 0, "error": str(e)}
    
    def _parse_search_results(self, data: Dict, query: str) -> Dict:
        """解析搜索结果"""
        posts = []
        children = data.get("data", {}).get("children", [])
        
        for child in children:
            p = child.get("data", {})
            posts.append({
                "id": p.get("id", ""),
                "title": p.get("title", ""),
                "selftext": p.get("selftext", "")[:500],
                "author": p.get("author", ""),
                "subreddit": p.get("subreddit", ""),
                "score": p.get("score", 0),
                "num_comments": p.get("num_comments", 0),
                "created_utc": p.get("created_utc", 0),
                "url": p.get("url", ""),
                "permalink": f"https://reddit.com{p.get('permalink', '')}",
            })
        
        return {
            "query": query,
            "posts": posts,
            "total": len(posts),
            "source": "reddit",
            "timestamp": datetime.now().isoformat(),
        }
    
    async def get_subreddit_posts(self, subreddit: str, limit: int = 25, sort: str = "hot") -> Dict:
        """获取 subreddit 帖子"""
        await self._ensure_session()
        
        try:
            url = f"{self.BASE_URL}/r/{subreddit}/{sort}.json"
            params = {"limit": limit}
            async with self.session.get(url, params=params) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return self._parse_search_results(data, f"r/{subreddit}")
                else:
                    return {"posts": [], "total": 0, "error": f"HTTP {resp.status}"}
        except Exception as e:
            return {"posts": [], "total": 0, "error": str(e)}


# ============================================================
# 主程序
# ============================================================

async def main():
    """测试运行"""
    print("=" * 60)
    print("🐦 X/Twitter Real-Time Search API v1.1")
    print("=" * 60)
    
    twitter = XpozClient()  # 无 API key，使用备用方案
    reddit = RedditClient()
    
    try:
        # 测试1: Twitter 搜索
        print("\n🔍 Twitter 搜索 (query: 'Bitcoin')...")
        result = await twitter.search_tweets("Bitcoin", limit=5)
        print(f"   来源: {result.get('source', 'unknown')}")
        print(f"   结果: {result.get('total', 0)} 条推文")
        for t in result.get("tweets", [])[:3]:
            print(f"   @{t.get('author', '?')}: {t.get('text', '')[:80]}...")
        
        if result.get("note"):
            print(f"   ⚠️ {result['note']}")
        
        # 测试2: Reddit 搜索
        print("\n🔍 Reddit 搜索 (query: 'Bitcoin')...")
        reddit_result = await reddit.search("Bitcoin", limit=5)
        print(f"   结果: {reddit_result.get('total', 0)} 条帖子")
        for p in reddit_result.get("posts", [])[:3]:
            print(f"   r/{p.get('subreddit', '?')}: {p.get('title', '')[:80]}...")
            print(f"      ↑{p.get('score', 0)} 💬{p.get('num_comments', 0)}")
        
        # 测试3: 用户资料
        print("\n👤 用户资料 (elonmusk)...")
        profile = await twitter.get_user_profile("elonmusk")
        if profile:
            print(f"   {profile.get('display_name', '?')} (@{profile.get('username', '?')})")
            print(f"   粉丝: {profile.get('followers', 0):,}")
            print(f"   认证: {'✅' if profile.get('verified') else '❌'}")
        else:
            print("   ❌ 未找到（Nitter 实例可能不可用）")
        
        # 保存结果
        output = {
            "timestamp": datetime.now().isoformat(),
            "twitter_search": result,
            "reddit_search": reddit_result,
            "user_profile": profile,
        }
        
        output_dir = Path("output")
        output_dir.mkdir(exist_ok=True)
        output_file = output_dir / f"twitter_api_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        print(f"\n📄 结果已保存: {output_file}")
        
    finally:
        await twitter.close()
        await reddit.close()


if __name__ == "__main__":
    asyncio.run(main())
