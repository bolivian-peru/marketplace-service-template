# 🦈 Health Prediction AI - Servicio de Predicción de Salud con IA

## 📋 Descripción General
Este servicio ofrece una **API de predicción de salud** basada en inteligencia artificial. Permite analizar biomarcadores clave (Glucosa, Hemoglobina y Colesterol) y genera evaluaciones de riesgo clínico junto con reportes automatizados utilizando modelos de lenguaje natural (NLP).

## ✨ Características Principales
- **Análisis de Biomarcadores**: Evalúa glucosa, hemoglobina y colesterol.
- **Evaluación de Riesgos**: Identifica riesgos de diabetes, anemia y enfermedades cardiovasculares.
- **Reportes Clínicos con IA**: Genera reportes profesionales utilizando modelos de lenguaje (BART-Large-CNN).
- **Validación Robusta**: Manejo de errores y validación de datos de entrada.
- **Endpoints REST**: Documentados y listos para producción.
- **Fácil Despliegue**: Listo para ejecutarse en entornos locales o en la nube.

## 🛠️ Tecnologías Utilizadas
- **Python 3.8+**
- **FastAPI**: Framework web de alto rendimiento.
- **Transformers (Hugging Face)**: Modelos de lenguaje para generación de reportes.
- **PyTorch**: Backend para modelos de IA.
- **Uvicorn**: Servidor ASGI para aplicaciones FastAPI.

## 📦 Instalación

### 1. Clonar el repositorio
```bash
git clone https://github.com/tu-usuario/tu-repositorio
cd tu-repositorio