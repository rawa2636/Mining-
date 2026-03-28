import os
import cv2
import numpy as np
import xgboost as xgb
import google.generativeai as genai
from skimage.feature import graycomatrix, graycoprops
import torch
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image

# ==========================================
# 1. Configuration & Setup
# ==========================================
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "YOUR_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)

# Load Pretrained Vision Model (ResNet50) for Deep Features
weights = models.ResNet50_Weights.DEFAULT
resnet = models.resnet50(weights=weights)
resnet.eval()
# Remove the final classification layer to get feature embeddings
feature_extractor = torch.nn.Sequential(*(list(resnet.children())[:-1]))

preprocess = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

# ==========================================
# 2. Feature Extraction Layer
# ==========================================
def extract_handcrafted_features(image_path):
    """Extracts color, texture, and edge features."""
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError("Image not found")
        
    # A. Color Histogram (Iron Oxidation - Red/Yellow hues)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hist_h = cv2.calcHist([hsv], [0], None, [16], [0, 180])
    hist_s = cv2.calcHist([hsv], [1], None, [16], [0, 256])
    color_features = np.concatenate([hist_h.flatten(), hist_s.flatten()])
    color_features = color_features / np.sum(color_features) # Normalize
    
    # B. Texture (GLCM)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Resize for faster GLCM calculation
    gray_small = cv2.resize(gray, (256, 256))
    glcm = graycomatrix(gray_small, distances=[1], angles=[0, np.pi/4, np.pi/2, 3*np.pi/4], levels=256, symmetric=True, normed=True)
    contrast = graycoprops(glcm, 'contrast').flatten()
    homogeneity = graycoprops(glcm, 'homogeneity').flatten()
    texture_features = np.concatenate([contrast, homogeneity])
    
    # C. Edge Density (Fractures / Veins)
    edges = cv2.Canny(gray, 100, 200)
    edge_density = np.sum(edges > 0) / edges.size
    
    return np.concatenate([color_features, texture_features, [edge_density]])

def extract_deep_features(image_path):
    """Extracts deep embeddings using ResNet50."""
    img = Image.open(image_path).convert('RGB')
    input_tensor = preprocess(img).unsqueeze(0)
    with torch.no_grad():
        features = feature_extractor(input_tensor)
    return features.flatten().numpy()

def get_combined_features(image_path):
    handcrafted = extract_handcrafted_features(image_path)
    deep = extract_deep_features(image_path)
    return np.concatenate([handcrafted, deep])

# ==========================================
# 3. Classification Model (ML)
# ==========================================
def get_ml_score(features):
    """
    Predicts gold likelihood using a trained XGBoost model.
    (Requires a pre-trained model 'xgboost_gold_model.json')
    """
    try:
        model = xgb.Booster()
        model.load_model('xgboost_gold_model.json')
        dmatrix = xgb.DMatrix([features])
        probability = model.predict(dmatrix)[0]
        return float(probability * 100)
    except xgb.core.XGBoostError:
        # Fallback simulated score if model file is missing
        print("Warning: 'xgboost_gold_model.json' not found. Using simulated ML score.")
        return 65.0

# ==========================================
# 4. Gemini Integration
# ==========================================
def get_gemini_analysis(image_path):
    """Uses Gemini Vision to analyze geological indicators."""
    img = Image.open(image_path)
    model = genai.GenerativeModel('gemini-3.1-pro-preview')
    
    prompt = """
    Analyze this geological sample image.
    Focus on:
    - Quartz veins
    - Iron oxide staining (red/yellow zones)
    - Fracture density
    - Signs of hydrothermal alteration

    Return a JSON object with:
    {
      "rockType": "string",
      "indicators": ["string", "string"],
      "goldLikelihood": number (0-100),
      "explanation": "Short scientific explanation"
    }
    """
    
    response = model.generate_content([prompt, img], generation_config={"response_mime_type": "application/json"})
    import json
    return json.loads(response.text)

# ==========================================
# 5. Fusion Logic & Pipeline Execution
# ==========================================
def analyze_sample(image_path):
    print(f"Analyzing {image_path}...")
    
    # Step 1 & 2: Feature Extraction
    print("Extracting features...")
    features = get_combined_features(image_path)
    
    # Step 3: ML Model Prediction
    print("Running ML Classification...")
    ml_score = get_ml_score(features)
    
    # Step 4: Gemini Analysis
    print("Running Gemini Vision Analysis...")
    gemini_data = get_gemini_analysis(image_path)
    gemini_score = gemini_data.get("goldLikelihood", 0)
    
    # Step 5: Fusion Logic
    # Final Score = 0.6 * ML Model Output + 0.4 * Gemini Geological Interpretation Score
    final_score = (0.6 * ml_score) + (0.4 * gemini_score)
    
    # Output Results
    print("\n" + "="*40)
    print("🔬 GEOVISION AI ANALYSIS REPORT")
    print("="*40)
    print(f"Rock Type: {gemini_data.get('rockType')}")
    print(f"Indicators Found: {', '.join(gemini_data.get('indicators', []))}")
    print("-" * 40)
    print(f"🤖 ML Model Score:      {ml_score:.2f}%")
    print(f"✨ Gemini Vision Score: {gemini_score:.2f}%")
    print(f"🎯 FINAL FUSED LIKELIHOOD: {final_score:.2f}%")
    print("-" * 40)
    print(f"Explanation:\n{gemini_data.get('explanation')}")
    print("="*40)
    
    return final_score

if __name__ == "__main__":
    # Example usage
    sample_image = "sample_rock.jpg"
    if os.path.exists(sample_image):
        analyze_sample(sample_image)
    else:
        print(f"Please place an image named '{sample_image}' in the directory to test.")
