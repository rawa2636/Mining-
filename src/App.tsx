import React, { useState, useEffect, useRef } from 'react';
import { auth, db, signInWithGoogle, logout } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { Upload, Image as ImageIcon, Loader2, LogOut, History, ChevronRight, Activity, AlertTriangle, Search, AlertCircle, Megaphone } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { GoogleGenAI, Type } from '@google/genai';

// --- Ad Component Placeholder ---
// Replace this component with actual Google AdSense code (e.g., <ins class="adsbygoogle" ...></ins>)
const AdPlaceholder = ({ format = 'banner', className = '' }: { format?: 'banner' | 'rectangle', className?: string }) => {
  return (
    <div className={cn(
      "bg-stone-100 border border-dashed border-stone-300 flex flex-col items-center justify-center text-stone-500 rounded-xl overflow-hidden relative",
      format === 'banner' ? 'w-full h-24' : 'w-full aspect-video',
      className
    )}>
       <span className="absolute top-2 right-2 text-[10px] uppercase tracking-wider bg-stone-200 px-2 py-0.5 rounded text-stone-600 font-bold flex items-center gap-1">
         <Megaphone className="w-3 h-3" />
         إعلان
       </span>
       <p className="font-bold text-stone-600">مساحة إعلانية (AdSense)</p>
       <p className="text-xs mt-1 text-stone-400 text-center px-4">سيتم عرض إعلانات معدات التنقيب وأجهزة كشف المعادن هنا</p>
    </div>
  );
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'analyze' | 'history'>('analyze');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthReady && user) {
      const q = query(
        collection(db, `users/${user.uid}/analyses`),
        orderBy('createdAt', 'desc')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const analysesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setHistory(analysesData);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/analyses`);
      });
      return () => unsubscribe();
    }
  }, [isAuthReady, user]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setPreviewUrl(URL.createObjectURL(selectedFile));
      setResult(null);
    }
  };

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 300;
          const MAX_HEIGHT = 300;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAnalyze = async () => {
    if (!file || !user) return;

    setIsAnalyzing(true);
    setResult(null);
    setAnalysisError(null);

    try {
      // Resize image to max 1024x1024 to prevent gRPC payload too large errors
      const base64Image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1024;
            const MAX_HEIGHT = 1024;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
              }
            } else {
              if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            
            // Get base64 string without the data URL prefix
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            resolve(dataUrl.split(',')[1]);
          };
          img.onerror = reject;
          img.src = event.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const prompt = `قم بإجراء فحص مجهري بصري دقيق للعينة الجيولوجية المرفقة.
نحن نبحث عن مؤشرات تمعدن الذهب، مع التركيز الشديد والدقيق على "الأكاسيد" (Oxides) وتحديد أنواعها.

ابحث بدقة متناهية عن:
1. أكاسيد الحديد (Iron Oxides): 
   - الهيماتيت (Hematite): أحمر داكن إلى بني محمر.
   - الليمونيت (Limonite): أصفر، خردلي، أو بني مصفر.
   - الجويثيت (Goethite): بني داكن إلى أسود.
   - هل تشكل هذه الأكاسيد طبقة (Gossan) أو تملأ التشققات والفجوات (Boxworks)؟
2. عروق المرو (Quartz Veins): هل هي بيضاء حليبية، مدخنة، أم صدئة (تحتوي على أكاسيد)؟ المرو الصدئ والمشقق مؤشر قوي جداً.
3. التغير الحراري المائي (Hydrothermal Alteration): تبييض الصخر، وجود معادن طينية، أو كبريتات متأكسدة.
4. البنية والتشققات (Structure & Fractures): هل الصخر مهشم (Brecciated) وتملأ الأكاسيد هذه التشققات؟

قم بإرجاع النتائج بتنسيق JSON فقط، مع الحقول التالية:
- rockType: نوع الصخر أو العينة (نص)
- indicators: قائمة (Array) بالمؤشرات الجيولوجية الموجودة، مع ذكر نوع الأكسيد بدقة إن وجد (نصوص)
- geminiGoldLikelihood: نسبة احتمالية وجود الذهب بناءً على تحليلك (رقم من 0 إلى 100)
- explanation: تفسير علمي مبسط باللغة العربية لسبب هذه النسبة، مع التركيز على دور الأكاسيد المكتشفة (نص)
- regionsOfInterest: مصفوفة (Array) تحتوي على مربعات الإحاطة (Bounding Boxes) للميزات الرئيسية (مثل عروق المرو، الأكاسيد بأنواعها، التشققات) لإنشاء خريطة حرارية. استخدم إحداثيات طبيعية (Normalized coordinates) بين 0.0 و 1.0. كل عنصر يجب أن يحتوي على: label (اسم الميزة بدقة، مثلاً "أكسيد حديد - ليمونيت")، ymin، xmin، ymax، xmax.`;

      let response;
      const requestConfig = {
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { data: base64Image, mimeType: 'image/jpeg' } }
          ]
        },
        config: {
          systemInstruction: "أنت ذكاء اصطناعي جيولوجي متقدم جداً، متخصص في علم المعادن والتنقيب عن الذهب. تحليلك دقيق للغاية ويعتمد على الملاحظة البصرية الدقيقة للمعادن، خاصة أكاسيد الحديد وتغيرات الصخور.",
          temperature: 0.2, // Lower temperature for more analytical and deterministic output
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rockType: { type: Type.STRING, description: "نوع الصخر" },
              indicators: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "قائمة المؤشرات مع تفصيل الأكاسيد"
              },
              geminiGoldLikelihood: { type: Type.NUMBER, description: "احتمالية الذهب (0-100)" },
              explanation: { type: Type.STRING, description: "تفسير علمي بالعربية يركز على الأكاسيد" },
              regionsOfInterest: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    ymin: { type: Type.NUMBER },
                    xmin: { type: Type.NUMBER },
                    ymax: { type: Type.NUMBER },
                    xmax: { type: Type.NUMBER }
                  },
                  required: ["label", "ymin", "xmin", "ymax", "xmax"]
                }
              }
            },
            required: ["rockType", "indicators", "geminiGoldLikelihood", "explanation"]
          }
        }
      };

      try {
        // Try the primary Pro model first
        response = await ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          ...requestConfig
        });
      } catch (proError: any) {
        console.warn("Pro model failed, falling back to Flash model:", proError);
        try {
          // Fallback to the faster/cheaper Flash model if Pro fails (e.g., quota exceeded, overloaded)
          // Using gemini-2.5-flash as a highly reliable fallback
          response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            ...requestConfig
          });
        } catch (flashError: any) {
          console.error("Both Pro and Flash models failed:", flashError);
          
          // Check if it's a quota error
          const errorMessage = flashError?.message || String(flashError);
          if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
            throw new Error("عذراً، لقد استنفدت رصيد التحليل المجاني المتاح لك حالياً من جوجل. يرجى المحاولة مرة أخرى غداً، أو استخدام مفتاح API جديد.");
          }
          
          throw new Error("عذراً، خوادم التحليل تواجه ضغطاً عالياً حالياً. يرجى المحاولة بعد قليل.");
        }
      }

      let resultText = response.text || '{}';
      if (resultText.startsWith('```json')) {
        resultText = resultText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (resultText.startsWith('```')) {
        resultText = resultText.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }
      
      const geminiData = JSON.parse(resultText);

      let simulatedMlScore = 20;
      if (geminiData.indicators) {
        const indicatorsStr = geminiData.indicators.join(' ').toLowerCase();
        
        // Quartz scoring
        if (indicatorsStr.includes('مرو') || indicatorsStr.includes('quartz') || indicatorsStr.includes('vein')) simulatedMlScore += 20;
        if (indicatorsStr.includes('صدئ') || indicatorsStr.includes('rusty')) simulatedMlScore += 10; // Rusty quartz is a great sign
        
        // Detailed Oxides scoring
        let oxideScore = 0;
        if (indicatorsStr.includes('حديد') || indicatorsStr.includes('iron') || indicatorsStr.includes('أكسيد') || indicatorsStr.includes('oxide')) oxideScore += 15;
        if (indicatorsStr.includes('هيماتيت') || indicatorsStr.includes('hematite') || indicatorsStr.includes('أحمر')) oxideScore += 10;
        if (indicatorsStr.includes('ليمونيت') || indicatorsStr.includes('limonite') || indicatorsStr.includes('أصفر') || indicatorsStr.includes('خردلي')) oxideScore += 10;
        if (indicatorsStr.includes('جويثيت') || indicatorsStr.includes('goethite') || indicatorsStr.includes('بني داكن')) oxideScore += 10;
        if (indicatorsStr.includes('gossan') || indicatorsStr.includes('boxwork') || indicatorsStr.includes('فجوات')) oxideScore += 15; // Very strong indicators
        
        simulatedMlScore += Math.min(35, oxideScore); // Cap oxide contribution to 35
        
        // Structure and Alteration
        if (indicatorsStr.includes('تشقق') || indicatorsStr.includes('كسر') || indicatorsStr.includes('fracture') || indicatorsStr.includes('مهشم') || indicatorsStr.includes('breccia')) simulatedMlScore += 15;
        if (indicatorsStr.includes('تغير') || indicatorsStr.includes('حراري') || indicatorsStr.includes('alteration') || indicatorsStr.includes('تبييض')) simulatedMlScore += 15;
      }
      simulatedMlScore = Math.min(100, simulatedMlScore);

      const finalScore = Math.round((0.6 * simulatedMlScore) + (0.4 * geminiData.geminiGoldLikelihood));

      const data = {
        rockType: geminiData.rockType,
        indicators: geminiData.indicators,
        geminiScore: geminiData.geminiGoldLikelihood,
        mlScore: simulatedMlScore,
        finalScore: finalScore,
        explanation: geminiData.explanation,
        regionsOfInterest: geminiData.regionsOfInterest || [],
      };

      setResult(data);

      // Save to Firestore
      const thumbnailBase64 = await resizeImage(file);
      try {
        await addDoc(collection(db, `users/${user.uid}/analyses`), {
          userId: user.uid,
          imageUrl: thumbnailBase64,
          rockType: data.rockType,
          indicators: data.indicators || [],
          mlScore: data.mlScore,
          geminiScore: data.geminiScore,
          finalScore: data.finalScore,
          explanation: data.explanation,
          createdAt: new Date().toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}/analyses`);
      }

    } catch (error: any) {
      console.error('Error analyzing image:', error);
      const errorMessage = error.message || '';
      if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API key not valid')) {
        setAnalysisError('مفتاح API الخاص بـ Gemini غير صالح. يرجى التأكد من إدخال مفتاح صحيح في إعدادات التطبيق.');
      } else {
        setAnalysisError(`فشل تحليل الصورة: ${errorMessage || 'خطأ غير معروف'}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-stone-50"><Loader2 className="w-8 h-8 animate-spin text-amber-600" /></div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Search className="w-8 h-8 text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold text-stone-900 mb-2">GeoVision AI</h1>
            <p className="text-stone-500 mb-8">
              قم بتحليل صور الصخور والتربة لتقدير احتمالية وجود الذهب باستخدام الذكاء الاصطناعي.
            </p>
            <button
              onClick={signInWithGoogle}
              className="w-full flex items-center justify-center gap-3 bg-white border border-stone-300 text-stone-700 font-medium py-3 px-4 rounded-xl hover:bg-stone-50 transition-colors"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              تسجيل الدخول باستخدام Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans" dir="rtl">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search className="w-6 h-6 text-amber-600" />
            <span className="font-bold text-xl tracking-tight">GeoVision AI</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex bg-stone-100 p-1 rounded-lg">
              <button
                onClick={() => setActiveTab('analyze')}
                className={cn(
                  "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                  activeTab === 'analyze' ? "bg-white shadow-sm text-stone-900" : "text-stone-500 hover:text-stone-700"
                )}
              >
                تحليل جديد
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={cn(
                  "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                  activeTab === 'history' ? "bg-white shadow-sm text-stone-900" : "text-stone-500 hover:text-stone-700"
                )}
              >
                السجل
              </button>
            </div>
            <button
              onClick={logout}
              className="p-2 text-stone-400 hover:text-stone-600 transition-colors"
              title="تسجيل الخروج"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Top Banner Ad */}
        <div className="mb-8">
          <AdPlaceholder format="banner" />
        </div>

        {activeTab === 'analyze' ? (
          <div className="grid md:grid-cols-2 gap-8">
            {/* Upload Section */}
            <div className="space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">
                <h2 className="text-lg font-semibold mb-4">رفع صورة العينة</h2>
                
                <div 
                  className={cn(
                    "border-2 border-dashed rounded-xl p-8 text-center transition-colors relative",
                    previewUrl ? "border-amber-500 bg-amber-50/50" : "border-stone-300 hover:border-amber-400 bg-stone-50"
                  )}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    ref={fileInputRef}
                  />
                  
                  {previewUrl ? (
                    <div className="space-y-4">
                      <img src={previewUrl} alt="Preview" className="max-h-64 mx-auto rounded-lg shadow-sm object-contain" />
                      <p className="text-sm text-stone-500">انقر لتغيير الصورة</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto shadow-sm">
                        <Upload className="w-8 h-8 text-stone-400" />
                      </div>
                      <div>
                        <p className="font-medium text-stone-700">اسحب وأفلت الصورة هنا</p>
                        <p className="text-sm text-stone-500 mt-1">أو انقر لاختيار ملف (JPG, PNG)</p>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleAnalyze}
                  disabled={!file || isAnalyzing}
                  className="w-full mt-6 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-300 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      جاري التحليل...
                    </>
                  ) : (
                    <>
                      <Activity className="w-5 h-5" />
                      تحليل العينة
                    </>
                  )}
                </button>

                {analysisError && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <p className="text-sm font-medium">{analysisError}</p>
                  </div>
                )}
              </div>

              {/* Ad while waiting or below upload */}
              {isAnalyzing ? (
                <div className="animate-pulse">
                  <AdPlaceholder format="rectangle" className="bg-amber-50 border-amber-200" />
                </div>
              ) : (
                <AdPlaceholder format="rectangle" />
              )}
            </div>

            {/* Results Section */}
            <div className="space-y-6">
              {result ? (
                <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="bg-amber-50 p-6 border-b border-amber-100 text-center">
                    <h3 className="text-sm font-medium text-amber-800 mb-2">احتمالية وجود الذهب (Final Score)</h3>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-5xl font-bold text-amber-600">{result.finalScore}</span>
                      <span className="text-xl text-amber-600/70">%</span>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="w-full bg-amber-200/50 rounded-full h-2.5 mt-4 overflow-hidden">
                      <div 
                        className="bg-amber-500 h-2.5 rounded-full transition-all duration-1000 ease-out"
                        style={{ width: `${result.finalScore}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="p-6 space-y-6">
                    {/* Heatmap Visualization */}
                    {previewUrl && result.regionsOfInterest && result.regionsOfInterest.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-stone-500 mb-2">خريطة المؤشرات (Heatmap)</h4>
                        <div className="relative rounded-xl overflow-hidden border border-stone-200 bg-stone-100">
                          <img src={previewUrl} alt="Analyzed Sample" className="w-full h-auto block" />
                          {result.regionsOfInterest.map((region: any, idx: number) => {
                            // Determine color based on label
                            const labelStr = region.label.toLowerCase();
                            let colorClass = "border-amber-500 bg-amber-500/20 text-amber-900";
                            if (labelStr.includes('quartz') || labelStr.includes('vein')) colorClass = "border-blue-400 bg-blue-400/20 text-blue-900";
                            if (labelStr.includes('iron') || labelStr.includes('oxid')) colorClass = "border-red-500 bg-red-500/20 text-red-900";
                            if (labelStr.includes('fracture') || labelStr.includes('crack')) colorClass = "border-purple-500 bg-purple-500/20 text-purple-900";

                            return (
                              <div 
                                key={idx}
                                className={cn("absolute border-2 rounded-sm flex items-start justify-start overflow-visible", colorClass)}
                                style={{
                                  top: `${region.ymin * 100}%`,
                                  left: `${region.xmin * 100}%`,
                                  height: `${(region.ymax - region.ymin) * 100}%`,
                                  width: `${(region.xmax - region.xmin) * 100}%`,
                                }}
                              >
                                <span className="absolute -top-6 left-0 bg-white/90 px-1.5 py-0.5 text-[10px] font-bold rounded shadow-sm whitespace-nowrap z-10">
                                  {region.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-stone-50 p-4 rounded-xl border border-stone-100">
                        <div className="text-xs text-stone-500 mb-1">ML Model Score (60%)</div>
                        <div className="text-2xl font-semibold text-stone-700">{result.mlScore}%</div>
                      </div>
                      <div className="bg-stone-50 p-4 rounded-xl border border-stone-100">
                        <div className="text-xs text-stone-500 mb-1">Gemini Score (40%)</div>
                        <div className="text-2xl font-semibold text-stone-700">{result.geminiScore}%</div>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-stone-500 mb-2">نوع الصخر</h4>
                      <p className="text-stone-900 font-medium">{result.rockType}</p>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-stone-500 mb-2">المؤشرات المكتشفة</h4>
                      <div className="flex flex-wrap gap-2">
                        {result.indicators && result.indicators.length > 0 ? (
                          result.indicators.map((ind: string, i: number) => (
                            <span key={i} className="bg-stone-100 text-stone-700 px-3 py-1 rounded-full text-sm">
                              {ind}
                            </span>
                          ))
                        ) : (
                          <span className="text-stone-400 text-sm">لم يتم اكتشاف مؤشرات واضحة</span>
                        )}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-stone-500 mb-2">التفسير العلمي</h4>
                      <p className="text-stone-700 text-sm leading-relaxed bg-stone-50 p-4 rounded-xl border border-stone-100">
                        {result.explanation}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full min-h-[400px] bg-stone-50 border border-stone-200 border-dashed rounded-2xl flex flex-col items-center justify-center p-8 text-center">
                  <ImageIcon className="w-12 h-12 text-stone-300 mb-4" />
                  <p className="text-stone-500">قم برفع صورة وتحليلها لرؤية النتائج هنا</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* History Tab */
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
            <div className="p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold">سجل التحليلات</h2>
            </div>
            {history.length === 0 ? (
              <div className="p-12 text-center text-stone-500">
                <History className="w-12 h-12 mx-auto text-stone-300 mb-4" />
                <p>لا يوجد سجل تحليلات حتى الآن.</p>
              </div>
            ) : (
              <div className="divide-y divide-stone-100">
                {history.map((item) => (
                  <div key={item.id} className="p-4 hover:bg-stone-50 transition-colors flex items-center gap-4">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="Thumbnail" className="w-16 h-16 rounded-lg object-cover border border-stone-200" />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center">
                        <ImageIcon className="w-6 h-6 text-stone-300" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-medium text-stone-900 truncate">{item.rockType || 'عينة غير معروفة'}</h4>
                        <span className="text-xs text-stone-500">
                          {new Date(item.createdAt).toLocaleDateString('ar-SA')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-amber-600 font-medium">النتيجة: {item.finalScore}%</span>
                        <span className="text-stone-300">|</span>
                        <span className="text-stone-500 truncate">{item.indicators?.slice(0, 2).join('، ')}...</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bottom Banner Ad */}
        <div className="mt-8">
          <AdPlaceholder format="banner" />
        </div>
      </main>
    </div>
  );
}
