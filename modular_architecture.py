import os
import json
import base64
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from google import genai
from google.genai import types

# ==========================================
# 1. System Architecture Diagram (Text)
# ==========================================
"""
[Client / UI]
      |
      v (Image Upload)
[FastAPI / Backend Entry Point]
      |
      v
[Fusion Layer (Analyzer Service)]
      |-----> [Gemini Adapter] (Primary Visual & Geological Interpretation)
      |
      |-----> [GeoRockNet Adapter] (Abstracted - Feature Extraction)
      |
      |-----> [DeepRock Adapter] (Abstracted - Rock Classification)
      |
      v
[Weighted Scoring Engine] (Combines outputs)
      |
      v
[Final JSON Response]
"""

# ==========================================
# 2. Adapter Interfaces (Pluggable Architecture)
# ==========================================

class ModelAdapter(ABC):
    """Base interface for all external models to ensure plug-and-play capability."""
    
    @abstractmethod
    def analyze(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Standard Output Format:
        {
            "rock_type": "...",
            "features": ["quartz_vein", "oxidation", "fractures"],
            "confidence": 0.0 to 1.0
        }
        """
        pass

# ==========================================
# 3. Concrete Implementations
# ==========================================

class GeminiFlashAdapter(ModelAdapter):
    """Primary model using Gemini Pro for visual and geological interpretation."""
    
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.model_id = 'gemini-3.1-pro-preview' # Using Pro for advanced analysis
        
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
                    types.Part.from_bytes(
                        data=image_bytes,
                        mime_type='image/jpeg'
                    )
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2
                )
            )
            
            # Parse the JSON response
            result = json.loads(response.text)
            return result
            
        except Exception as e:
            print(f"Gemini API Error: {e}")
            # Fallback safe response
            return {
                "rock_type": "Unknown",
                "features": [],
                "confidence": 0.0,
                "gold_likelihood": 0,
                "reasoning": f"Analysis failed: {str(e)}"
            }

class GeoRockNetAdapter(ModelAdapter):
    """
    Placeholder for GeoRockNet (Feature Extraction).
    Currently simulated. Can be connected to a real REST API later.
    """
    def __init__(self, api_endpoint: Optional[str] = None):
        self.api_endpoint = api_endpoint
        
    def analyze(self, image_bytes: bytes) -> Dict[str, Any]:
        if not self.api_endpoint:
            # Simulated output when external model is not yet connected
            return {
                "rock_type": None, # GeoRockNet focuses on features
                "features": [], # Would be populated by real model
                "confidence": 0.0
            }
        
        # Example of how to connect later:
        # response = requests.post(self.api_endpoint, files={"image": image_bytes})
        # return response.json()
        pass

class DeepRockAdapter(ModelAdapter):
    """
    Placeholder for DeepRock (Rock Classification).
    Currently simulated. Can be connected to a real REST API later.
    """
    def __init__(self, api_endpoint: Optional[str] = None):
        self.api_endpoint = api_endpoint
        
    def analyze(self, image_bytes: bytes) -> Dict[str, Any]:
        if not self.api_endpoint:
            # Simulated output
            return {
                "rock_type": "Pending External Analysis",
                "features": [],
                "confidence": 0.0
            }
        # Example connection:
        # response = requests.post(self.api_endpoint, files={"image": image_bytes})
        # return response.json()
        pass

# ==========================================
# 4. Fusion Layer (Combines Outputs)
# ==========================================

class GeologicalAnalyzerService:
    """Orchestrates multiple models and fuses their results."""
    
    def __init__(self, gemini_api_key: str):
        # Initialize available models
        self.gemini = GeminiFlashAdapter(api_key=gemini_api_key)
        
        # External models (currently unconfigured/simulated)
        self.georocknet = GeoRockNetAdapter()
        self.deeprock = DeepRockAdapter()
        
    def analyze_sample(self, image_bytes: bytes) -> Dict[str, Any]:
        """Runs all available models and fuses the results."""
        
        # 1. Run models (In a real app, use asyncio.gather for parallel execution)
        gemini_result = self.gemini.analyze(image_bytes)
        georocknet_result = self.georocknet.analyze(image_bytes)
        deeprock_result = self.deeprock.analyze(image_bytes)
        
        # 2. Fusion Logic (Weighted Scoring)
        # Currently, Gemini is the primary source of truth.
        # As external models are added, their weights can be increased.
        
        weights = {
            "gemini": 1.0 if gemini_result["confidence"] > 0 else 0.0,
            "georocknet": 0.5 if georocknet_result["confidence"] > 0 else 0.0,
            "deeprock": 0.5 if deeprock_result["confidence"] > 0 else 0.0
        }
        
        total_weight = sum(weights.values())
        
        # Combine features (deduplicated)
        all_features = set(gemini_result.get("features", []))
        all_features.update(georocknet_result.get("features", []))
        all_features.update(deeprock_result.get("features", []))
        
        # Determine Rock Type (DeepRock > Gemini)
        final_rock_type = deeprock_result.get("rock_type") 
        if not final_rock_type or final_rock_type == "Pending External Analysis":
            final_rock_type = gemini_result.get("rock_type", "Unknown")
            
        # Calculate final likelihood (if external models provided scores, we'd average them here)
        final_likelihood = gemini_result.get("gold_likelihood", 0)
        
        # 3. Final Output
        return {
            "status": "success",
            "fused_results": {
                "rock_type": final_rock_type,
                "indicators": list(all_features),
                "gold_likelihood": final_likelihood,
                "reasoning": gemini_result.get("reasoning", "Analysis complete."),
                "sources_used": [k for k, v in weights.items() if v > 0]
            }
        }

# ==========================================
# 5. Example Usage (API Ready)
# ==========================================
if __name__ == "__main__":
    # This simulates a FastAPI endpoint receiving an image
    
    API_KEY = os.environ.get("GEMINI_API_KEY", "YOUR_API_KEY")
    analyzer = GeologicalAnalyzerService(gemini_api_key=API_KEY)
    
    # Simulated image bytes (replace with actual file read)
    # with open("sample_rock.jpg", "rb") as f:
    #     image_bytes = f.read()
    dummy_image_bytes = b"dummy_image_data" 
    
    print("Starting analysis (Simulated)...")
    # result = analyzer.analyze_sample(dummy_image_bytes)
    # print(json.dumps(result, indent=2, ensure_ascii=False))
    print("Modular architecture ready. See code for implementation details.")
