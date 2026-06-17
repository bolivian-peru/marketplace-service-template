## Servicio de Predicción de Salud (`health_api.py`)

Este servicio complementa el análisis de inteligencia de tendencias, permitiendo a los agentes de IA enviar biomarcadores y recibir una evaluación clínica profesional.

**Endpoint:**
- `POST /analyze-biomarkers`
  - Body: `{"glucose": 130, "haemoglobin": 11.0, "cholesterol": 250}`
  - Respuesta: Evaluación de riesgos y un reporte clínico generado por IA.

**Tecnología:** Utiliza el modelo `google/gemini-2.5-flash:free` a través de OpenRouter para la generación de reportes.