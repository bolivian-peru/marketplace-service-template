import os
import logging
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

# ================= CONFIGURACIÓN =================
app = FastAPI(title="Health Prediction AI Service - Tiburón Supremo", version="1.0.0")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ================= MODELO DE IA LOCAL (para reportes clínicos) =================
device = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Cargando modelo de IA para reportes clínicos en {device.upper()}...")

try:
    model_name = "facebook/bart-large-cnn"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name).to(device)
    logger.info("¡Modelo de IA cargado con éxito!")
except Exception as e:
    logger.error(f"Error cargando el modelo: {e}")
    tokenizer = None
    model = None

# ================= FUNCIÓN PARA GENERAR REPORTE CLÍNICO =================
def generate_clinical_report(biomarkers: dict) -> str:
    """Genera un reporte clínico profesional usando IA local."""
    if model is None or tokenizer is None:
        return "Reporte clínico no disponible (modelo no cargado)."
    
    try:
        # Construir prompt clínico profesional
        prompt = f"""
        Paciente presenta los siguientes biomarcadores:
        - Glucosa: {biomarkers.get('glucose', 0)} mg/dL
        - Hemoglobina: {biomarkers.get('haemoglobin', 0)} g/dL  
        - Colesterol: {biomarkers.get('cholesterol', 0)} mg/dL
        
        Basado en estos valores, genera un reporte clínico breve y profesional. 
        Incluye evaluación de riesgos y recomendaciones.
        """
        
        # Tokenizar y generar
        inputs = tokenizer.encode(prompt, truncation=True, max_length=512, return_tensors="pt")
        inputs = inputs.to(device)
        
        summary_ids = model.generate(
            inputs,
            max_length=200,
            min_length=50,
            do_sample=True,
            temperature=0.7,
            forced_bos_token_id=0
        )
        report = tokenizer.decode(summary_ids[0], skip_special_tokens=True)
        return report
    except Exception as e:
        logger.error(f"Error generando reporte: {e}")
        return "Error al generar el reporte clínico."

# ================= MODELOS DE DATOS =================
class Biomarkers(BaseModel):
    glucose: float
    haemoglobin: float
    cholesterol: float
    patient_name: Optional[str] = "Paciente"
    patient_age: Optional[int] = None

class HealthResponse(BaseModel):
    status: str
    data: dict
    clinical_report: Optional[str] = None
    message: str

# ================= ENDPOINTS =================
@app.get("/")
async def root():
    return {
        "service": "Health Prediction AI - Tiburón Supremo",
        "version": "1.0.0",
        "endpoints": {
            "/analyze-biomarkers": "POST - Analiza biomarcadores y genera reporte clínico",
            "/health": "GET - Estado del servicio",
            "/": "GET - Información del servicio"
        }
    }

@app.get("/health")
async def health_check():
    return {
        "status": "alive",
        "ia_loaded": model is not None and tokenizer is not None,
        "gpu_available": torch.cuda.is_available()
    }

@app.post("/analyze-biomarkers", response_model=HealthResponse)
async def analyze_biomarkers(data: Biomarkers):
    """
    Analiza biomarcadores y genera un reporte clínico con IA.
    
    - glucose: 70-100 mg/dL (normal), >125 mg/dL (diabetes)
    - haemoglobin: 12.0-17.5 g/dL (normal), <12.0 g/dL (anemia)
    - cholesterol: <200 mg/dL (normal), >=240 mg/dL (alto)
    """
    try:
        # Validaciones básicas
        if data.glucose <= 0:
            raise HTTPException(status_code=400, detail="La glucosa debe ser un valor positivo")
        if data.haemoglobin <= 0:
            raise HTTPException(status_code=400, detail="La hemoglobina debe ser un valor positivo")
        if data.cholesterol <= 0:
            raise HTTPException(status_code=400, detail="El colesterol debe ser un valor positivo")
        
        # Evaluación de riesgos (lógica de Tiburón)
        risks = {
            "diabetes_risk": "Alto" if data.glucose > 125 else "Moderado" if data.glucose > 100 else "Normal",
            "anemia_risk": "Alto" if data.haemoglobin < 12.0 else "Moderado" if data.haemoglobin < 13.5 else "Normal",
            "cardio_risk": "Alto" if data.cholesterol >= 240 else "Moderado" if data.cholesterol >= 200 else "Normal"
        }
        
        # Generar reporte clínico con IA (si está disponible)
        clinical_report = generate_clinical_report({
            "glucose": data.glucose,
            "haemoglobin": data.haemoglobin,
            "cholesterol": data.cholesterol
        })
        
        # Respuesta final
        return HealthResponse(
            status="success",
            data={
                "patient": data.patient_name,
                "age": data.patient_age,
                "biomarkers": {
                    "glucose": data.glucose,
                    "haemoglobin": data.haemoglobin,
                    "cholesterol": data.cholesterol
                },
                "risks": risks,
                "summary": {
                    "total_risks": sum(1 for v in risks.values() if v == "Alto"),
                    "moderate_risks": sum(1 for v in risks.values() if v == "Moderado")
                }
            },
            clinical_report=clinical_report,
            message="¡Análisis clínico completado por el Tiburón Supremo IA!"
        )
        
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error en análisis: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno: {str(e)}")

# ================= EJECUCIÓN =================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9503, log_level="info")