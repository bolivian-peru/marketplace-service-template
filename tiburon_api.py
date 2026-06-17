import asyncio
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import httpx
from bs4 import BeautifulSoup
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
import torch

# ================= CONFIGURACIÓN =================
app = FastAPI(title="Tiburón Supremo Maximal AI", version="1.0.0")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ================= MODELO DE IA LOCAL (Transformers) =================
# Usamos "cpu" en lugar de -1 para evitar errores de índice
device = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Cargando modelo de resumen en {device.upper()}...")

try:
    model_name = "facebook/bart-large-cnn"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name).to(device)
    logger.info("¡Modelo y tokenizador cargados con éxito!")
except Exception as e:
    logger.error(f"Error cargando el modelo: {e}")
    tokenizer = None
    model = None

# Función de resumen manual (sin pipeline)
def summarize_text(text: str, max_length: int = 150, min_length: int = 30) -> str:
    if model is None or tokenizer is None:
        raise RuntimeError("El modelo de IA no está disponible.")
    
    # Truncar entrada si es muy larga (BART tiene límite de 1024 tokens)
    inputs = tokenizer.encode(text, truncation=True, max_length=1024, return_tensors="pt")
    inputs = inputs.to(device)
    
    summary_ids = model.generate(
        inputs,
        max_length=max_length,
        min_length=min_length,
        do_sample=False,
        forced_bos_token_id=0  # Necesario para BART
    )
    summary = tokenizer.decode(summary_ids[0], skip_special_tokens=True)
    return summary

# ================= SCRAPER =================
async def scrape_text_from_url(url: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url, follow_redirects=True)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'lxml')
            for script in soup(["script", "style"]):
                script.decompose()
            paragraphs = soup.find_all('p')
            text = " ".join([p.get_text(strip=True) for p in paragraphs])
            if not text:
                text = soup.get_text(separator=" ", strip=True)
            text = " ".join(text.split())
            return text if len(text) > 100 else "No se encontró suficiente texto en la URL."
    except Exception as e:
        logger.error(f"Error al scrapear {url}: {e}")
        return f"Error al obtener la URL: {str(e)}"

# ================= MODELOS DE DATOS =================
class ScrapeRequest(BaseModel):
    url: str
    max_length: Optional[int] = 150
    min_length: Optional[int] = 30

class ErrorRequest(BaseModel):
    error_code: str
    sistema: Optional[str] = "general"

class ResponseData(BaseModel):
    status: str
    original_text: Optional[str] = None
    summary: Optional[str] = None
    message: str

# ================= ENDPOINTS =================
@app.get("/analyze/Python")
async def analyze_python():
    return {
        "status": "success",
        "data": {
            "status": "success",
            "message": "Conectado correctamente para Python - Modo Tiburón Supremo Activado"
        }
    }

@app.post("/scrape-and-summarize", response_model=ResponseData)
async def scrape_and_summarize(request: ScrapeRequest):
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="El modelo de IA no está disponible.")
    
    raw_text = await scrape_text_from_url(request.url)
    if "Error al obtener" in raw_text or "No se encontró" in raw_text:
        return ResponseData(
            status="warning",
            original_text=raw_text,
            summary=None,
            message="Hubo un problema al obtener el texto, pero la IA puede intentar procesarlo."
        )
    
    try:
        # Recortar texto si es demasiado largo para evitar exceder el límite de tokens
        if len(raw_text) > 4000:
            raw_text = raw_text[:4000]
        
        summary = summarize_text(
            raw_text,
            max_length=request.max_length,
            min_length=request.min_length
        )
        
        return ResponseData(
            status="success",
            original_text=raw_text[:500] + "... (truncado por legibilidad)",
            summary=summary,
            message="¡Análisis completado por el Tiburón Supremo!"
        )
    except Exception as e:
        logger.error(f"Error en IA: {e}")
        raise HTTPException(status_code=500, detail=f"Error al procesar la IA: {str(e)}")

@app.post("/tech-support")
async def tech_support(request: ErrorRequest):
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="El modelo de IA no está disponible.")
    
    query = f"{request.error_code} {request.sistema} solution fix"
    search_url = f"https://html.duckduckgo.com/html/?q={query.replace(' ', '+')}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            search_response = await client.get(search_url)
            soup = BeautifulSoup(search_response.text, 'lxml')
            result_link = soup.find('a', class_='result__a')
            if not result_link:
                return {
                    "status": "not_found",
                    "message": f"No se encontraron guías para el error {request.error_code}."
                }
            first_url = result_link.get('href')
            if first_url.startswith('/'):
                first_url = 'https://duckduckgo.com' + first_url
            elif not first_url.startswith('http'):
                first_url = 'https://' + first_url
            
            raw_text = await scrape_text_from_url(first_url)
            if len(raw_text) > 4000:
                raw_text = raw_text[:4000]
            
            summary = summarize_text(raw_text, max_length=200, min_length=40)
            
            return {
                "status": "success",
                "error_code": request.error_code,
                "url_encontrada": first_url,
                "resumen_solucion": summary,
                "mensaje": "¡Soporte técnico generado por IA, mi Tiburón!"
            }
    except Exception as e:
        logger.error(f"Error en soporte técnico: {e}")
        raise HTTPException(status_code=500, detail=f"Error en el soporte: {str(e)}")

@app.get("/health")
async def health_check():
    return {
        "status": "alive",
        "ia_loaded": model is not None and tokenizer is not None,
        "gpu_available": torch.cuda.is_available()
    }

if __name__ == "__main__":
    import uvicorn
    # Usamos puerto 9502 (ya lo tienes libre)
    uvicorn.run(app, host="127.0.0.1", port=9502, log_level="info")