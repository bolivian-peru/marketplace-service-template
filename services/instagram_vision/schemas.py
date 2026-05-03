from pydantic import BaseModel
from typing import List, Dict

class VisionAnalysisResponse(BaseModel):
    detected_objects: List[str]
    aesthetics_score: float
    brand_safety: bool
    dimensions: Dict[str, int]
    format: str
    color_dominance: tuple
