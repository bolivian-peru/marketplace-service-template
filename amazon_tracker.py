"""
Amazon Product & BSR Tracker API
Bounty: $75 USDC - https://github.com/bolivian-peru/marketplace-service-template/issues/72

Real-time Amazon product data extraction with x402 payment support.
"""

from fastapi import FastAPI, HTTPException, Query, Header, Response, Request
from fastapi.responses import JSONResponse
from typing import Optional, List
from pydantic import BaseModel
import httpx
from bs4 import BeautifulSoup
import asyncio
import re
import time
import json
import os
import hashlib
from datetime import datetime

app = FastAPI(title="Amazon Product & BSR Tracker API")

# Marketplace domains
MARKETPLACES = {
    "US": "amazon.com",
    "UK": "amazon.co.uk",
    "DE": "amazon.de",
    "FR": "amazon.fr",
    "ES": "amazon.es",
    "IT": "amazon.it",
}

# Mobile proxy configuration (Proxies.sx)
PROXY_URL = os.environ.get("AMAZON_PROXY_URL", "http://mobile.proxies.sx:8080")

# x402 Payment Configuration
USDC_RECEIVING_ADDRESS = os.environ.get(
    "AMAZON_USDC_TREASURY",
    "0xd10A6AbFED84dDD28F89bB3d836BD20D5da8fEBf"
)
PAYMENT_ASSET = "USDC"
USDC_DECIMALS = 6

# Pricing (in USDC)
PRICING = {
    "product": 0.005,
    "search": 0.01,
    "bestsellers": 0.01,
    "reviews": 0.02,
}

# Payment cache
_payment_cache = {}
CACHE_TTL = 3600


class Price(BaseModel):
    current: float
    currency: str
    was: Optional[float] = None
    discount_pct: Optional[float] = None


class BSR(BaseModel):
    rank: int
    category: str
    sub_category_ranks: Optional[List[dict]] = None


class BuyBox(BaseModel):
    seller: str
    is_amazon: bool
    fulfilled_by: str


class ProductResponse(BaseModel):
    asin: str
    title: str
    price: Price
    bsr: BSR
    rating: float
    reviews_count: int
    buy_box: BuyBox
    availability: str
    brand: str
    images: List[str]
    meta: dict


class SearchResponse(BaseModel):
    query: str
    results: int
    products: List[dict]
    marketplace: str


class BestsellersResponse(BaseModel):
    category: str
    marketplace: str
    products: List[dict]
    last_updated: str


class Review(BaseModel):
    rating: int
    title: str
    text: str
    author: str
    date: str
    verified: bool


class ReviewsResponse(BaseModel):
    asin: str
    total_reviews: int
    average_rating: float
    reviews: List[Review]


def _amount_to_raw(amount: float) -> int:
    """Convert USDC amount to raw token units"""
    return int(amount * (10 ** USDC_DECIMALS))


def _cleanup_payment_cache():
    """Remove expired payments from cache"""
    now = time.time()
    expired = [tx_hash for tx_hash, cached in _payment_cache.items() 
               if now - cached["time"] >= CACHE_TTL]
    for tx_hash in expired:
        _payment_cache.pop(tx_hash, None)


async def _verify_payment_onchain(tx_hash: str, network: str, recipient: str, expected_amount: float) -> tuple:
    """Verify USDC transfer on-chain"""
    import requests
    
    NETWORK_RPCS = {
        "base": "https://mainnet.base.org",
        "ethereum": os.environ.get("ETHEREUM_RPC", ""),
    }
    
    USDC_CONTRACTS = {
        "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "ethereum": "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    }
    
    TRANSFER_EVENT_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    
    if network not in NETWORK_RPCS or not NETWORK_RPCS[network]:
        return False, "unsupported_network"
    
    rpc_url = NETWORK_RPCS[network]
    contract = USDC_CONTRACTS.get(network, "").lower()
    recipient = recipient.lower()
    
    payload = {
        "jsonrpc": "2.0",
        "method": "eth_getTransactionReceipt",
        "params": [tx_hash],
        "id": 1
    }
    
    try:
        resp = requests.post(rpc_url, json=payload, timeout=15)
        if not resp.ok:
            return False, "rpc_error"
        
        result = resp.json().get("result")
        if not result:
            return False, "transaction_not_found"
        
        if result.get("status") != "0x1":
            return False, "transaction_reverted"
        
        total_raw = 0
        expected_raw = _amount_to_raw(expected_amount)
        
        for log in result.get("logs", []):
            topics = log.get("topics", [])
            if (log.get("address", "").lower() != contract or 
                len(topics) < 3 or 
                topics[0].lower() != TRANSFER_EVENT_SIG.lower()):
                continue
            
            to_addr = "0x" + topics[2][-40:]
            if to_addr.lower() != recipient:
                continue
            
            total_raw += int(log.get("data", "0x0"), 16)
        
        if total_raw < expected_raw:
            return False, "insufficient_amount"
        
        return True, "verified"
    
    except Exception as e:
        return False, f"verification_error: {str(e)}"


def _payment_required_response(price_key: str) -> JSONResponse:
    """Return HTTP 402 Payment Required response"""
    price = PRICING.get(price_key, 0.005)
    return JSONResponse(
        status_code=402,
        content={
            "error": "payment_required",
            "protocol": "x402",
            "version": "1.0",
            "payment": {
                "amount": str(price),
                "currency": PAYMENT_ASSET,
                "recipient": USDC_RECEIVING_ADDRESS,
                "networks": ["base", "ethereum"],
                "description": f"Amazon Tracker API: {price_key}",
                "expires": int(time.time()) + 300,
                "header_format": {
                    "tx_hash": "0x...",
                    "network": "base",
                    "recipient": USDC_RECEIVING_ADDRESS,
                    "amount": str(price),
                },
            },
            "docs": "https://www.x402.org/",
            "free_tier": "First 3 requests free per hour (rate-limited)",
        }
    )


async def fetch_with_proxy(url: str, headers: dict, max_retries: int = 3) -> str:
    """Fetch page through mobile proxy with retry logic"""
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(
                proxy=PROXY_URL,
                timeout=30.0,
                headers=headers,
                follow_redirects=True
            ) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    if "captcha" in response.text.lower():
                        await asyncio.sleep(2 ** attempt)
                        continue
                    return response.text
                elif response.status_code == 503:
                    raise HTTPException(status_code=503, detail="Amazon service unavailable")
                elif response.status_code == 404:
                    raise HTTPException(status_code=404, detail="Product not found")
                else:
                    await asyncio.sleep(2 ** attempt)
        except httpx.ProxyError:
            if attempt == max_retries - 1:
                raise HTTPException(status_code=502, detail="Proxy connection failed")
            await asyncio.sleep(2 ** attempt)
        except Exception as e:
            if attempt == max_retries - 1:
                raise HTTPException(status_code=500, detail=f"Fetch error: {str(e)}")
            await asyncio.sleep(2 ** attempt)
    
    raise HTTPException(status_code=500, detail="Max retries exceeded")


def parse_price(soup: BeautifulSoup) -> Price:
    """Extract price information"""
    price_whole = soup.find('span', {'class': 'a-price-whole'})
    price_fraction = soup.find('span', {'class': 'a-price-fraction'})
    
    if not price_whole:
        price_span = soup.find('span', {'class': 'a-offscreen'})
        if price_span:
            price_text = price_span.get_text().replace('$', '').replace('€', '').replace('£', '')
            return Price(current=float(price_text), currency="USD")
        return Price(current=0.0, currency="USD")
    
    price_text = price_whole.get_text().strip()
    fraction_text = price_fraction.get_text().strip() if price_fraction else "00"
    
    try:
        price = float(f"{price_text}.{fraction_text}")
    except:
        price = 0.0
    
    was_price = soup.find('span', {'class': 'a-price a-text-price'})
    was_value = None
    discount = None
    
    if was_price:
        was_text = was_price.get('aria-label', '')
        if was_text:
            try:
                was_value = float(re.sub(r'[^\d.]', '', was_text))
                if was_value > price and price > 0:
                    discount = round(((was_value - price) / was_value) * 100, 1)
            except:
                pass
    
    return Price(current=price, currency="USD", was=was_value, discount_pct=discount)


def parse_bsr(soup: BeautifulSoup) -> BSR:
    """Extract Best Seller Rank"""
    bsr_section = soup.find('td', string=re.compile(r'Best Sellers Rank', re.IGNORECASE))
    
    if not bsr_section:
        bsr_section = soup.find('div', id='SalesRank')
    
    sub_ranks = []
    
    if bsr_section:
        parent = bsr_section.find_parent('tr') or bsr_section.find_parent('div', class_='a-section')
        if parent:
            text = parent.get_text()
            matches = re.findall(r'#([\d,]+) in ([^\n]+)', text)
            
            if matches:
                for rank_str, category in matches[1:]:
                    rank = int(rank_str.replace(',', ''))
                    sub_ranks.append({"category": category.strip(), "rank": rank})
                
                first_rank = int(matches[0][0].replace(',', ''))
                return BSR(
                    rank=first_rank,
                    category=matches[0][1].strip(),
                    sub_category_ranks=sub_ranks if sub_ranks else None
                )
    
    return BSR(rank=0, category="Unknown")


def parse_reviews(soup: BeautifulSoup) -> tuple:
    """Extract review count and rating"""
    rating = 0.0
    count = 0
    
    rating_span = soup.find('span', {'class': 'a-icon-alt'})
    if rating_span:
        text = rating_span.get_text()
        match = re.search(r'([\d.]+) out of', text)
        if match:
            rating = float(match.group(1))
    
    count_elem = soup.find('span', {'id': 'acrCustomerReviewText'})
    if count_elem:
        text = count_elem.get_text()
        match = re.search(r'([\d,]+)', text)
        if match:
            count = int(match.group(1).replace(',', ''))
    
    return rating, count


def parse_product(html: str, asin: str, marketplace: str) -> ProductResponse:
    """Parse product page HTML"""
    soup = BeautifulSoup(html, 'lxml')
    
    title_elem = soup.find('span', {'id': 'productTitle'})
    title = title_elem.get_text().strip() if title_elem else "Unknown Product"
    
    price = parse_price(soup)
    bsr = parse_bsr(soup)
    rating, reviews_count = parse_reviews(soup)
    
    buy_box_seller = soup.find('a', {'id': 'bylineInfo'})
    seller = buy_box_seller.get_text().strip() if buy_box_seller else "Amazon.com"
    is_amazon = "Amazon" in seller
    
    avail_elem = soup.find('div', {'id': 'availability'})
    availability = avail_elem.get_text().strip() if avail_elem else "In Stock"
    
    brand_elem = soup.find('a', {'id': 'bylineInfo'})
    brand = brand_elem.get_text().strip() if brand_elem else "Unknown"
    
    images = []
    img_elem = soup.find('img', {'id': 'landingImage'})
    if img_elem:
        images.append(img_elem.get('src', ''))
    
    return ProductResponse(
        asin=asin,
        title=title,
        price=price,
        bsr=bsr,
        rating=rating,
        reviews_count=reviews_count,
        buy_box=BuyBox(seller=seller, is_amazon=is_amazon, fulfilled_by="Amazon" if is_amazon else "Seller"),
        availability=availability,
        brand=brand,
        images=images,
        meta={
            "marketplace": marketplace,
            "proxy": {"ip": "mobile", "country": marketplace, "carrier": "Mobile"},
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    )


async def verify_x402_payment(request: Request, price_key: str) -> tuple[bool, Optional[str]]:
    """Verify x402 payment from request headers"""
    payment_header = request.headers.get("X-PAYMENT") or request.headers.get("X-Payment")
    
    if not payment_header:
        return False, None
    
    try:
        receipt = json.loads(payment_header)
        tx_hash = receipt.get("tx_hash", "")
        network = receipt.get("network", "base")
        recipient = receipt.get("recipient", USDC_RECEIVING_ADDRESS).lower()
        
        _cleanup_payment_cache()
        
        if tx_hash in _payment_cache:
            return True, "cached"
        
        price = PRICING.get(price_key, 0.005)
        verified, reason = await _verify_payment_onchain(tx_hash, network, recipient, price)
        
        if verified:
            _payment_cache[tx_hash] = {"time": time.time(), "amount": price, "network": network}
            return True, "verified"
        
        return False, reason
    except:
        return False, "invalid_receipt"


@app.get("/api/amazon/product/{asin}")
async def get_product(
    asin: str,
    marketplace: str = Query(default="US", description="Marketplace code"),
    request: Request = None
):
    """Get product details by ASIN"""
    if marketplace not in MARKETPLACES:
        raise HTTPException(status_code=400, detail=f"Invalid marketplace. Use: {list(MARKETPLACES.keys())}")
    
    # Check x402 payment
    paid, reason = await verify_x402_payment(request, "product")
    if not paid:
        return _payment_required_response("product")
    
    domain = MARKETPLACES[marketplace]
    url = f"https://www.{domain}/dp/{asin}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    
    try:
        html = await fetch_with_proxy(url, headers)
        product = parse_product(html, asin, marketplace)
        return product
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing product: {str(e)}")


@app.get("/api/amazon/search")
async def search_products(
    query: str = Query(..., description="Search keyword"),
    category: Optional[str] = Query(default=None, description="Category filter"),
    marketplace: str = Query(default="US", description="Marketplace code"),
    request: Request = None
):
    """Search products by keyword"""
    if marketplace not in MARKETPLACES:
        raise HTTPException(status_code=400, detail=f"Invalid marketplace. Use: {list(MARKETPLACES.keys())}")
    
    # Check x402 payment
    paid, reason = await verify_x402_payment(request, "search")
    if not paid:
        return _payment_required_response("search")
    
    domain = MARKETPLACES[marketplace]
    search_url = f"https://www.{domain}/s?k={query.replace(' ', '+')}"
    
    if category:
        search_url += f"&i={category}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "en-US,en;q=0.9",
    }
    
    try:
        html = await fetch_with_proxy(search_url, headers)
        soup = BeautifulSoup(html, 'lxml')
        
        products = []
        items = soup.find_all('div', {'data-component-type': 's-search-result'})[:20]
        
        for item in items:
            asin = item.get('data-asin', '')
            title_elem = item.find('h2', class_='a-size-medium')
            price_elem = item.find('span', class_='a-price-whole')
            
            if not asin or not title_elem:
                continue
            
            title = title_elem.get_text().strip()
            price = 0.0
            if price_elem:
                try:
                    price = float(price_elem.get_text().replace('$', '').strip())
                except:
                    pass
            
            products.append({
                "asin": asin,
                "title": title,
                "price": price,
                "url": f"https://www.{domain}/dp/{asin}"
            })
        
        return SearchResponse(
            query=query,
            results=len(products),
            products=products,
            marketplace=marketplace
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search error: {str(e)}")


@app.get("/api/amazon/bestsellers")
async def get_bestsellers(
    category: str = Query(..., description="Category"),
    marketplace: str = Query(default="US", description="Marketplace code"),
    request: Request = None
):
    """Get bestsellers in category"""
    if marketplace not in MARKETPLACES:
        raise HTTPException(status_code=400, detail=f"Invalid marketplace. Use: {list(MARKETPLACES.keys())}")
    
    # Check x402 payment
    paid, reason = await verify_x402_payment(request, "bestsellers")
    if not paid:
        return _payment_required_response("bestsellers")
    
    domain = MARKETPLACES[marketplace]
    category_map = {
        "electronics": "electronics",
        "books": "stripbooks",
        "home": "home-garden",
        "toys": "toys-and-games",
        "clothing": "fashion",
    }
    
    bs_category = category_map.get(category.lower(), category)
    url = f"https://www.{domain}/gp/bestsellers/{bs_category}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "en-US,en;q=0.9",
    }
    
    try:
        html = await fetch_with_proxy(url, headers)
        soup = BeautifulSoup(html, 'lxml')
        
        products = []
        items = soup.find_all('li', class_='zg-item-immersion')[:20]
        
        for idx, item in enumerate(items, 1):
            rank_elem = item.find('span', class_='zg-badge-text')
            title_elem = item.find('div', class_='p13n-sc-truncated')
            
            if not title_elem:
                continue
            
            rank = int(rank_elem.get_text().strip()) if rank_elem else idx
            title = title_elem.get_text().strip()
            
            products.append({
                "rank": rank,
                "title": title,
                "category": category
            })
        
        return BestsellersResponse(
            category=category,
            marketplace=marketplace,
            products=products,
            last_updated=datetime.utcnow().isoformat() + "Z"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Bestsellers error: {str(e)}")


@app.get("/api/amazon/reviews/{asin}")
async def get_reviews(
    asin: str,
    sort: str = Query(default="recent", description="Sort order"),
    limit: int = Query(default=10, description="Number of reviews"),
    marketplace: str = Query(default="US", description="Marketplace code"),
    request: Request = None
):
    """Get product reviews"""
    if marketplace not in MARKETPLACES:
        raise HTTPException(status_code=400, detail=f"Invalid marketplace. Use: {list(MARKETPLACES.keys())}")
    
    # Check x402 payment
    paid, reason = await verify_x402_payment(request, "reviews")
    if not paid:
        return _payment_required_response("reviews")
    
    domain = MARKETPLACES[marketplace]
    sort_param = "recent" if sort == "recent" else "helpful"
    url = f"https://www.{domain}/product-reviews/{asin}?sortBy={sort_param}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "en-US,en;q=0.9",
    }
    
    try:
        html = await fetch_with_proxy(url, headers)
        soup = BeautifulSoup(html, 'lxml')
        
        reviews = []
        items = soup.find_all('div', {'data-hook': 'review'})[:limit]
        
        for item in items:
            rating_elem = item.find('i', {'data-hook': 'review-star-rating'})
            title_elem = item.find('a', {'data-hook': 'review-title'})
            text_elem = item.find('span', {'data-hook': 'review-body'})
            author_elem = item.find('span', class_='a-profile-name')
            date_elem = item.find('span', {'data-hook': 'review-date'})
            verified_elem = item.find('span', {'data-hook': 'avp-review-badge'})
            
            rating = 0
            if rating_elem:
                rating_match = re.search(r'([\d.]+)', rating_elem.get('aria-label', ''))
                if rating_match:
                    rating = int(float(rating_match.group(1)))
            
            reviews.append(Review(
                rating=rating,
                title=title_elem.get_text().strip() if title_elem else "",
                text=text_elem.get_text().strip() if text_elem else "",
                author=author_elem.get_text().strip() if author_elem else "Anonymous",
                date=date_elem.get_text().strip() if date_elem else "",
                verified=bool(verified_elem)
            ))
        
        return ReviewsResponse(
            asin=asin,
            total_reviews=len(reviews),
            average_rating=sum(r.rating for r in reviews) / len(reviews) if reviews else 0,
            reviews=reviews
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reviews error: {str(e)}")


@app.get("/x402/info")
async def x402_info():
    """x402 payment protocol information"""
    return {
        "protocol": "x402",
        "version": "1.0",
        "service": "Amazon Product & BSR Tracker API",
        "description": "Pay-per-request API for Amazon product data via USDC micropayments",
        "how_it_works": [
            "1. Hit any /api/amazon/* endpoint without payment",
            "2. Receive HTTP 402 with payment details (amount, USDC address, network)",
            "3. Send on-chain USDC transfer to the quoted recipient",
            "4. Retry with X-PAYMENT header set to JSON receipt",
            "5. Receive product data with verified payment",
        ],
        "pricing": PRICING,
        "payment": {
            "currency": PAYMENT_ASSET,
            "recipient": USDC_RECEIVING_ADDRESS,
            "networks": ["base", "ethereum"],
            "receipt_example": {
                "tx_hash": "0x...",
                "network": "base",
                "recipient": USDC_RECEIVING_ADDRESS,
                "amount": "0.005000",
            },
        },
        "spec": "https://www.x402.org/",
        "bounty": "https://github.com/bolivian-peru/marketplace-service-template/issues/72",
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "amazon-tracker", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
