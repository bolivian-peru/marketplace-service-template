from fastapi import FastAPI
import uvicorn
import traceback
import sys
import os
from transformers import pipeline

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    import scraper
    print("✅ scraper importado correctamente")
except ImportError as e:
    print(f"❌ Error al importar scraper: {e}")
    sys.exit(1)

app = FastAPI(title="Trend Intelligence API")

try:
    sentiment_pipeline = pipeline("sentiment-analysis", model="nlptown/bert-base-multilingual-uncased-sentiment")
    print("✅ Modelo de sentimiento cargado correctamente")
except Exception as e:
    print(f"❌ Error al cargar modelo: {e}")
    sentiment_pipeline = None

@app.get("/")
async def root():
    return {"message": "Trend Intelligence API is running"}

@app.get("/analyze/{keyword}")
async def analyze(keyword: str):
    try:
        data = await scraper.get_trends(keyword)
        return {"status": "success", "data": data}
    except Exception as e:
        print(traceback.format_exc())
        return {"status": "error", "message": str(e)}

@app.get("/sentiment/{text}")
async def sentiment(text: str):
    if sentiment_pipeline is None:
        return {"status": "error", "message": "Modelo no disponible"}
    try:
        result = sentiment_pipeline(text)
        return {"status": "success", "text": text, "sentiment": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/analyze-sentiment/{keyword}")
async def analyze_sentiment(keyword: str):
    try:
        data = await scraper.get_trends(keyword)
        if data.get("status") != "success" or not data.get("results"):
            return {"status": "error", "message": "No se obtuvieron resultados para analizar"}

        titles = [item.get("title", "") for item in data["results"] if item.get("title")]
        if not titles:
            return {"status": "error", "message": "No hay títulos para analizar"}

        sentiments = []
        for title in titles:
            try:
                result = sentiment_pipeline(title)
                sentiments.append({"title": title, "sentiment": result})
            except Exception as e:
                sentiments.append({"title": title, "sentiment": [{"label": "ERROR", "score": 0}]})

        return {"status": "success", "keyword": keyword, "sentiments": sentiments}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9500)