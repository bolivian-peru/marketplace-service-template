import asyncio
import logging
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict
import json
import time
from datetime import datetime
from bs4 import BeautifulSoup

# ================= CONFIGURACIÓN =================
app = FastAPI(title="Trend Intelligence API - Tiburón Supremo", version="1.0.0")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ================= MODELOS DE DATOS =================
class TrendRequest(BaseModel):
    query: str
    platforms: Optional[List[str]] = ["reddit", "twitter", "youtube", "web"]
    max_results: Optional[int] = 5

class TrendResponse(BaseModel):
    query: str
    timestamp: str
    sources: Dict[str, List[Dict]]
    sentiment_summary: Dict[str, float]
    keywords: List[str]
    recommendations: List[str]

# ================= FUNCIONES DE SCRAPING (SIMULADAS PARA DEMO) =================
async def scrape_reddit(query: str, limit: int = 5) -> List[Dict]:
    # Simulación: en producción usarías una API real
    return [
        {"title": f"Reddit post about {query} {i+1}", "url": f"https://reddit.com/r/all/{i+1}", "score": 100 - i*10, "comments": 20 - i*2}
        for i in range(limit)
    ]

async def scrape_twitter(query: str, limit: int = 5) -> List[Dict]:
    # Simulación
    return [
        {"text": f"Tweet about {query} {i+1}", "url": f"https://twitter.com/user/status/{i+1}", "likes": 200 - i*20, "retweets": 50 - i*5}
        for i in range(limit)
    ]

async def scrape_youtube(query: str, limit: int = 5) -> List[Dict]:
    # Simulación
    return [
        {"title": f"YouTube video about {query} {i+1}", "url": f"https://youtube.com/watch?v={i+1}", "views": 1000 - i*100, "likes": 100 - i*10}
        for i in range(limit)
    ]

async def scrape_web(query: str, limit: int = 5) -> List[Dict]:
    # Simulación
    return [
        {"title": f"Web result {i+1} for {query}", "url": f"https://example.com/{i+1}", "description": f"Description of result {i+1}"}
        for i in range(limit)
    ]

def analyze_sentiment(text: str) -> float:
    # Simulación de análisis de sentimiento (0 a 1)
    import random
    return round(random.uniform(0.3, 0.8), 2)

def extract_keywords(text: str, top_n: int = 5) -> List[str]:
    # Simulación de extracción de keywords
    words = text.split()
    return list(set([w.lower() for w in words if len(w) > 3]))[:top_n]

# ================= ENDPOINTS =================
@app.get("/")
async def root():
    return {
        "service": "Trend Intelligence API - Tiburón Supremo",
        "version": "1.0.0",
        "endpoints": {
            "/analyze": "POST - Analiza tendencias para una consulta en múltiples plataformas",
            "/health": "GET - Estado del servicio",
            "/": "GET - Información del servicio"
        }
    }

@app.get("/health")
async def health_check():
    return {"status": "alive", "timestamp": datetime.utcnow().isoformat()}

@app.post("/analyze", response_model=TrendResponse)
async def analyze_trends(request: TrendRequest):
    """
    Recibe una consulta y devuelve un informe de inteligencia de tendencias.
    """
    try:
        logger.info(f"Analizando tendencias para: {request.query}")
        
        # Scrapear cada plataforma solicitada
        sources = {}
        for platform in request.platforms:
            if platform == "reddit":
                sources["reddit"] = await scrape_reddit(request.query, request.max_results)
            elif platform == "twitter":
                sources["twitter"] = await scrape_twitter(request.query, request.max_results)
            elif platform == "youtube":
                sources["youtube"] = await scrape_youtube(request.query, request.max_results)
            elif platform == "web":
                sources["web"] = await scrape_web(request.query, request.max_results)
            else:
                logger.warning(f"Plataforma no soportada: {platform}")
                continue
        
        # Análisis de sentimiento (simulado)
        all_texts = []
        for platform, items in sources.items():
            for item in items:
                if "title" in item:
                    all_texts.append(item["title"])
                if "text" in item:
                    all_texts.append(item["text"])
                if "description" in item:
                    all_texts.append(item["description"])
        
        combined_text = " ".join(all_texts)
        sentiment_score = analyze_sentiment(combined_text) if combined_text else 0.5
        keywords = extract_keywords(combined_text, 5) if combined_text else ["no", "keywords"]
        
        # Recomendaciones básicas
        recommendations = []
        if sentiment_score > 0.7:
            recommendations.append("El sentimiento general es positivo. Considera invertir en este tema.")
        elif sentiment_score < 0.3:
            recommendations.append("El sentimiento general es negativo. Ten cuidado con este tema.")
        else:
            recommendations.append("El sentimiento es neutral. Monitorea el tema para detectar cambios.")
        
        if len(sources.keys()) >= 3:
            recommendations.append("El tema se está discutiendo en múltiples plataformas. Es una tendencia relevante.")
        
        response = TrendResponse(
            query=request.query,
            timestamp=datetime.utcnow().isoformat(),
            sources=sources,
            sentiment_summary={
                "positive": sentiment_score,
                "negative": 1 - sentiment_score,
                "neutral": 0.5 if sentiment_score == 0.5 else abs(0.5 - sentiment_score)
            },
            keywords=keywords,
            recommendations=recommendations
        )
        
        logger.info(f"Análisis completado para: {request.query}")
        return response
        
    except Exception as e:
        logger.error(f"Error en análisis: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno: {str(e)}")

# ================= EJECUCIÓN =================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9504, log_level="info")