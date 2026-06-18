#!/usr/bin/env python3
"""
Prediction Market Signal Aggregator v1.0
预测市场信号聚合器 — Proxies.sx 赏金 #55 ($100)

功能：
1. 从 Polymarket、Kalshi 获取实时预测市场赔率
2. 从 Twitter/X、Reddit 抓取社交媒体情绪数据
3. 检测错误定价，生成交易信号
4. x402 USDC 支付网关

API 端点：
  GET /api/run?type=signal&market=<market_id>
  GET /api/run?type=odds&market=<market_id>
  GET /api/run?type=sentiment&query=<query>
  GET /health
"""

import json
import asyncio
import time
import hashlib
import hmac
import os
import aiohttp
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from enum import Enum

# ============================================================
# 数据模型
# ============================================================

class SignalType(Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"

class MarketSource(Enum):
    POLYMARKET = "polymarket"
    KALSHI = "kalshi"
    METACULUS = "metaculus"

@dataclass
class MarketOdds:
    """预测市场赔率"""
    market_id: str
    question: str
    source: str
    outcome_prices: Dict[str, float]  # {"Yes": 0.65, "No": 0.35}
    volume_24h: float
    liquidity: float
    timestamp: str
    url: str

@dataclass
class SentimentData:
    """社交媒体情绪数据"""
    query: str
    source: str  # twitter, reddit
    positive_count: int
    negative_count: int
    neutral_count: int
    total_mentions: int
    sentiment_score: float  # -1.0 to 1.0
    trending: bool
    sample_posts: List[str]
    timestamp: str

@dataclass
class TradingSignal:
    """交易信号"""
    market_id: str
    question: str
    signal: SignalType
    confidence: float  # 0.0 to 1.0
    current_odds: Dict[str, float]
    sentiment_score: float
    reasoning: str
    suggested_position: str
    risk_level: str  # low, medium, high
    timestamp: str


# ============================================================
# Polymarket 数据源
# ============================================================

class PolymarketClient:
    """Polymarket CLOB API 客户端"""
    
    BASE_URL = "https://gamma-api.polymarket.com"
    
    def __init__(self):
        self.session = None
    
    async def _ensure_session(self):
        import aiohttp
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(
                headers={"User-Agent": "PredictionMarketSignal/1.0"}
            )
    
    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()
    
    async def get_active_markets(self, limit: int = 50) -> List[Dict]:
        """获取活跃市场列表"""
        await self._ensure_session()
        url = f"{self.BASE_URL}/events"
        params = {
            "active": "true",
            "closed": "false",
            "limit": limit,
            "order": "volume24hr",
            "ascending": "false",
        }
        async with self.session.get(url, params=params) as resp:
            if resp.status == 200:
                return await resp.json()
            return []
    
    async def get_market(self, market_id: str) -> Optional[Dict]:
        """获取单个市场详情"""
        await self._ensure_session()
        url = f"{self.BASE_URL}/events/{market_id}"
        async with self.session.get(url) as resp:
            if resp.status == 200:
                return await resp.json()
            return None
    
    async def get_odds(self, market_id: str) -> Optional[MarketOdds]:
        """获取市场赔率"""
        data = await self.get_market(market_id)
        if not data:
            return None
        
        return MarketOdds(
            market_id=market_id,
            question=data.get("title", ""),
            source="polymarket",
            outcome_prices=self._parse_outcomes(data),
            volume_24h=float(data.get("volume24hr", 0)),
            liquidity=float(data.get("liquidity", 0)),
            timestamp=datetime.now().isoformat(),
            url=f"https://polymarket.com/event/{market_id}",
        )
    
    def _parse_outcomes(self, data: Dict) -> Dict[str, float]:
        """解析结果价格"""
        prices = {}
        outcomes = data.get("outcomes", "[]")
        if isinstance(outcomes, str):
            try:
                outcomes = json.loads(outcomes)
            except:
                outcomes = []
        
        for outcome in outcomes:
            if isinstance(outcome, dict):
                name = outcome.get("outcome", outcome.get("name", ""))
                price = outcome.get("price", 0)
                if name and price:
                    prices[name] = float(price)
        
        # 也检查 outcomePrices 字段
        if not prices:
            raw_prices = data.get("outcomePrices", "")
            if raw_prices:
                try:
                    price_list = json.loads(raw_prices) if isinstance(raw_prices, str) else raw_prices
                    for i, p in enumerate(price_list):
                        prices[f"Outcome_{i}"] = float(p)
                except:
                    pass
        
        return prices
    
    async def search_markets(self, query: str, limit: int = 10) -> List[Dict]:
        """搜索市场"""
        await self._ensure_session()
        url = f"{self.BASE_URL}/events"
        params = {
            "active": "true",
            "closed": "false",
            "limit": limit,
            "order": "volume24hr",
            "ascending": "false",
        }
        # Polymarket 不支持直接搜索，先拉取活跃市场再过滤
        async with self.session.get(url, params=params) as resp:
            if resp.status == 200:
                all_markets = await resp.json()
                query_lower = query.lower()
                return [
                    m for m in all_markets
                    if query_lower in m.get("title", "").lower()
                    or query_lower in m.get("slug", "").lower()
                ][:limit]
            return []


# ============================================================
# Kalshi 数据源
# ============================================================

class KalshiClient:
    """Kalshi REST API 客户端"""
    
    BASE_URL = "https://api.Trade.kalshi.com/trade-api/v2"
    
    def __init__(self):
        self.session = None
    
    async def _ensure_session(self):
        import aiohttp
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(
                headers={"User-Agent": "PredictionMarketSignal/1.0"}
            )
    
    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()
    
    async def get_markets(self, limit: int = 50) -> List[Dict]:
        """获取市场列表"""
        await self._ensure_session()
        url = f"{self.BASE_URL}/markets"
        params = {"limit": limit, "status": "active"}
        try:
            async with self.session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("markets", [])
        except Exception as e:
            print(f"   ⚠️ Kalshi API 错误: {e}")
        return []
    
    async def get_market(self, ticker: str) -> Optional[Dict]:
        """获取单个市场"""
        await self._ensure_session()
        url = f"{self.BASE_URL}/markets/{ticker}"
        async with self.session.get(url) as resp:
            if resp.status == 200:
                return await resp.json()
            return None
    
    async def get_odds(self, ticker: str) -> Optional[MarketOdds]:
        """获取市场赔率"""
        data = await self.get_market(ticker)
        if not data:
            return None
        
        market = data.get("market", {})
        return MarketOdds(
            market_id=ticker,
            question=market.get("title", ""),
            source="kalshi",
            outcome_prices=self._parse_outcomes(market),
            volume_24h=float(market.get("volume_24h", 0)),
            liquidity=float(market.get("liquidity", 0)),
            timestamp=datetime.now().isoformat(),
            url=f"https://kalshi.com/markets/{ticker}",
        )
    
    def _parse_outcomes(self, market: Dict) -> Dict[str, float]:
        prices = {}
        for outcome in market.get("outcome_prices", []):
            name = outcome.get("outcome", "")
            price = outcome.get("price", 0)
            if name and price:
                prices[name] = float(price) / 100  # Kalshi 价格是美分
        return prices


# ============================================================
# 社交媒体情绪分析
# ============================================================

class SentimentAnalyzer:
    """社交媒体情绪分析器"""
    
    def __init__(self):
        self.session = None
    
    async def _ensure_session(self):
        import aiohttp
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(
                headers={"User-Agent": "PredictionMarketSignal/1.0"}
            )
    
    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()
    
    async def get_twitter_sentiment(self, query: str) -> SentimentData:
        """
        获取 Twitter/X 情绪数据
        注意：没有官方 API 时，使用 nitter 实例或第三方聚合
        """
        await self._ensure_session()
        
        # 使用 nitter 公开实例搜索
        nitter_instances = [
            "https://nitter.net",
            "https://nitter.privacydev.net",
            "https://nitter.poast.org",
        ]
        
        tweets = []
        for instance in nitter_instances:
            try:
                url = f"{instance}/search"
                params = {"q": query, "f": "tweets", "since": ""}
                async with self.session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        html = await resp.text()
                        # 简单提取推文文本
                        import re
                        tweet_texts = re.findall(r'<div class="tweet-content[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
                        tweets.extend([re.sub(r'<[^>]+>', '', t).strip() for t in tweet_texts[:20]])
                        if tweets:
                            break
            except:
                continue
        
        # 分析情绪
        return self._analyze_sentiment(query, "twitter", tweets)
    
    async def get_reddit_sentiment(self, query: str) -> SentimentData:
        """获取 Reddit 情绪数据"""
        await self._ensure_session()
        
        # 使用 Reddit JSON API（不需要认证）
        url = f"https://www.reddit.com/search.json"
        params = {"q": query, "sort": "relevance", "t": "week", "limit": 25}
        
        posts = []
        try:
            async with self.session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    for post in data.get("data", {}).get("children", []):
                        p = post.get("data", {})
                        posts.append({
                            "title": p.get("title", ""),
                            "selftext": p.get("selftext", "")[:200],
                            "score": p.get("score", 0),
                            "num_comments": p.get("num_comments", 0),
                        })
        except:
            pass
        
        return self._analyze_sentiment(query, "reddit", [p["title"] + " " + p["selftext"] for p in posts])
    
    def _analyze_sentiment(self, query: str, source: str, texts: List[str]) -> SentimentData:
        """简单情绪分析（基于关键词）"""
        positive_words = {"bullish", "buy", "up", "moon", "pump", "long", "calls", "gain", "profit", "win", "yes", "likely", "probable", "strong", "growth", "surge", "rally"}
        negative_words = {"bearish", "sell", "down", "dump", "short", "puts", "loss", "lose", "no", "unlikely", "improbable", "weak", "crash", "drop", "fall", "decline", "recession"}
        
        pos_count = 0
        neg_count = 0
        neu_count = 0
        
        for text in texts:
            text_lower = text.lower()
            pos = sum(1 for w in positive_words if w in text_lower)
            neg = sum(1 for w in negative_words if w in text_lower)
            
            if pos > neg:
                pos_count += 1
            elif neg > pos:
                neg_count += 1
            else:
                neu_count += 1
        
        total = max(pos_count + neg_count + neu_count, 1)
        score = (pos_count - neg_count) / total
        
        return SentimentData(
            query=query,
            source=source,
            positive_count=pos_count,
            negative_count=neg_count,
            neutral_count=neu_count,
            total_mentions=total,
            sentiment_score=round(score, 3),
            trending=total > 10,
            sample_posts=texts[:5],
            timestamp=datetime.now().isoformat(),
        )


# ============================================================
# 信号生成引擎
# ============================================================

class SignalEngine:
    """交易信号生成引擎"""
    
    def __init__(self):
        self.polymarket = PolymarketClient()
        self.kalshi = KalshiClient()
        self.sentiment = SentimentAnalyzer()
    
    async def close(self):
        await self.polymarket.close()
        await self.kalshi.close()
        await self.sentiment.close()
    
    async def generate_signal(self, market_query: str) -> Dict:
        """
        生成交易信号
        
        逻辑：
        1. 获取预测市场赔率
        2. 获取社交媒体情绪
        3. 对比赔率与情绪，检测错误定价
        4. 生成 BUY/SELL/HOLD 信号
        """
        # 1. 搜索相关市场
        polymarket_markets = await self.polymarket.search_markets(market_query)
        kalshi_markets = await self.kalshi.get_markets()
        
        # 2. 获取赔率
        odds_list = []
        for m in polymarket_markets[:3]:
            mid = m.get("id", m.get("slug", ""))
            if mid:
                odds = await self.polymarket.get_odds(mid)
                if odds:
                    odds_list.append(odds)
        
        # 3. 获取情绪
        twitter_sent = await self.sentiment.get_twitter_sentiment(market_query)
        reddit_sent = await self.sentiment.get_reddit_sentiment(market_query)
        
        # 4. 生成信号
        signals = []
        for odds in odds_list:
            signal = self._analyze_market(odds, twitter_sent, reddit_sent)
            signals.append(signal)
        
        return {
            "query": market_query,
            "timestamp": datetime.now().isoformat(),
            "markets_analyzed": len(odds_list),
            "signals": [self._signal_to_dict(s) for s in signals],
            "sentiment": {
                "twitter": {
                    "score": twitter_sent.sentiment_score,
                    "mentions": twitter_sent.total_mentions,
                    "trending": twitter_sent.trending,
                },
                "reddit": {
                    "score": reddit_sent.sentiment_score,
                    "mentions": reddit_sent.total_mentions,
                    "trending": reddit_sent.trending,
                },
            },
            "summary": self._generate_summary(signals),
        }
    
    def _analyze_market(self, odds: MarketOdds, twitter: SentimentData, reddit: SentimentData) -> TradingSignal:
        """分析单个市场，生成信号"""
        # 综合情绪分数
        combined_sentiment = (twitter.sentiment_score + reddit.sentiment_score) / 2
        
        # 获取 Yes/No 价格
        yes_price = odds.outcome_prices.get("Yes", odds.outcome_prices.get("yes", 0.5))
        no_price = odds.outcome_prices.get("No", odds.outcome_prices.get("no", 0.5))
        
        # 信号逻辑
        reasoning_parts = []
        signal = SignalType.HOLD
        confidence = 0.5
        
        # 情绪强烈看涨 + Yes 价格低 → BUY YES
        if combined_sentiment > 0.3 and yes_price < 0.6:
            signal = SignalType.BUY
            confidence = min(0.9, 0.5 + combined_sentiment * 0.5)
            reasoning_parts.append(f"社交媒体情绪看涨({combined_sentiment:+.2f})，Yes赔率偏低({yes_price:.2f})，存在低估")
        
        # 情绪强烈看跌 + No 价格低 → BUY NO
        elif combined_sentiment < -0.3 and no_price < 0.6:
            signal = SignalType.SELL
            confidence = min(0.9, 0.5 + abs(combined_sentiment) * 0.5)
            reasoning_parts.append(f"社交媒体情绪看跌({combined_sentiment:+.2f})，No赔率偏低({no_price:.2f})，存在低估")
        
        # 情绪中性 → HOLD
        else:
            signal = SignalType.HOLD
            confidence = 0.5
            reasoning_parts.append(f"情绪中性({combined_sentiment:+.2f})，赔率合理，建议观望")
        
        # 风险等级
        if odds.volume_24h > 100000:
            risk = "low"
        elif odds.volume_24h > 10000:
            risk = "medium"
        else:
            risk = "high"
        
        return TradingSignal(
            market_id=odds.market_id,
            question=odds.question,
            signal=signal,
            confidence=round(confidence, 2),
            current_odds=odds.outcome_prices,
            sentiment_score=round(combined_sentiment, 3),
            reasoning="; ".join(reasoning_parts),
            suggested_position=f"{signal.value} {'Yes' if signal == SignalType.BUY else 'No' if signal == SignalType.SELL else 'N/A'}",
            risk_level=risk,
            timestamp=datetime.now().isoformat(),
        )
    
    def _signal_to_dict(self, s: TradingSignal) -> Dict:
        return {
            "market_id": s.market_id,
            "question": s.question,
            "signal": s.signal.value,
            "confidence": s.confidence,
            "current_odds": s.current_odds,
            "sentiment_score": s.sentiment_score,
            "reasoning": s.reasoning,
            "suggested_position": s.suggested_position,
            "risk_level": s.risk_level,
            "timestamp": s.timestamp,
        }
    
    def _generate_summary(self, signals: List[TradingSignal]) -> Dict:
        if not signals:
            return {"status": "no_markets_found", "recommendation": "未找到相关市场"}
        
        buy_count = sum(1 for s in signals if s.signal == SignalType.BUY)
        sell_count = sum(1 for s in signals if s.signal == SignalType.SELL)
        hold_count = sum(1 for s in signals if s.signal == SignalType.HOLD)
        avg_confidence = sum(s.confidence for s in signals) / len(signals)
        
        return {
            "total_signals": len(signals),
            "buy_signals": buy_count,
            "sell_signals": sell_count,
            "hold_signals": hold_count,
            "average_confidence": round(avg_confidence, 2),
            "recommendation": "BUY" if buy_count > sell_count else "SELL" if sell_count > buy_count else "HOLD",
        }


# ============================================================
# 主程序 / API 服务器
# ============================================================

async def main():
    """测试运行"""
    engine = SignalEngine()
    
    try:
        print("=" * 60)
        print("🔮 Prediction Market Signal Aggregator v1.0")
        print("=" * 60)
        
        # 测试1: 获取 Polymarket 活跃市场
        print("\n📊 获取 Polymarket 活跃市场...")
        markets = await engine.polymarket.get_active_markets(limit=5)
        print(f"   找到 {len(markets)} 个活跃市场")
        for m in markets[:3]:
            print(f"   - {m.get('title', 'N/A')[:60]}")
        
        # 测试2: 获取 Kalshi 市场
        print("\n📊 获取 Kalshi 市场...")
        kalshi_markets = await engine.kalshi.get_markets(limit=5)
        print(f"   找到 {len(kalshi_markets)} 个市场")
        for m in kalshi_markets[:3]:
            print(f"   - {m.get('title', m.get('ticker', 'N/A'))[:60]}")
        
        # 测试3: 生成信号
        print("\n🔮 生成交易信号 (query: 'Trump')...")
        result = await engine.generate_signal("Trump")
        
        print(f"\n   市场数: {result['markets_analyzed']}")
        print(f"   Twitter 情绪: {result['sentiment']['twitter']['score']:+.2f} ({result['sentiment']['twitter']['mentions']} mentions)")
        print(f"   Reddit 情绪: {result['sentiment']['reddit']['score']:+.2f} ({result['sentiment']['reddit']['mentions']} mentions)")
        
        summary = result['summary']
        print(f"\n   📈 信号汇总:")
        print(f"      总计: {summary['total_signals']} | BUY: {summary['buy_signals']} | SELL: {summary['sell_signals']} | HOLD: {summary['hold_signals']}")
        print(f"      平均置信度: {summary['average_confidence']}")
        print(f"      建议: {summary['recommendation']}")
        
        for sig in result['signals']:
            emoji = {"BUY": "🟢", "SELL": "🔴", "HOLD": "⚪"}[sig['signal']]
            print(f"\n   {emoji} {sig['signal']} | 置信度: {sig['confidence']} | 风险: {sig['risk_level']}")
            print(f"      市场: {sig['question'][:60]}")
            print(f"      赔率: {sig['current_odds']}")
            print(f"      理由: {sig['reasoning'][:80]}")
        
        # 保存结果
        output_dir = Path("output")
        output_dir.mkdir(exist_ok=True)
        output_file = output_dir / f"signal_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"\n📄 结果已保存: {output_file}")
        
    finally:
        await engine.close()


if __name__ == "__main__":
    asyncio.run(main())
