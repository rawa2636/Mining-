import os
import json
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from google import genai
from google.genai import types

# ==========================================
# 1. Adapter Interfaces & Implementations
# ==========================================

class ModelAdapter(ABC):
    @abstractmethod
    def analyze(self, image_bytes: bytes) -> Dict[str, Any]:
        pass

class GeminiFlashAdapter(ModelAdapter):
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.model_id = 'gemini-3.1-pro-preview'
        
    def analyze(self, image_bytes: bytes) -> Dict[str, Any]:
        prompt = """
        Analyze this rock image for indirect indicators of gold mineralization.
        Focus on detecting indicators, not gold directly.
        
        Look for:
        1. Quartz veins (milky, smoky, or rusty)
        2. Oxidation (Iron oxides like hematite, limonite, gossan)
        3. Fractures and structural features
        4. Hydrothermal alteration
        
        Return ONLY a JSON object with this exact structure:
        {
            "rock_type": "Geological description of the rock",
            "features": ["list", "of", "detected", "indicators"],
            "confidence": 0.85,
            "gold_likelihood": 65,
            "reasoning": "Short scientific reasoning focusing on indicators"
        }
        """
        try:
            response = self.client.models.generate_content(
                model=self.model_id,
                contents=[
                    prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type='image/jpeg')
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2
                )
            )
            return json.loads(response.text)
        except Exception as e:
            print(f"Gemini API Error: {e}")
            return {
                "rock_type": "Unknown",
                "features": [],
                "confidence": 0.0,
                "gold_likelihood": 0,
                "reasoning": f"Analysis failed: {str(e)}"
            }

class GeoRockNetAdapter(ModelAdapter):
    def __init__(self, api_endpoint: Optional[str] = None):
        self.api_endpoint = api_endpoint
        
    def analyze(self, image_bytes: bytes) -> Dict[str, Any]:
        if not self.api_endpoint:
            return {"rock_type": None, "features": [], "confidence": 0.0}
        # Future implementation:
        # response = requests.post(self.api_endpoint, files={"image": image_bytes})
        # return response.json()
        pass

class DeepRockAdapter(ModelAdapter):
    def __init__(self, api_endpoint: Optional[str] = None):
        self.api_endpoint = api_endpoint
        
    def analyze(self, image_bytes: bytes) -> Dict[str, Any]:
        if not self.api_endpoint:
            return {"rock_type": "Pending External Analysis", "features": [], "confidence": 0.0}
        # Future implementation:
        # response = requests.post(self.api_endpoint, files={"image": image_bytes})
        # return response.json()
        pass

# ==========================================
# 2. Fusion Layer (Analyzer Service)
# ==========================================

class GeologicalAnalyzerService:
    def __init__(self, gemini_api_key: str):
        self.gemini = GeminiFlashAdapter(api_key=gemini_api_key)
        self.georocknet = GeoRockNetAdapter() # Add endpoint URL here later
        self.deeprock = DeepRockAdapter()     # Add endpoint URL here later
        
    def analyze_sample(self, image_bytes: bytes) -> Dict[str, Any]:
        # Run models
        gemini_result = self.gemini.analyze(image_bytes)
        georocknet_result = self.georocknet.analyze(image_bytes)
        deeprock_result = self.deeprock.analyze(image_bytes)
        
        # Fusion Logic
        weights = {
            "gemini": 1.0 if gemini_result.get("confidence", 0) > 0 else 0.0,
            "georocknet": 0.5 if georocknet_result.get("confidence", 0) > 0 else 0.0,
            "deeprock": 0.5 if deeprock_result.get("confidence", 0) > 0 else 0.0
        }
        
        all_features = set(gemini_result.get("features", []))
        all_features.update(georocknet_result.get("features", []))
        all_features.update(deeprock_result.get("features", []))
        
        final_rock_type = deeprock_result.get("rock_type") 
        if not final_rock_type or final_rock_type == "Pending External Analysis":
            final_rock_type = gemini_result.get("rock_type", "Unknown")
            
        final_likelihood = gemini_result.get("gold_likelihood", 0)
        
        return {
            "rock_type": final_rock_type,
            "indicators": list(all_features),
            "gold_likelihood": final_likelihood,
            "reasoning": gemini_result.get("reasoning", "Analysis complete."),
            "active_models": [k for k, v in weights.items() if v > 0]
        }

# ==========================================
# 3. FastAPI Application Setup
# ==========================================

app = FastAPI(
    title="Gold Analyzer API",
    description="Modular API for geological image analysis using Gemini Flash and external models.",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, replace with your frontend URL (e.g., Vercel domain)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the service
API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("WARNING: GEMINI_API_KEY environment variable is not set!")

analyzer_service = GeologicalAnalyzerService(gemini_api_key=API_KEY or "DUMMY_KEY")

# ==========================================
# 4. API Endpoints
# ==========================================

class AnalysisResponse(BaseModel):
    status: str
    data: Dict[str, Any]

@app.get("/")
def read_root():
    return {"message": "Welcome to the Gold Analyzer API. Use POST /api/v1/analyze to upload an image."}

@app.post("/api/v1/analyze", response_model=AnalysisResponse)
async def analyze_image(file: UploadFile = File(...)):
    """
    Endpoint to analyze a geological image.
    Accepts a file upload (multipart/form-data).
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")
    
    try:
        # Read image bytes
        image_bytes = await file.read()
        
        # Pass to the Fusion Layer
        result = analyzer_service.analyze_sample(image_bytes)
        
        return {
            "status": "success",
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

# ==========================================
# 5. Server Execution
# ==========================================
if __name__ == "__main__":
    # Run the server using uvicorn
    # Command: python api.py
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
