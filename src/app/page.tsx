'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  Upload, 
  Video, 
  FileText, 
  Sparkles, 
  Download, 
  Loader2,
  CheckCircle2,
  Circle
} from 'lucide-react';

interface GenerationStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  content?: string;
}

export default function Home() {
  const [productName, setProductName] = useState('');
  const [productSellingPoints, setProductSellingPoints] = useState('');
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productImagePreview, setProductImagePreview] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [steps, setSteps] = useState<GenerationStep[]>([
    { id: 'script', title: 'AI自动生成带货口播文案', status: 'pending' },
    { id: 'prompt', title: '自动生成视频镜头Prompt', status: 'pending' },
    { id: 'video', title: '调用火山引擎生成视频', status: 'pending' },
    { id: 'result', title: '展示生成结果', status: 'pending' },
  ]);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProductImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProductImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const updateStepStatus = (stepId: string, status: GenerationStep['status'], content?: string) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, status, content } : step
    ));
  };

  const handleGenerate = async () => {
    if (!productName.trim() || !productSellingPoints.trim()) {
      alert('请填写商品名称和卖点');
      return;
    }

    setIsGenerating(true);
    
    // Reset steps
    setSteps([
      { id: 'script', title: 'AI自动生成带货口播文案', status: 'pending' },
      { id: 'prompt', title: '自动生成视频镜头Prompt', status: 'pending' },
      { id: 'video', title: '调用火山引擎生成视频', status: 'pending' },
      { id: 'result', title: '展示生成结果', status: 'pending' },
    ]);
    setVideoUrl('');

    try {
      // Step 1: Generate script
      updateStepStatus('script', 'in_progress');
      
      const formData = new FormData();
      formData.append('productName', productName);
      formData.append('productSellingPoints', productSellingPoints);
      if (productImage) {
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
              
              if (parsed.type === 'script') {
                updateStepStatus('script', 'completed', parsed.content);
                updateStepStatus('prompt', 'in_progress');
              } else if (parsed.type === 'prompt') {
                updateStepStatus('prompt', 'completed', parsed.content);
                updateStepStatus('video', 'in_progress');
              } else if (parsed.type === 'video_url') {
                updateStepStatus('video', 'completed');
                updateStepStatus('result', 'in_progress');
                setVideoUrl(parsed.content);
              } else if (parsed.type === 'done') {
                updateStepStatus('result', 'completed');
              } else if (parsed.type === 'error') {
                throw new Error(parsed.content);
              }
            } catch (e) {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('生成失败:', error);
      alert(error instanceof Error ? error.message : '生成失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

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

  const completedSteps = steps.filter(s => s.status === 'completed').length;
  const progress = (completedSteps / steps.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            AI商家带货视频生成Agent
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            一键生成专业带货短视频，让您的商品更具吸引力
          </p>
        </div>

        {/* Main Form */}
        <Card className="mb-6 shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-600" />
              商品信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Product Name */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                商品名称
              </label>
              <Input
                placeholder="请输入商品名称，如：智能保温杯"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                disabled={isGenerating}
                className="border-gray-300 dark:border-gray-600"
              />
            </div>

            {/* Product Selling Points */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                商品卖点
              </label>
              <Textarea
                placeholder="请输入商品卖点，如：24小时保温保冷、304不锈钢内胆、时尚简约设计..."
                value={productSellingPoints}
                onChange={(e) => setProductSellingPoints(e.target.value)}
                disabled={isGenerating}
                rows={4}
                className="border-gray-300 dark:border-gray-600"
              />
            </div>

            {/* Product Image Upload */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                上传商品图片
              </label>
              <div className="flex gap-4 items-start">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isGenerating}
                  className="flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  选择图片
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={isGenerating}
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
                      }}
                      disabled={isGenerating}
                    >
                      ×
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !productName.trim() || !productSellingPoints.trim()}
              className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Video className="w-5 h-5 mr-2" />
                  开始生成带货视频
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Progress Section */}
        {(isGenerating || completedSteps > 0) && (
          <Card className="mb-6 shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                生成进度
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Progress Bar */}
              <div className="mb-6">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  已完成 {completedSteps}/{steps.length} 步
                </p>
              </div>

              {/* Steps */}
              <div className="space-y-4">
                {steps.map((step, index) => (
                  <div key={step.id} className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-1">
                      {step.status === 'completed' ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : step.status === 'in_progress' ? (
                        <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                      ) : (
                        <Circle className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {step.title}
                        </span>
                        {step.status === 'in_progress' && (
                          <Badge variant="secondary" className="text-xs">
                            处理中
                          </Badge>
                        )}
                        {step.status === 'completed' && (
                          <Badge variant="default" className="text-xs bg-green-600">
                            完成
                          </Badge>
                        )}
                      </div>
                      {step.content && (
                        <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded p-2 mt-2">
                          {step.content}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Video Result */}
        {videoUrl && (
          <Card className="shadow-lg border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video className="w-5 h-5 text-blue-600" />
                生成结果
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="aspect-video bg-black rounded-lg overflow-hidden mb-4">
                <video
                  src={videoUrl}
                  controls
                  className="w-full h-full object-contain"
                  poster={productImagePreview}
                >
                  您的浏览器不支持视频播放
                </video>
              </div>
              <Button
                onClick={handleDownload}
                className="w-full bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
                size="lg"
              >
                <Download className="w-4 h-4 mr-2" />
                下载视频
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
