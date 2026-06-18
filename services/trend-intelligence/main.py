import asyncio
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import httpx
from bs4 import BeautifulSoup
import re
from datetime import datetime
import json
from collections import Counter

# ================= CONFIGURACIÓN =================
app = FastAPI(title="Trend Intelligence API - Tiburón Supremo", version="1.0.0")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ================= MODELOS DE DATOS =================
class SearchRequest(BaseModel):
    query: str
    platforms: Optional[List[str]] = ["reddit", "twitter", "youtube", "web"]
    max_results: Optional[int] = 10

class TrendResponse(BaseModel):
    status: str
    query: str
    timestamp: str
    results: dict
    sentiment: dict
    keywords: List[str]
    patterns: dict
    recommendations: List[str]
    message: str

# ================= FUNCIONES DE SCRAPING =================

async def scrape_reddit(query: str, limit: int = 10) -> List[dict]:
    """Busca en Reddit usando la API JSON pública."""
    try:
        url = f"https://www.reddit.com/search.json?q={query}&limit={limit}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers={"User-Agent": "TrendBot/1.0"})
            if response.status_code != 200:
                return []
            data = response.json()
            results = []
            for child in data.get("data", {}).get("children", []):
                post = child.get("data", {})
                results.append({
                    "title": post.get("title", ""),
                    "url": f"https://reddit.com{post.get('permalink', '')}",
                    "score": post.get("score", 0),
                    "comments": post.get("num_comments", 0),
                    "created": datetime.fromtimestamp(post.get("created_utc", 0)).isoformat(),
                    "source": "reddit"
                })
            return results
    except Exception as e:
        logger.error(f"Error en Reddit: {e}")
        return []

async def scrape_twitter(query: str, limit: int = 10) -> List[dict]:
    """Busca en Twitter usando Nitter (frontend alternativo)."""
    try:
        url = f"https://nitter.net/search?q={query}&f=tweets"
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url)
            if response.status_code != 200:
                return []
            soup = BeautifulSoup(response.text, 'lxml')
            tweets = soup.select(".timeline-item .tweet-content")
            results = []
            for tweet in tweets[:limit]:
                text = tweet.get_text(strip=True)
                results.append({
                    "text": text,
                    "source": "twitter",
                    "url": "https://twitter.com/search?q={}".format(query)
                })
            return results
    except Exception as e:
        logger.error(f"Error en Twitter: {e}")
        return []

async def scrape_youtube(query: str, limit: int = 10) -> List[dict]:
    """Busca en YouTube usando la API RSS de Invidious."""
    try:
        url = f"https://invidious.fdn.fr/api/v1/search?q={query}&type=video&fields=title,url,viewCount,likeCount,published"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            if response.status_code != 200:
                return []
            data = response.json()
            results = []
            for item in data[:limit]:
                results.append({
                    "title": item.get("title", ""),
                    "url": f"https://youtube.com{item.get('url', '')}",
                    "views": item.get("viewCount", 0),
                    "likes": item.get("likeCount", 0),
                    "published": item.get("published", ""),
                    "source": "youtube"
                })
            return results
    except Exception as e:
        logger.error(f"Error en YouTube: {e}")
        return []

async def scrape_web(query: str, limit: int = 10) -> List[dict]:
    """Busca en la web usando DuckDuckGo HTML."""
    try:
        url = f"https://html.duckduckgo.com/html/?q={query}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url)
            if response.status_code != 200:
                return []
            soup = BeautifulSoup(response.text, 'lxml')
            results = []
            for result in soup.select(".result")[:limit]:
                title_elem = result.select_one(".result__a")
                snippet_elem = result.select_one(".result__snippet")
                if title_elem:
                    results.append({
                        "title": title_elem.get_text(strip=True),
                        "url": title_elem.get("href", ""),
                        "snippet": snippet_elem.get_text(strip=True) if snippet_elem else "",
                        "source": "web"
                    })
            return results
    except Exception as e:
        logger.error(f"Error en Web: {e}")
        return []

# ================= ANÁLISIS DE SENTIMIENTO Y PATRONES =================

def analyze_sentiment(texts: List[str]) -> dict:
    """Análisis de sentimiento básico basado en palabras clave."""
    positive_words = {"good", "great", "excellent", "amazing", "awesome", "best", "love", "positive", "recommend", "happy"}
    negative_words = {"bad", "terrible", "awful", "worst", "hate", "negative", "fail", "poor", "disappointed", "scam"}

    positive_count = 0
    negative_count = 0
    for text in texts:
        words = set(re.findall(r'\w+', text.lower()))
        positive_count += len(words & positive_words)
        negative_count += len(words & negative_words)

    total = positive_count + negative_count
    if total == 0:
        return {"sentiment": "neutral", "score": 0, "positive": 0, "negative": 0}
    score = (positive_count - negative_count) / total
    sentiment = "positive" if score > 0.1 else "negative" if score < -0.1 else "neutral"
    return {
        "sentiment": sentiment,
        "score": round(score, 2),
        "positive": positive_count,
        "negative": negative_count
    }

def extract_keywords(texts: List[str], top_n: int = 10) -> List[str]:
    """Extrae las palabras clave más frecuentes."""
    words = []
    for text in texts:
        words.extend(re.findall(r'\b\w{4,}\b', text.lower()))
    counter = Counter(words)
    common = counter.most_common(top_n)
    return [word for word, _ in common]

def detect_patterns(results: dict) -> dict:
    """Detecta patrones en los resultados."""
    patterns = {
        "cross_platform": False,
        "high_engagement": False,
        "recent": False
    }
    # Detectar si hay resultados en múltiples plataformas
    platforms_with_results = [p for p, items in results.items() if items]
    if len(platforms_with_results) >= 2:
        patterns["cross_platform"] = True

    # Detectar alta participación (ej: Reddit score > 100, YouTube views > 10000)
    high_engagement = False
    for platform, items in results.items():
        for item in items:
            if platform == "reddit" and item.get("score", 0) > 100:
                high_engagement = True
            elif platform == "youtube" and item.get("views", 0) > 10000:
                high_engagement = True
            elif platform == "twitter" and len(item.get("text", "")) > 50:
                high_engagement = True
    patterns["high_engagement"] = high_engagement

    # Detectar actualidad (resultados de los últimos 7 días)
    recent = False
    try:
        for platform, items in results.items():
            for item in items:
                if "created" in item:
                    created = datetime.fromisoformat(item["created"])
                    if (datetime.now() - created).days < 7:
                        recent = True
                        break
    except:
        pass
    patterns["recent"] = recent

    return patterns

def generate_recommendations(patterns: dict, query: str) -> List[str]:
    """Genera recomendaciones basadas en los patrones."""
    recs = []
    if patterns.get("cross_platform"):
        recs.append(f"El tema '{query}' está siendo discutido en múltiples plataformas. Considera monitorearlo activamente.")
    else:
        recs.append(f"El tema '{query}' parece concentrarse en una sola plataforma. Podrías expandir la búsqueda.")
    if patterns.get("high_engagement"):
        recs.append(f"Hay alta participación en torno a '{query}'. Podrías crear contenido relevante para capitalizar el interés.")
    else:
        recs.append(f"La participación en '{query}' es moderada. Podrías intentar generar más interacción.")
    if patterns.get("recent"):
        recs.append(f"'{query}' es un tema reciente. Aprovecha la novedad para obtener visibilidad.")
    else:
        recs.append(f"'{query}' parece ser un tema más establecido. Considera un enfoque de largo plazo.")
    return recs

# ================= ENDPOINT PRINCIPAL =================
@app.post("/trend-intelligence", response_model=TrendResponse)
async def get_trends(request: SearchRequest):
    """
    Endpoint principal para obtener inteligencia de tendencias.
    """
    try:
        query = request.query
        platforms = request.platforms
        max_results = request.max_results

        # Ejecutar scraping en paralelo
        tasks = {}
        if "reddit" in platforms:
            tasks["reddit"] = scrape_reddit(query, max_results)
        if "twitter" in platforms:
            tasks["twitter"] = scrape_twitter(query, max_results)
        if "youtube" in platforms:
            tasks["youtube"] = scrape_youtube(query, max_results)
        if "web" in platforms:
            tasks["web"] = scrape_web(query, max_results)

        results = {}
        for platform, task in tasks.items():
            results[platform] = await task

        # Recopilar todos los textos para análisis
        all_texts = []
        for platform, items in results.items():
            for item in items:
                if "title" in item:
                    all_texts.append(item["title"])
                if "text" in item:
                    all_texts.append(item["text"])
                if "snippet" in item:
                    all_texts.append(item["snippet"])

        # Análisis
        sentiment = analyze_sentiment(all_texts) if all_texts else {"sentiment": "neutral", "score": 0, "positive": 0, "negative": 0}
        keywords = extract_keywords(all_texts) if all_texts else []
        patterns = detect_patterns(results)
        recommendations = generate_recommendations(patterns, query)

        # Crear respuesta estructurada
        return TrendResponse(
            status="success",
            query=query,
            timestamp=datetime.now().isoformat(),
            results=results,
            sentiment=sentiment,
            keywords=keywords,
            patterns=patterns,
            recommendations=recommendations,
            message=f"Análisis completado para '{query}' con {len(all_texts)} items extraídos."
        )

    except Exception as e:
        logger.error(f"Error en trend-intelligence: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno: {str(e)}")

# ================= ENDPOINTS ADICIONALES =================
@app.get("/")
async def root():
    return {
        "service": "Trend Intelligence API - Tiburón Supremo",
        "version": "1.0.0",
        "endpoints": {
            "/trend-intelligence": "POST - Obtener análisis de tendencias de múltiples plataformas",
            "/health": "GET - Estado del servicio"
        }
    }

@app.get("/health")
async def health():
    return {"status": "alive", "timestamp": datetime.now().isoformat()}

# ================= EJECUCIÓN =================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9504, log_level="info")