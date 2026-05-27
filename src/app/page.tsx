'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  Upload, 
  Video, 
  Sparkles, 
  Download, 
  Loader2,
  CheckCircle2,
  Circle,
  Edit3,
  Play,
  X,
  Plus,
  Camera,
  Eraser,
  Film,
  Scissors
} from 'lucide-react';

interface GenerationStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface ScriptSegment {
  id: number;
  script: string;
  prompt: string;
  duration: number;
}

interface Subtitle {
  start: number;
  end: number;
  text: string;
}

// 材质选项
const MATERIAL_OPTIONS = [
  '304不锈钢', '316不锈钢', '玻璃', 'PP塑料', 'ABS塑料', 
  '硅胶', '陶瓷', '铝合金', '铜', '实木', '竹材', '皮革'
];

// 特点选项
const FEATURE_OPTIONS = [
  '便携轻便', '美观时尚', '防水防尘', '保温保冷', '易清洗',
  '耐磨耐用', '环保健康', '智能科技', '多功能', '折叠收纳',
  '防滑设计', '静音降噪'
];

export default function Home() {
  // 商品信息
  const [productName, setProductName] = useState('');
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productImagePreview, setProductImagePreview] = useState<string>('');
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string>('');
  const [isIdentifyingImage, setIsIdentifyingImage] = useState(false);
  const [identifiedProduct, setIdentifiedProduct] = useState<string>('');
  const [showCropper, setShowCropper] = useState(false);
  
  // 核心卖点 - 结构化
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [customSellingPoints, setCustomSellingPoints] = useState<string[]>([]);
  const [customPointInput, setCustomPointInput] = useState('');
  
  // AI建议的卖点
  const [aiSuggestedPoints, setAiSuggestedPoints] = useState<string[]>([]);
  
  // 文案生成状态
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptSteps, setScriptSteps] = useState<GenerationStep[]>([
    { id: 'identify', title: 'AI识别商品图片信息', status: 'pending' },
    { id: 'script', title: '自动生成抖音带货口播文案（分段）', status: 'pending' },
    { id: 'prompt', title: '生成火山引擎专用视频Prompt（每段3-6秒）', status: 'pending' },
  ]);
  
  // 分段文案数据
  const [scriptSegments, setScriptSegments] = useState<ScriptSegment[]>([]);
  const [totalSegments, setTotalSegments] = useState(0);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(-1);
  
  // 视频生成状态
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoSteps, setVideoSteps] = useState<GenerationStep[]>([
    { id: 'segments', title: '调用火山引擎图生视频API（分段生成）', status: 'pending' },
    { id: 'concat', title: '拼接视频片段并添加转场', status: 'pending' },
    { id: 'subtitle', title: '生成字幕并同步播放', status: 'pending' },
  ]);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState<string>('');
  const [showSubtitleEditor, setShowSubtitleEditor] = useState(false);
  
  // 视频分段进度
  const [segmentProgress, setSegmentProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // 获取所有卖点
  const getAllSellingPoints = useCallback(() => {
    const points: string[] = [];
    if (selectedMaterials.length > 0) {
      points.push(`材质：${selectedMaterials.join('、')}`);
    }
    if (selectedFeatures.length > 0) {
      points.push(`特点：${selectedFeatures.join('、')}`);
    }
    if (customSellingPoints.length > 0) {
      points.push(...customSellingPoints);
    }
    return points.join('；');
  }, [selectedMaterials, selectedFeatures, customSellingPoints]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProductImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProductImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      
      // 自动识别商品
      await identifyProduct(file);
    }
  };

  // AI识别商品
  const identifyProduct = async (file: File) => {
    setIsIdentifyingImage(true);
    setIdentifiedProduct('');
    setAiSuggestedPoints([]);
    
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/identify-product', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('识别失败');
      }

      const result = await response.json();
      
      if (result.productName && !productName) {
        setProductName(result.productName);
      }
      
      if (result.productType) {
        setIdentifiedProduct(result.productType);
      }
      
      if (result.suggestedPoints && result.suggestedPoints.length > 0) {
        setAiSuggestedPoints(result.suggestedPoints);
      }
      
      if (result.suggestedMaterials && result.suggestedMaterials.length > 0) {
        setSelectedMaterials(prev => [...new Set([...prev, ...result.suggestedMaterials])]);
      }
      
      if (result.suggestedFeatures && result.suggestedFeatures.length > 0) {
        setSelectedFeatures(prev => [...new Set([...prev, ...result.suggestedFeatures])]);
      }
    } catch (error) {
      console.error('识别失败:', error);
    } finally {
      setIsIdentifyingImage(false);
    }
  };

  // 切换材质选择
  const toggleMaterial = (material: string) => {
    setSelectedMaterials(prev => 
      prev.includes(material) 
        ? prev.filter(m => m !== material)
        : [...prev, material]
    );
  };

  // 切换特点选择
  const toggleFeature = (feature: string) => {
    setSelectedFeatures(prev => 
      prev.includes(feature) 
        ? prev.filter(f => f !== feature)
        : [...prev, feature]
    );
  };

  // 添加自定义卖点
  const addCustomPoint = () => {
    if (customPointInput.trim()) {
      setCustomSellingPoints(prev => [...prev, customPointInput.trim()]);
      setCustomPointInput('');
    }
  };

  // 删除自定义卖点
  const removeCustomPoint = (index: number) => {
    setCustomSellingPoints(prev => prev.filter((_, i) => i !== index));
  };

  // 添加AI建议的卖点
  const addAiSuggestedPoint = (point: string) => {
    if (!customSellingPoints.includes(point)) {
      setCustomSellingPoints(prev => [...prev, point]);
    }
    setAiSuggestedPoints(prev => prev.filter(p => p !== point));
  };

  const updateStepStatus = (steps: GenerationStep[], stepId: string, status: GenerationStep['status']) => {
    return steps.map(step => 
      step.id === stepId ? { ...step, status } : step
    );
  };

  // 更新分段文案
  const updateSegment = (index: number, field: 'script' | 'prompt', value: string) => {
    setScriptSegments(prev => prev.map((seg, i) => 
      i === index ? { ...seg, [field]: value } : seg
    ));
  };

  // 生成带货文案
  const handleGenerateScript = async () => {
    if (!productName.trim()) {
      alert('请填写商品名称');
      return;
    }

    const sellingPoints = getAllSellingPoints();
    if (!sellingPoints) {
      alert('请选择或输入至少一个核心卖点');
      return;
    }

    setIsGeneratingScript(true);
    setScriptSegments([]);
    setVideoUrl('');
    setSubtitles([]);
    setTotalSegments(0);
    setCurrentSegmentIndex(-1);
    
    // Reset steps
    setScriptSteps([
      { id: 'identify', title: 'AI识别商品图片信息', status: 'pending' },
      { id: 'script', title: '自动生成抖音带货口播文案（分段）', status: 'pending' },
      { id: 'prompt', title: '生成火山引擎专用视频Prompt（每段3-6秒）', status: 'pending' },
    ]);

    try {
      const formData = new FormData();
      formData.append('productName', productName);
      formData.append('productSellingPoints', sellingPoints);
      if (productImage) {
        formData.append('productImage', productImage);
      }

      const response = await fetch('/api/generate-script', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('生成失败');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应');
      }

      let buffer = '';
      const tempSegments: ScriptSegment[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'identify') {
                setScriptSteps(prev => updateStepStatus(prev, 'identify', 'completed'));
                setScriptSteps(prev => updateStepStatus(prev, 'script', 'in_progress'));
              } else if (parsed.type === 'script_start') {
                setTotalSegments(parsed.segmentIndex);
              } else if (parsed.type === 'script_segment') {
                const seg = parsed.content as ScriptSegment;
                tempSegments.push(seg);
                setScriptSegments([...tempSegments]);
                setCurrentSegmentIndex(parsed.segmentIndex);
              } else if (parsed.type === 'prompt_segment') {
                const seg = parsed.content as ScriptSegment;
                const index = tempSegments.findIndex(s => s.id === seg.id);
                if (index >= 0) {
                  tempSegments[index] = seg;
                  setScriptSegments([...tempSegments]);
                }
                setCurrentSegmentIndex(parsed.segmentIndex);
                if (parsed.segmentIndex === totalSegments - 1) {
                  setScriptSteps(prev => updateStepStatus(prev, 'script', 'completed'));
                  setScriptSteps(prev => updateStepStatus(prev, 'prompt', 'in_progress'));
                }
              } else if (parsed.type === 'done') {
                setScriptSteps(prev => updateStepStatus(prev, 'prompt', 'completed'));
                const doneData = JSON.parse(parsed.content);
                if (doneData.imageUrl) {
                  setUploadedImageUrl(doneData.imageUrl);
                }
              } else if (parsed.type === 'error') {
                throw new Error(parsed.content);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('生成失败:', error);
      alert(error instanceof Error ? error.message : '生成失败，请重试');
    } finally {
      setIsGeneratingScript(false);
      setCurrentSegmentIndex(-1);
    }
  };

  // 生成带货视频
  const handleGenerateVideo = async () => {
    if (scriptSegments.length === 0) {
      alert('请先生成文案');
      return;
    }

    setIsGeneratingVideo(true);
    setVideoUrl('');
    setSubtitles([]);
    setSegmentProgress({ current: 0, total: 0 });
    
    // Reset steps
    setVideoSteps([
      { id: 'segments', title: '调用火山引擎图生视频API（分段生成）', status: 'pending' },
      { id: 'concat', title: '拼接视频片段并添加转场', status: 'pending' },
      { id: 'subtitle', title: '生成字幕并同步播放', status: 'pending' },
    ]);

    try {
      const formData = new FormData();
      formData.append('productName', productName);
      formData.append('segments', JSON.stringify(scriptSegments));
      if (uploadedImageUrl) {
        formData.append('imageUrl', uploadedImageUrl);
      } else if (productImage) {
        formData.append('productImage', productImage);
      }

      const response = await fetch('/api/generate-video', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('生成失败');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'segment_start') {
                setVideoSteps(prev => updateStepStatus(prev, 'segments', 'in_progress'));
                setSegmentProgress({ current: (parsed.segmentId || 0) + 1, total: scriptSegments.length });
              } else if (parsed.type === 'segment_video') {
                // Segment video generated
              } else if (parsed.type === 'concat_start') {
                setVideoSteps(prev => updateStepStatus(prev, 'segments', 'completed'));
                setVideoSteps(prev => updateStepStatus(prev, 'concat', 'in_progress'));
              } else if (parsed.type === 'video_url') {
                setVideoSteps(prev => updateStepStatus(prev, 'concat', 'completed'));
                setVideoUrl(parsed.content);
                setVideoSteps(prev => updateStepStatus(prev, 'subtitle', 'in_progress'));
              } else if (parsed.type === 'subtitles') {
                setVideoSteps(prev => updateStepStatus(prev, 'subtitle', 'completed'));
                setSubtitles(parsed.content.subtitles);
              } else if (parsed.type === 'done') {
                // Done
              } else if (parsed.type === 'error') {
                throw new Error(parsed.content);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('生成失败:', error);
      alert(error instanceof Error ? error.message : '生成失败，请重试');
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  // 视频字幕同步
  useEffect(() => {
    const video = videoRef.current;
    if (!video || subtitles.length === 0) return;

    const handleTimeUpdate = () => {
      const currentTime = video.currentTime;
      const currentSub = subtitles.find(
        sub => currentTime >= sub.start && currentTime <= sub.end
      );
      setCurrentSubtitle(currentSub?.text || '');
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [subtitles]);

  const handleDownload = async () => {
    if (!videoUrl) return;
    
    try {
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${productName}_带货视频.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('下载失败:', error);
      alert('下载失败，请重试');
    }
  };

  const scriptCompletedSteps = scriptSteps.filter(s => s.status === 'completed').length;
  const scriptProgress = (scriptCompletedSteps / scriptSteps.length) * 100;
  
  const videoCompletedSteps = videoSteps.filter(s => s.status === 'completed').length;
  const videoProgress = (videoCompletedSteps / videoSteps.length) * 100;

  const canGenerateVideo = scriptSegments.length > 0 && !isGeneratingScript && !isGeneratingVideo;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            🎬 AI商家带货视频生成Agent
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            一键生成专业带货短视频，让您的商品更具吸引力
          </p>
        </div>

        {/* Step 1: 商品信息输入 */}
        <Card className="mb-6 shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold">1</span>
              商品信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Product Name */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                📦 商品名称
              </label>
              <Input
                placeholder="请输入商品名称，如：智能保温杯"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                disabled={isGeneratingScript || isGeneratingVideo}
                className="border-gray-300 dark:border-gray-600"
              />
            </div>

            {/* Product Image Upload */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                📷 上传商品图片
              </label>
              <div className="space-y-3">
                <div className="flex gap-4 items-start">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isGeneratingScript || isGeneratingVideo}
                      className="flex items-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      选择图片
                    </Button>
                    {productImage && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowCropper(!showCropper)}
                        disabled={isGeneratingScript || isGeneratingVideo}
                        className="flex items-center gap-2"
                      >
                        <Eraser className="w-4 h-4" />
                        手动抠图
                      </Button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    disabled={isGeneratingScript || isGeneratingVideo}
                  />
                  {productImagePreview && (
                    <div className="relative">
                      <img
                        src={productImagePreview}
                        alt="商品预览"
                        className="w-32 h-32 object-cover rounded-lg border border-gray-300 dark:border-gray-600"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
                        onClick={() => {
                          setProductImage(null);
                          setProductImagePreview('');
                          setUploadedImageUrl('');
                          setIdentifiedProduct('');
                          setAiSuggestedPoints([]);
                        }}
                        disabled={isGeneratingScript || isGeneratingVideo}
                      >
                        ×
                      </Button>
                      {isIdentifyingImage && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
                          <Loader2 className="w-6 h-6 text-white animate-spin" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* AI识别结果 */}
                {identifiedProduct && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                      <Camera className="w-4 h-4" />
                      <span>AI识别商品：{identifiedProduct}</span>
                    </div>
                  </div>
                )}
                
                <p className="text-xs text-gray-500">支持高清商品实拍图，AI将自动识别商品主体并生成卖点建议</p>
              </div>
            </div>

            {/* 核心卖点 - 结构化输入 */}
            <div>
              <label className="block text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
                🔥 核心卖点
              </label>
              
              {/* 材质选择 */}
              <div className="mb-4">
                <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">材质</div>
                <div className="flex flex-wrap gap-2">
                  {MATERIAL_OPTIONS.map(material => (
                    <Badge
                      key={material}
                      variant={selectedMaterials.includes(material) ? "default" : "outline"}
                      className={`cursor-pointer transition-all ${
                        selectedMaterials.includes(material) 
                          ? 'bg-blue-600 hover:bg-blue-700' 
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      onClick={() => toggleMaterial(material)}
                    >
                      {material}
                    </Badge>
                  ))}
                </div>
              </div>
              
              {/* 特点选择 */}
              <div className="mb-4">
                <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">特点</div>
                <div className="flex flex-wrap gap-2">
                  {FEATURE_OPTIONS.map(feature => (
                    <Badge
                      key={feature}
                      variant={selectedFeatures.includes(feature) ? "default" : "outline"}
                      className={`cursor-pointer transition-all ${
                        selectedFeatures.includes(feature) 
                          ? 'bg-purple-600 hover:bg-purple-700' 
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      onClick={() => toggleFeature(feature)}
                    >
                      {feature}
                    </Badge>
                  ))}
                </div>
              </div>
              
              {/* AI建议的卖点 */}
              {aiSuggestedPoints.length > 0 && (
                <div className="mb-4 p-3 bg-gradient-to-r from-green-50 to-teal-50 dark:from-green-900/20 dark:to-teal-900/20 rounded-lg">
                  <div className="text-xs font-medium text-green-700 dark:text-green-300 mb-2">
                    ✨ AI建议卖点（点击添加）
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {aiSuggestedPoints.map((point, index) => (
                      <Badge
                        key={index}
                        variant="outline"
                        className="cursor-pointer bg-white dark:bg-gray-800 border-green-300 dark:border-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 text-green-700 dark:text-green-300"
                        onClick={() => addAiSuggestedPoint(point)}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        {point}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* 自定义卖点输入 */}
              <div className="mb-3">
                <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">其他卖点（自定义）</div>
                <div className="flex gap-2">
                  <Input
                    placeholder="输入其他卖点，如：支持无线充电"
                    value={customPointInput}
                    onChange={(e) => setCustomPointInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addCustomPoint()}
                    disabled={isGeneratingScript || isGeneratingVideo}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addCustomPoint}
                    disabled={!customPointInput.trim() || isGeneratingScript || isGeneratingVideo}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              {/* 已添加的自定义卖点 */}
              {customSellingPoints.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {customSellingPoints.map((point, index) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className="bg-gray-100 dark:bg-gray-700"
                    >
                      {point}
                      <X
                        className="w-3 h-3 ml-1 cursor-pointer"
                        onClick={() => removeCustomPoint(index)}
                      />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Generate Script Button */}
            <Button
              onClick={handleGenerateScript}
              disabled={isGeneratingScript || isGeneratingVideo || !productName.trim() || (!selectedMaterials.length && !selectedFeatures.length && !customSellingPoints.length)}
              className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg"
              size="lg"
            >
              {isGeneratingScript ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  文案生成中...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  生成带货文案
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Script Generation Progress */}
        {isGeneratingScript && (
          <Card className="mb-6 shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                🔄 文案生成中
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Progress value={scriptProgress} className="h-2" />
              </div>
              <div className="space-y-3">
                {scriptSteps.map((step) => (
                  <div key={step.id} className="flex items-center gap-3">
                    {step.status === 'completed' ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : step.status === 'in_progress' ? (
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                    ) : (
                      <Circle className="w-5 h-5 text-gray-400" />
                    )}
                    <span className="text-gray-700 dark:text-gray-300">{step.title}</span>
                  </div>
                ))}
              </div>
              
              {/* 分段进度 */}
              {currentSegmentIndex >= 0 && (
                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                    <Film className="w-4 h-4" />
                    <span>
                      正在生成第 {currentSegmentIndex + 1} 段 / 共 {totalSegments} 段
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Segmented Script Editor */}
        {scriptSegments.length > 0 && !isGeneratingScript && (
          <Card className="mb-6 shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-blue-600" />
                分段文案编辑
                <Badge variant="secondary" className="ml-2">
                  {scriptSegments.length} 段 · 总时长约 {scriptSegments.reduce((sum, s) => sum + s.duration, 0)} 秒
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {scriptSegments.map((segment, index) => (
                <div key={segment.id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="bg-blue-50 dark:bg-blue-900/20">
                      <Film className="w-3 h-3 mr-1" />
                      第 {index + 1} 段
                    </Badge>
                    <span className="text-xs text-gray-500">约 {segment.duration} 秒</span>
                  </div>
                  
                  {/* 口播文案 */}
                  <div>
                    <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">
                      🎤 口播文案
                    </label>
                    <Textarea
                      value={segment.script}
                      onChange={(e) => updateSegment(index, 'script', e.target.value)}
                      rows={2}
                      className="text-sm border-gray-300 dark:border-gray-600"
                      disabled={isGeneratingVideo}
                    />
                  </div>
                  
                  {/* 视频Prompt */}
                  <div>
                    <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">
                      🎥 视频镜头描述
                    </label>
                    <Textarea
                      value={segment.prompt}
                      onChange={(e) => updateSegment(index, 'prompt', e.target.value)}
                      rows={2}
                      className="text-sm border-gray-300 dark:border-gray-600"
                      disabled={isGeneratingVideo}
                    />
                  </div>
                </div>
              ))}

              {/* Generate Video Button */}
              <Button
                onClick={handleGenerateVideo}
                disabled={!canGenerateVideo}
                className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg"
                size="lg"
              >
                {isGeneratingVideo ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    视频生成中...
                  </>
                ) : (
                  <>
                    <Video className="w-5 h-5 mr-2" />
                    生成带货视频
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Video Generation Progress */}
        {isGeneratingVideo && (
          <Card className="mb-6 shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                🔄 视频生成中
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Progress value={videoProgress} className="h-2" />
              </div>
              <div className="space-y-3">
                {videoSteps.map((step) => (
                  <div key={step.id} className="flex items-center gap-3">
                    {step.status === 'completed' ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : step.status === 'in_progress' ? (
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                    ) : (
                      <Circle className="w-5 h-5 text-gray-400" />
                    )}
                    <span className="text-gray-700 dark:text-gray-300">{step.title}</span>
                  </div>
                ))}
              </div>
              
              {/* 分段生成进度 */}
              {segmentProgress.total > 0 && (
                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                    <Scissors className="w-4 h-4" />
                    <span>
                      正在生成第 {segmentProgress.current} 段视频 / 共 {segmentProgress.total} 段
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Video Result */}
        {videoUrl && (
          <Card className="shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="w-5 h-5 text-blue-600" />
                生成结果
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden mb-4">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="w-full h-full object-contain"
                  poster={productImagePreview}
                >
                  您的浏览器不支持视频播放
                </video>
                {/* Subtitle Overlay */}
                {currentSubtitle && (
                  <div className="absolute bottom-12 left-0 right-0 flex justify-center pointer-events-none">
                    <div className="bg-black/70 text-white px-4 py-2 rounded-lg max-w-[80%] text-center">
                      {currentSubtitle}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex gap-2">
                <Button
                  onClick={handleDownload}
                  className="flex-1 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
                  size="lg"
                >
                  <Download className="w-4 h-4 mr-2" />
                  下载视频
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowSubtitleEditor(!showSubtitleEditor)}
                  disabled={subtitles.length === 0}
                >
                  字幕 {subtitles.length > 0 && `(${subtitles.length}条)`}
                </Button>
              </div>

              {/* Subtitle List */}
              {showSubtitleEditor && subtitles.length > 0 && (
                <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg max-h-60 overflow-y-auto">
                  <h4 className="font-medium mb-2 text-sm">字幕列表</h4>
                  <div className="space-y-2">
                    {subtitles.map((sub, index) => (
                      <div key={index} className="flex items-center gap-2 text-sm">
                        <span className="text-gray-500 dark:text-gray-400 w-20">
                          {sub.start.toFixed(1)}s - {sub.end.toFixed(1)}s
                        </span>
                        <span className="text-gray-700 dark:text-gray-300">{sub.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
