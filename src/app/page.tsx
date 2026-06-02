'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
  Scissors,
  RefreshCw,
  Check
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

interface VideoSegment {
  id: number;
  script: string;
  prompt: string;
  audioUrl: string;
  audioLocalPath: string;
  audioDuration: number;
  videoUrl: string;
  videoLocalPath: string;
  videoDuration: number;
  isGenerating: boolean;
  isSelected: boolean;
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
  
  // 核心卖点 - 结构化
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [customSellingPoints, setCustomSellingPoints] = useState<string[]>([]);
  const [customPointInput, setCustomPointInput] = useState('');
  
  // AI建议的卖点
  const [aiSuggestedPoints, setAiSuggestedPoints] = useState<string[]>([]);


  // 文案生成状态
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptSegments, setScriptSegments] = useState<ScriptSegment[]>([]);
  const [scriptSteps, setScriptSteps] = useState<GenerationStep[]>([
    { id: 'identify', title: 'AI识别商品图片信息', status: 'pending' },
    { id: 'script', title: '自动生成抖音带货口播文案（分段）', status: 'pending' },
    { id: 'prompt', title: '生成火山引擎专用视频Prompt（每段3-6秒）', status: 'pending' },
  ]);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(-1);
  const [totalSegments, setTotalSegments] = useState(0);

  // 视频任务状态
  const [taskFolder, setTaskFolder] = useState<{ folderPath: string; folderName: string } | null>(null);
  const [videoSegments, setVideoSegments] = useState<VideoSegment[]>([]);
  const [isGeneratingSegments, setIsGeneratingSegments] = useState(false);
  const [segmentProgress, setSegmentProgress] = useState({ audio: 0, video: 0, total: 0 });

  // 最终视频状态
  const [isComposing, setIsComposing] = useState(false);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string>('');
  const [finalSubtitles, setFinalSubtitles] = useState<Subtitle[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 计算文案进度
  const scriptProgress = scriptSteps.reduce((sum, step) => {
    if (step.status === 'completed') return sum + 33.33;
    if (step.status === 'in_progress') return sum + 16.66;
    return sum;
  }, 0);

  // 更新步骤状态
  const updateStepStatus = (steps: GenerationStep[], stepId: string, status: GenerationStep['status']): GenerationStep[] => {
    return steps.map(step => step.id === stepId ? { ...step, status } : step);
  };

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

  // 处理图片上传
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
    if (customPointInput.trim() && !customSellingPoints.includes(customPointInput.trim())) {
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
    // 从建议列表中移除
    setAiSuggestedPoints(prev => prev.filter(p => p !== point));
  };

  // 更新文案段
  const updateSegment = (index: number, field: 'script' | 'prompt', value: string) => {
    setScriptSegments(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // 生成带货文案
  const handleGenerateScript = async () => {
    if (!productName.trim()) {
      alert('请输入商品名称');
      return;
    }

    const sellingPoints = getAllSellingPoints();
    if (!sellingPoints) {
      alert('请选择或输入至少一个核心卖点');
      return;
    }

    setIsGeneratingScript(true);
    setScriptSegments([]);
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
            } catch {
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

  // 初始化视频任务
  const handleGenerateVideo = async () => {
    if (scriptSegments.length === 0) {
      alert('请先生成文案');
      return;
    }

    setIsGeneratingSegments(true);
    setVideoSegments([]);
    setSegmentProgress({ audio: 0, video: 0, total: scriptSegments.length });
    setFinalVideoUrl('');
    setFinalSubtitles([]);

    try {
      // 1. 初始化任务，创建文件夹
      const initResponse = await fetch('/api/video-task/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          productName,
          segments: scriptSegments,
          imageUrl: uploadedImageUrl 
        }),
      });

      if (!initResponse.ok) {
        throw new Error('初始化任务失败');
      }

      const initData = await initResponse.json();
      setTaskFolder(initData);

      // 2. 并发生成所有视频片段
      const tempSegments: VideoSegment[] = [];
      let audioCount = 0;
      let videoCount = 0;

      const generatePromises = scriptSegments.map(async (segment, index) => {
        try {
          const response = await fetch('/api/video-task/generate-segment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              segmentId: segment.id,
              script: segment.script,
              prompt: segment.prompt || '',
              imageUrl: uploadedImageUrl,
              folderPath: initData.folderPath,
              productName: productName
            }),
          });

          if (!response.ok) {
            throw new Error(`片段 ${segment.id} 生成失败`);
          }

          const reader = response.body?.getReader();
          const decoder = new TextDecoder();

          if (!reader) {
            throw new Error('无法读取响应');
          }

          let buffer = '';
          let segmentData: VideoSegment | null = null;

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

                  if (parsed.type === 'tts_complete') {
                    audioCount++;
                    setSegmentProgress(prev => ({ ...prev, audio: audioCount }));
                  } else if (parsed.type === 'video_complete') {
                    videoCount++;
                    // video_complete 只包含视频信息，更新临时数据
                    segmentData = {
                      id: segment.id,
                      script: segment.script,
                      prompt: segment.prompt || '',
                      audioUrl: '',
                      audioLocalPath: '',
                      audioDuration: 0,
                      videoUrl: parsed.content.videoUrl || '',
                      videoLocalPath: parsed.content.videoLocalPath || '',
                      videoDuration: parsed.content.duration || 0,
                      isGenerating: false,
                      isSelected: true
                    };
                    setSegmentProgress(prev => ({ ...prev, video: videoCount }));
                  } else if (parsed.type === 'done') {
                    // done 事件包含完整的音频和视频信息
                    const audioInfo = parsed.content.audio;
                    const videoInfo = parsed.content.video;
                    console.log('收到 done 事件:', { segmentId: segment.id, audioInfo, videoInfo });
                    segmentData = {
                      id: segment.id,
                      script: segment.script,
                      prompt: segment.prompt || '',
                      audioUrl: audioInfo?.url || '',
                      audioLocalPath: audioInfo?.localPath || '',
                      audioDuration: audioInfo?.duration || 0,
                      videoUrl: videoInfo?.url || '',
                      videoLocalPath: videoInfo?.localPath || '',
                      videoDuration: videoInfo?.duration || 0,
                      isGenerating: false,
                      isSelected: true
                    };
                    console.log('片段数据已设置:', segmentData);
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }

          return segmentData;
        } catch (error) {
          console.error(`片段 ${segment.id} 生成错误:`, error);
          return null;
        }
      });

      const results = await Promise.all(generatePromises);

      // 过滤掉失败的结果并更新状态
      const validSegments = results.filter((s): s is VideoSegment => s !== null);
      setVideoSegments(validSegments);
    } catch (error) {
      console.error('生成失败:', error);
      alert(error instanceof Error ? error.message : '生成失败，请重试');
    } finally {
      setIsGeneratingSegments(false);
    }
  };

  // 切换片段选中状态
  const toggleSegmentSelection = (segmentId: number) => {
    setVideoSegments(prev => prev.map(seg => 
      seg.id === segmentId ? { ...seg, isSelected: !seg.isSelected } : seg
    ));
  };

  // 重新生成单个视频片段
  const handleRegenerateSegment = async (segmentId: number) => {
    const segment = videoSegments.find(s => s.id === segmentId);
    if (!segment) return;

    // 设置为生成中
    setVideoSegments(prev => prev.map(seg => 
      seg.id === segmentId ? { ...seg, isGenerating: true } : seg
    ));

    try {
      const response = await fetch('/api/video-task/generate-segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          taskId: `regenerate_${Date.now()}`,
          folder: taskFolder,
          segments: [{ 
            id: segment.id, 
            script: segment.script, 
            prompt: segment.prompt, 
            duration: segment.audioDuration 
          }],
          imageUrl: uploadedImageUrl,
          regenerateIndex: segmentId - 1
        }),
      });

      if (!response.ok) {
        throw new Error('重新生成失败');
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
              
              if (parsed.type === 'video_complete') {
                const content = parsed.content;
                // video_complete 只包含视频信息，先更新视频部分
                setVideoSegments(prev => prev.map(seg => 
                  seg.id === segmentId ? { 
                    ...seg, 
                    videoUrl: content.videoUrl || '',
                    videoLocalPath: content.videoLocalPath || '',
                    videoDuration: content.duration || 0,
                    isGenerating: false 
                  } : seg
                ));
              } else if (parsed.type === 'done') {
                // done 事件包含完整的音频和视频信息
                const audioInfo = parsed.content.audio;
                const videoInfo = parsed.content.video;
                setVideoSegments(prev => prev.map(seg => 
                  seg.id === segmentId ? { 
                    ...seg, 
                    videoUrl: videoInfo?.url || seg.videoUrl,
                    videoLocalPath: videoInfo?.localPath || seg.videoLocalPath,
                    videoDuration: videoInfo?.duration || seg.videoDuration,
                    audioUrl: audioInfo?.url || '',
                    audioLocalPath: audioInfo?.localPath || '',
                    audioDuration: audioInfo?.duration || 0,
                    isGenerating: false 
                  } : seg
                ));
              } else if (parsed.type === 'error') {
                throw new Error(parsed.content);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('重新生成失败:', error);
      alert(error instanceof Error ? error.message : '重新生成失败，请重试');
      // 恢复状态
      setVideoSegments(prev => prev.map(seg => 
        seg.id === segmentId ? { ...seg, isGenerating: false } : seg
      ));
    }
  };

  // 合成最终视频
  const handleComposeVideo = async () => {
    const selectedSegments = videoSegments.filter(seg => seg.isSelected);
    if (selectedSegments.length === 0) {
      alert('请至少选择一个视频片段');
      return;
    }

    // 处理片段数据，确保音频路径有效
    const processedSegments = selectedSegments.map(seg => {
      // 如果音频路径缺失，从视频路径推导
      let audioPath = seg.audioLocalPath;
      if (!audioPath && seg.videoLocalPath) {
        // 从视频路径推导音频路径
        // video/video_1_xxx.mp4 -> audio/audio_1_xxx.mp3
        const videoMatch = seg.videoLocalPath.match(/video_(\d+_\d+)\.mp4$/);
        if (videoMatch) {
          audioPath = seg.videoLocalPath
            .replace('/video/', '/audio/')
            .replace(/video_(\d+_\d+)\.mp4$/, 'audio_$1.mp3');
          console.log(`从视频路径推导音频路径: ${seg.videoLocalPath} -> ${audioPath}`);
        }
      }
      return {
        ...seg,
        audioLocalPath: audioPath
      };
    });

    // 检查音频文件是否存在（通过路径检查）
    const segmentsWithoutAudio = processedSegments.filter(seg => !seg.audioLocalPath);
    if (segmentsWithoutAudio.length > 0) {
      console.error('无效片段:', segmentsWithoutAudio);
      alert('部分视频片段缺少音频文件，请重新生成这些片段');
      return;
    }

    setIsComposing(true);
    setFinalVideoUrl('');
    setFinalSubtitles([]);

    try {
      const response = await fetch('/api/video-task/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          folderPath: taskFolder?.folderPath,
          segments: processedSegments.map(seg => ({
            audioPath: seg.audioLocalPath,
            videoPath: seg.videoLocalPath,
            script: seg.script,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('合成失败');
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
              
              if (parsed.type === 'complete') {
                console.log('合成完成:', parsed.content);
                setFinalVideoUrl(parsed.content.videoUrl);
                setFinalSubtitles(parsed.content.subtitles || []);
              } else if (parsed.type === 'error') {
                console.error('合成错误:', parsed.content);
                throw new Error(parsed.content);
              }
            } catch (parseError) {
              // 只有真正的解析错误才忽略
              if (parseError instanceof SyntaxError) {
                console.warn('JSON解析错误:', parseError);
              } else {
                // 重新抛出其他错误
                throw parseError;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('合成失败:', error);
      alert(error instanceof Error ? error.message : '合成失败，请重试');
    } finally {
      setIsComposing(false);
    }
  };

  // 下载视频
  const handleDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      // Fallback to proxy
      const proxyUrl = `/api/download-video?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
      window.open(proxyUrl, '_blank');
    }
  };

  // 是否可以生成视频
  const canGenerateVideo = scriptSegments.length > 0 && !isGeneratingSegments;

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            🎬 AI商家带货视频生成Agent
          </h1>
        </div>

        {/* Step 1: 商品信息 */}
        <Card className="mb-6 shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold">1</span>
              商品信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* 商品名称 */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                📦 商品名称
              </label>
              <Input
                placeholder="请输入商品名称，如：智能保温杯"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                disabled={isGeneratingScript || isGeneratingSegments}
                className="border-gray-300 dark:border-gray-600"
              />
            </div>

            {/* 上传商品图片 */}
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
                      disabled={isGeneratingScript || isGeneratingSegments}
                      className="flex items-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      选择图片
                    </Button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    disabled={isGeneratingScript || isGeneratingSegments}
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
                          setSelectedMaterials([]);
                          setSelectedFeatures([]);
                          setCustomSellingPoints([]);
                          setAiSuggestedPoints([]);
                        }}
                        disabled={isGeneratingScript || isGeneratingSegments}
                      >
                        <X className="w-3 h-3" />
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
          </CardContent>
        </Card>

        {/* 2. 核心卖点 */}
        <Card className="mb-6 shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold">2</span>
              🔥 核心卖点
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 材质选项 */}
            <div>
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
            
            {/* 特点选项 */}
            <div>
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
              <div className="p-3 bg-gradient-to-r from-green-50 to-teal-50 dark:from-green-900/20 dark:to-teal-900/20 rounded-lg">
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
            <div>
              <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">其他卖点（自定义）</div>
              <div className="flex gap-2">
                <Input
                  placeholder="输入其他卖点，如：支持无线充电"
                  value={customPointInput}
                  onChange={(e) => setCustomPointInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addCustomPoint()}
                  disabled={isGeneratingScript || isGeneratingSegments}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addCustomPoint}
                  disabled={!customPointInput.trim() || isGeneratingScript || isGeneratingSegments}
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

            {/* 生成带货文案按钮 */}
            <Button
              onClick={handleGenerateScript}
              disabled={isGeneratingScript || isGeneratingSegments || !productName.trim() || (!selectedMaterials.length && !selectedFeatures.length && !customSellingPoints.length)}
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

        {/* 文案生成进度 */}
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

        {/* 分段文案编辑 */}
        {scriptSegments.length > 0 && !isGeneratingScript && (
          <Card className="mb-6 shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-blue-600" />
                分段文案编辑
                <Badge variant="secondary" className="ml-2">
                  {scriptSegments.length} 段
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
                  
                  <div>
                    <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">
                      🎤 口播文案
                    </label>
                    <Textarea
                      value={segment.script}
                      onChange={(e) => updateSegment(index, 'script', e.target.value)}
                      rows={2}
                      className="text-sm border-gray-300 dark:border-gray-600"
                      disabled={isGeneratingSegments}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">
                      🎥 视频镜头描述
                    </label>
                    <Textarea
                      value={segment.prompt}
                      onChange={(e) => updateSegment(index, 'prompt', e.target.value)}
                      rows={2}
                      className="text-sm border-gray-300 dark:border-gray-600"
                      disabled={isGeneratingSegments}
                    />
                  </div>
                </div>
              ))}

              {/* 生成视频片段按钮 */}
              <Button
                onClick={handleGenerateVideo}
                disabled={!canGenerateVideo}
                className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg"
                size="lg"
              >
                {isGeneratingSegments ? (
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

        {/* 视频片段生成进度 */}
        {isGeneratingSegments && (
          <Card className="mb-6 shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                🔄 视频生成中
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span>配音生成</span>
                  <span>{segmentProgress.audio} / {segmentProgress.total}</span>
                </div>
                <Progress value={(segmentProgress.audio / segmentProgress.total) * 100} className="h-2" />
                
                <div className="flex items-center justify-between text-sm mt-4">
                  <span>视频生成</span>
                  <span>{segmentProgress.video} / {segmentProgress.total}</span>
                </div>
                <Progress value={(segmentProgress.video / segmentProgress.total) * 100} className="h-2" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* 视频片段展示 */}
        {videoSegments.length > 0 && !isGeneratingSegments && (
          <Card className="mb-6 shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Film className="w-5 h-5 text-blue-600" />
                视频片段
                <Badge variant="secondary" className="ml-2">
                  {videoSegments.filter(s => s.isSelected).length} / {videoSegments.length} 已选中
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {videoSegments.map((segment, index) => (
                <div key={segment.id} className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-700/30">
                  <div className="flex items-center gap-4 mb-3">
                    {/* 红色勾选框 */}
                    <Checkbox
                      checked={segment.isSelected}
                      onCheckedChange={() => toggleSegmentSelection(segment.id)}
                      className="w-6 h-6 data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600 border-2"
                    />
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">第 {index + 1} 段</Badge>
                        <span className="text-sm text-gray-500">{segment.videoDuration.toFixed(1)}秒</span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-1">
                        {segment.script}
                      </p>
                    </div>

                    {/* 重新生成按钮 - 红色大按钮 */}
                    <Button
                      variant="destructive"
                      size="lg"
                      onClick={() => handleRegenerateSegment(segment.id)}
                      disabled={segment.isGenerating}
                      className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3"
                    >
                      {segment.isGenerating ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          生成中...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-5 h-5" />
                          重新生成视频
                        </>
                      )}
                    </Button>
                  </div>

                  {/* 视频播放器 */}
                  <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                    <video
                      src={segment.videoUrl}
                      controls
                      className="w-full h-full object-contain"
                      poster={productImagePreview}
                    >
                      您的浏览器不支持视频播放
                    </video>
                  </div>
                </div>
              ))}

              {/* 合成最终视频按钮 */}
              <Button
                onClick={handleComposeVideo}
                disabled={videoSegments.filter(s => s.isSelected).length === 0 || isComposing}
                className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 transition-all shadow-lg"
                size="lg"
              >
                {isComposing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    合成中...
                  </>
                ) : (
                  <>
                    <Check className="w-5 h-5 mr-2" />
                    合成最终视频 ({videoSegments.filter(s => s.isSelected).length}段)
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* 最终视频展示 */}
        {finalVideoUrl && (
          <Card className="shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="w-5 h-5 text-blue-600" />
                最终视频
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden mb-4">
                <video
                  ref={videoRef}
                  src={finalVideoUrl}
                  controls
                  className="w-full h-full object-contain"
                  poster={productImagePreview}
                >
                  您的浏览器不支持视频播放
                </video>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={() => handleDownload(finalVideoUrl, `${productName || '视频'}_最终版.mp4`)}
                  className="flex-1 h-11 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
                >
                  <Download className="w-5 h-5 mr-2" />
                  下载视频
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
