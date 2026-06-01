'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Eraser, Check, X, RotateCcw, Paintbrush, Trash2, Wand2, Loader2 } from 'lucide-react';

interface ImageMattingProps {
  imageUrl: string;
  onComplete: (resultImageUrl: string) => void;
  onCancel: () => void;
}

type BrushMode = 'foreground' | 'background';

export default function ImageMatting({ imageUrl, onComplete, onCancel }: ImageMattingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushMode, setBrushMode] = useState<BrushMode>('foreground');
  const [brushSize, setBrushSize] = useState(30);
  const [isLoading, setIsLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 500, height: 400 });
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [hasMask, setHasMask] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // 加载图片
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setOriginalImage(img);
      setImageLoaded(true);
      
      // 计算画布大小，保持宽高比
      const maxWidth = 600;
      const maxHeight = 450;
      let width = img.width;
      let height = img.height;
      
      if (width > maxWidth) {
        height = (maxWidth / width) * height;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (maxHeight / height) * width;
        height = maxHeight;
      }
      
      setCanvasSize({ width: Math.round(width), height: Math.round(height) });
      setIsLoading(false);
    };
    img.onerror = () => {
      setIsLoading(false);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // 初始化画布
  useEffect(() => {
    if (!imageLoaded || !canvasRef.current || !maskCanvasRef.current || !originalImage) return;

    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');

    if (!ctx || !maskCtx) return;

    // 设置画布大小
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    maskCanvas.width = canvasSize.width;
    maskCanvas.height = canvasSize.height;

    // 绘制原图
    ctx.drawImage(originalImage, 0, 0, canvasSize.width, canvasSize.height);
    
    // 清空mask
    maskCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    setHasMask(false);
  }, [imageLoaded, canvasSize, originalImage]);

  // 获取鼠标/触摸位置
  const getPosition = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  // 更新主画布显示
  const updateMainCanvas = useCallback(() => {
    const mainCanvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!mainCanvas || !maskCanvas || !originalImage) return;

    const mainCtx = mainCanvas.getContext('2d');
    if (!mainCtx) return;

    // 重绘原图
    mainCtx.drawImage(originalImage, 0, 0, canvasSize.width, canvasSize.height);
    
    // 叠加mask
    mainCtx.drawImage(maskCanvas, 0, 0);
  }, [originalImage, canvasSize]);

  // 绘制mask
  const drawMask = useCallback((x: number, y: number) => {
    const maskCanvas = maskCanvasRef.current;
    const mainCanvas = canvasRef.current;
    if (!maskCanvas || !mainCanvas) return;

    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    // 在mask画布上绘制
    maskCtx.beginPath();
    maskCtx.arc(x, y, brushSize, 0, Math.PI * 2);
    maskCtx.fillStyle = brushMode === 'foreground' 
      ? 'rgba(0, 255, 0, 0.5)'  // 绿色表示前景
      : 'rgba(255, 0, 0, 0.5)'; // 红色表示背景
    maskCtx.fill();

    // 在主画布上叠加显示
    updateMainCanvas();
    setHasMask(true);
  }, [brushSize, brushMode, updateMainCanvas]);

  // 鼠标事件处理
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getPosition(e);
    if (!pos) return;
    setIsDrawing(true);
    drawMask(pos.x, pos.y);
  }, [getPosition, drawMask]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing) return;
    const pos = getPosition(e);
    if (!pos) return;
    drawMask(pos.x, pos.y);
  }, [isDrawing, getPosition, drawMask]);

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  // 触摸事件处理
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const pos = getPosition(e);
    if (!pos) return;
    setIsDrawing(true);
    drawMask(pos.x, pos.y);
  }, [getPosition, drawMask]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const pos = getPosition(e);
    if (!pos) return;
    drawMask(pos.x, pos.y);
  }, [isDrawing, getPosition, drawMask]);

  const handleTouchEnd = useCallback(() => {
    setIsDrawing(false);
  }, []);

  // 重置mask
  const resetMask = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    const mainCanvas = canvasRef.current;
    if (!maskCanvas || !mainCanvas) return;

    const maskCtx = maskCanvas.getContext('2d');
    const mainCtx = mainCanvas.getContext('2d');
    if (!maskCtx || !mainCtx || !originalImage) return;

    maskCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    mainCtx.drawImage(originalImage, 0, 0, canvasSize.width, canvasSize.height);
    setHasMask(false);
  }, [originalImage, canvasSize]);

  // 执行抠图 - 使用基于颜色的简单抠图算法
  const processMatting = useCallback(async () => {
    const maskCanvas = maskCanvasRef.current;
    const mainCanvas = canvasRef.current;
    if (!maskCanvas || !mainCanvas || !originalImage || !hasMask) return;

    setIsProcessing(true);

    try {
      // 创建临时画布处理抠图
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvasSize.width;
      tempCanvas.height = canvasSize.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;

      // 绘制原图
      tempCtx.drawImage(originalImage, 0, 0, canvasSize.width, canvasSize.height);
      
      // 获取mask数据
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) return;
      
      const maskData = maskCtx.getImageData(0, 0, canvasSize.width, canvasSize.height);
      const imageData = tempCtx.getImageData(0, 0, canvasSize.width, canvasSize.height);
      
      // 根据mask创建alpha通道
      // 绿色区域(前景)保留，红色区域(背景)透明
      for (let i = 0; i < maskData.data.length; i += 4) {
        const r = maskData.data[i];
        const g = maskData.data[i + 1];
        const b = maskData.data[i + 2];
        const a = maskData.data[i + 3];
        
        if (a > 0) {
          // 如果是红色（背景），设置透明
          if (r > g) {
            imageData.data[i + 3] = 0; // 设置透明
          }
          // 如果是绿色（前景），保持原样
        }
      }

      // 应用处理后的图像
      tempCtx.putImageData(imageData, 0, 0);

      // 转换为blob URL
      tempCanvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          onComplete(url);
        }
        setIsProcessing(false);
      }, 'image/png');
      
    } catch (error) {
      console.error('抠图处理失败:', error);
      setIsProcessing(false);
    }
  }, [originalImage, canvasSize, hasMask, onComplete]);

  // 自动抠图 - 基于边缘检测的简单实现
  const autoMatting = useCallback(async () => {
    if (!originalImage || !canvasRef.current) return;

    setIsProcessing(true);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 绘制原图
      ctx.drawImage(originalImage, 0, 0, canvasSize.width, canvasSize.height);
      
      const imageData = ctx.getImageData(0, 0, canvasSize.width, canvasSize.height);
      const data = imageData.data;

      // 简单的背景移除：基于颜色相似度
      // 假设边缘像素代表背景颜色
      const bgColors: { r: number; g: number; b: number }[] = [];
      
      // 采样四个角的像素作为背景参考
      const samplePoints = [
        { x: 0, y: 0 },
        { x: canvasSize.width - 1, y: 0 },
        { x: 0, y: canvasSize.height - 1 },
        { x: canvasSize.width - 1, y: canvasSize.height - 1 },
      ];

      samplePoints.forEach(point => {
        const idx = (point.y * canvasSize.width + point.x) * 4;
        bgColors.push({
          r: data[idx],
          g: data[idx + 1],
          b: data[idx + 2],
        });
      });

      // 计算平均背景色
      const avgBg = {
        r: bgColors.reduce((sum, c) => sum + c.r, 0) / bgColors.length,
        g: bgColors.reduce((sum, c) => sum + c.g, 0) / bgColors.length,
        b: bgColors.reduce((sum, c) => sum + c.b, 0) / bgColors.length,
      };

      // 颜色相似度阈值
      const threshold = 60;

      // 处理每个像素
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // 计算与背景色的距离
        const distance = Math.sqrt(
          Math.pow(r - avgBg.r, 2) +
          Math.pow(g - avgBg.g, 2) +
          Math.pow(b - avgBg.b, 2)
        );

        // 如果与背景色相似，设置为透明
        if (distance < threshold) {
          data[i + 3] = 0;
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // 转换为blob URL
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          onComplete(url);
        }
        setIsProcessing(false);
      }, 'image/png');

    } catch (error) {
      console.error('自动抠图失败:', error);
      setIsProcessing(false);
    }
  }, [originalImage, canvasSize, onComplete]);

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Eraser className="w-5 h-5" />
          手动抠图
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 操作说明 */}
        <div className="text-sm text-gray-600 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
          <p className="mb-2">💡 使用说明：</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>选择<strong>绿色画笔</strong>涂抹要保留的区域（商品主体）</li>
            <li>选择<strong>红色画笔</strong>涂抹要移除的区域（背景）</li>
            <li>点击<strong>完成抠图</strong>生成透明背景图片</li>
          </ol>
        </div>

        {/* 工具栏 */}
        <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          {/* 画笔模式 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">画笔:</span>
            <Button
              variant={brushMode === 'foreground' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setBrushMode('foreground')}
              className={`flex items-center gap-1 ${brushMode === 'foreground' ? 'bg-green-600 hover:bg-green-700' : ''}`}
            >
              <Paintbrush className="w-4 h-4 text-green-500" />
              保留
            </Button>
            <Button
              variant={brushMode === 'background' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setBrushMode('background')}
              className={`flex items-center gap-1 ${brushMode === 'background' ? 'bg-red-600 hover:bg-red-700' : ''}`}
            >
              <Trash2 className="w-4 h-4 text-red-500" />
              移除
            </Button>
          </div>

          {/* 画笔大小 */}
          <div className="flex items-center gap-2 flex-1 min-w-[150px]">
            <span className="text-sm">大小:</span>
            <Slider
              value={[brushSize]}
              onValueChange={([value]) => setBrushSize(value)}
              min={5}
              max={80}
              step={5}
              className="w-24"
            />
            <span className="text-sm text-gray-500 w-8">{brushSize}</span>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={resetMask}
              title="重置"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={autoMatting}
              disabled={isProcessing}
              title="自动抠图"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              自动
            </Button>
          </div>
        </div>

        {/* 画布区域 */}
        <div 
          ref={containerRef}
          className="relative border rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-900"
          style={{ 
            width: canvasSize.width, 
            height: canvasSize.height,
            maxWidth: '100%',
            margin: '0 auto'
          }}
        >
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-800">
              <div className="text-gray-500">加载图片中...</div>
            </div>
          )}
          
          {/* 主画布 - 显示图片和mask叠加 */}
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 cursor-crosshair"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          />
          
          {/* Mask画布 - 不可见，用于存储mask数据 */}
          <canvas
            ref={maskCanvasRef}
            className="absolute top-0 left-0 cursor-crosshair opacity-0"
            style={{ width: canvasSize.width, height: canvasSize.height }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isProcessing}
          >
            <X className="w-4 h-4 mr-1" />
            取消
          </Button>
          <Button
            onClick={processMatting}
            disabled={!hasMask || isProcessing}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-1" />
                完成抠图
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
