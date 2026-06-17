from fastapi import FastAPI
import uvicorn
import scraper # Tu archivo que hace el trabajo de buscar

app = FastAPI()

@app.get("/analyze/{keyword}")
async def analyze(keyword: str):
    # Aquí llamas a tu lógica de scraper
    data = await scraper.get_trends(keyword)
    return {"status": "success", "results": data}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8005)