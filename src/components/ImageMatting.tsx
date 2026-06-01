'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, X, Loader2, Target, Square, Wand2 } from 'lucide-react';

interface ImageMattingProps {
  imageUrl: string;
  onComplete: (resultImageUrl: string) => void;
  onCancel: () => void;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function ImageMatting({ imageUrl, onComplete, onCancel }: ImageMattingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [canvasSize, setCanvasSize] = useState({ width: 500, height: 400 });
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detectedBox, setDetectedBox] = useState<BoundingBox | null>(null);
  const [clickPoint, setClickPoint] = useState<{x: number, y: number} | null>(null);
  const [mode, setMode] = useState<'detect' | 'confirm'>('detect');
  const [scale, setScale] = useState(1);

  // 加载图片
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setOriginalImage(img);
      
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
      
      setCanvasSize({ width, height });
      setScale(width / img.width);
      setIsLoading(false);
      
      // 获取图片数据
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        setImageData(ctx.getImageData(0, 0, img.width, img.height));
      }
    };
    img.onerror = () => {
      setIsLoading(false);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // 绘制画布
  useEffect(() => {
    if (!canvasRef.current || !originalImage || isLoading) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制原图
    ctx.drawImage(originalImage, 0, 0, canvasSize.width, canvasSize.height);
    
    // 绘制检测框
    if (detectedBox) {
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        detectedBox.x * scale,
        detectedBox.y * scale,
        detectedBox.width * scale,
        detectedBox.height * scale
      );
      ctx.setLineDash([]);
      
      // 绘制四个角点
      const cornerSize = 10;
      ctx.fillStyle = '#00ff00';
      const corners = [
        { x: detectedBox.x * scale, y: detectedBox.y * scale },
        { x: (detectedBox.x + detectedBox.width) * scale, y: detectedBox.y * scale },
        { x: detectedBox.x * scale, y: (detectedBox.y + detectedBox.height) * scale },
        { x: (detectedBox.x + detectedBox.width) * scale, y: (detectedBox.y + detectedBox.height) * scale }
      ];
      corners.forEach(corner => {
        ctx.fillRect(corner.x - cornerSize/2, corner.y - cornerSize/2, cornerSize, cornerSize);
      });
    }
    
    // 绘制点击点
    if (clickPoint && mode === 'detect') {
      ctx.beginPath();
      ctx.arc(clickPoint.x * scale, clickPoint.y * scale, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [originalImage, canvasSize, isLoading, detectedBox, clickPoint, mode, scale]);

  // 区域生长算法检测物体边界
  const detectObjectBoundary = useCallback((startX: number, startY: number) => {
    if (!imageData) return null;
    
    const { width, height, data } = imageData;
    const visited = new Uint8Array(width * height);
    const tolerance = 35; // 颜色容差
    
    // 获取起始点颜色
    const startIdx = (startY * width + startX) * 4;
    const startR = data[startIdx];
    const startG = data[startIdx + 1];
    const startB = data[startIdx + 2];
    
    // BFS区域生长
    const queue: [number, number][] = [[startX, startY]];
    const objectPixels: [number, number][] = [];
    
    let minX = width, maxX = 0, minY = height, maxY = 0;
    
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      const idx = y * width + x;
      
      if (visited[idx]) continue;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const pixelIdx = idx * 4;
      const r = data[pixelIdx];
      const g = data[pixelIdx + 1];
      const b = data[pixelIdx + 2];
      
      // 检查颜色相似度
      const colorDiff = Math.sqrt(
        Math.pow(r - startR, 2) +
        Math.pow(g - startG, 2) +
        Math.pow(b - startB, 2)
      );
      
      if (colorDiff <= tolerance) {
        visited[idx] = 1;
        objectPixels.push([x, y]);
        
        // 更新边界
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        
        // 添加相邻像素
        queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
    }
    
    if (objectPixels.length === 0) return null;
    
    // 添加一些边距
    const padding = 5;
    return {
      x: Math.max(0, minX - padding),
      y: Math.max(0, minY - padding),
      width: Math.min(width - minX + padding, maxX - minX + padding * 2),
      height: Math.min(height - minY + padding, maxY - minY + padding * 2),
      pixels: objectPixels,
      mask: visited
    };
  }, [imageData]);

  // 边缘检测增强
  const edgeDetection = useCallback(() => {
    if (!imageData) return null;
    
    const { width, height, data } = imageData;
    const edges = new Uint8Array(width * height);
    
    // Sobel边缘检测
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        
        // 灰度值
        const getGray = (px: number, py: number) => {
          const i = (py * width + px) * 4;
          return (data[i] + data[i + 1] + data[i + 2]) / 3;
        };
        
        // Sobel算子
        const gx = 
          -getGray(x - 1, y - 1) + getGray(x + 1, y - 1) +
          -2 * getGray(x - 1, y) + 2 * getGray(x + 1, y) +
          -getGray(x - 1, y + 1) + getGray(x + 1, y + 1);
        
        const gy = 
          -getGray(x - 1, y - 1) - 2 * getGray(x, y - 1) - getGray(x + 1, y - 1) +
          getGray(x - 1, y + 1) + 2 * getGray(x, y + 1) + getGray(x + 1, y + 1);
        
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edges[y * width + x] = magnitude > 50 ? 1 : 0;
      }
    }
    
    return edges;
  }, [imageData]);

  // 智能物体检测（结合颜色聚类和边缘检测）
  const smartDetectObject = useCallback((clickX: number, clickY: number) => {
    if (!imageData) return;
    
    setIsProcessing(true);
    
    // 使用setTimeout让UI有机会更新
    setTimeout(() => {
      // 方法1：区域生长检测
      const result = detectObjectBoundary(clickX, clickY);
      
      if (result) {
        setDetectedBox({
          x: result.x,
          y: result.y,
          width: result.width,
          height: result.height
        });
        setMode('confirm');
      }
      
      setIsProcessing(false);
    }, 100);
  }, [imageData, detectObjectBoundary]);

  // 点击处理
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isProcessing || mode !== 'detect' || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    
    setClickPoint({ x, y });
    smartDetectObject(Math.floor(x), Math.floor(y));
  }, [isProcessing, mode, scale, smartDetectObject]);

  // 抠图处理
  const processMatting = useCallback(async () => {
    if (!originalImage || !detectedBox || !imageData) return;
    
    setIsProcessing(true);
    
    try {
      // 创建新画布
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = detectedBox.width;
      outputCanvas.height = detectedBox.height;
      const outputCtx = outputCanvas.getContext('2d');
      if (!outputCtx) return;
      
      // 清空为透明
      outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      
      // 从原图裁剪指定区域
      outputCtx.drawImage(
        originalImage,
        detectedBox.x, detectedBox.y, detectedBox.width, detectedBox.height,
        0, 0, detectedBox.width, detectedBox.height
      );
      
      // 获取裁剪后的图像数据
      const croppedData = outputCtx.getImageData(0, 0, detectedBox.width, detectedBox.height);
      
      // 重新检测物体像素（在裁剪区域内）
      const { data, width, height } = croppedData;
      
      // 获取中心点颜色作为参考
      const centerX = Math.floor(width / 2);
      const centerY = Math.floor(height / 2);
      const centerIdx = (centerY * width + centerX) * 4;
      
      // 使用区域生长算法在裁剪区域内检测物体
      const objectMask = new Uint8Array(width * height);
      const visited = new Uint8Array(width * height);
      const tolerance = 40;
      
      // 从多个种子点开始检测
      const seedPoints: [number, number][] = [
        [centerX, centerY],
        [Math.floor(width * 0.3), Math.floor(height * 0.3)],
        [Math.floor(width * 0.7), Math.floor(height * 0.3)],
        [Math.floor(width * 0.3), Math.floor(height * 0.7)],
        [Math.floor(width * 0.7), Math.floor(height * 0.7)]
      ];
      
      // 计算平均物体颜色
      let avgR = 0, avgG = 0, avgB = 0, count = 0;
      
      // 从中心区域采样
      for (let dy = -10; dy <= 10; dy++) {
        for (let dx = -10; dx <= 10; dx++) {
          const sx = centerX + dx;
          const sy = centerY + dy;
          if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
            const idx = (sy * width + sx) * 4;
            avgR += data[idx];
            avgG += data[idx + 1];
            avgB += data[idx + 2];
            count++;
          }
        }
      }
      
      if (count > 0) {
        avgR /= count;
        avgG /= count;
        avgB /= count;
      }
      
      // BFS区域生长
      const queue: [number, number][] = [[centerX, centerY]];
      
      while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        const idx = y * width + x;
        
        if (visited[idx]) continue;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        
        const pixelIdx = idx * 4;
        const r = data[pixelIdx];
        const g = data[pixelIdx + 1];
        const b = data[pixelIdx + 2];
        
        const colorDiff = Math.sqrt(
          Math.pow(r - avgR, 2) +
          Math.pow(g - avgG, 2) +
          Math.pow(b - avgB, 2)
        );
        
        if (colorDiff <= tolerance) {
          visited[idx] = 1;
          objectMask[idx] = 1;
          queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
      }
      
      // 使边缘平滑
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          if (objectMask[idx] === 0) {
            // 检查是否在物体边缘附近
            let nearObject = false;
            for (let dy = -2; dy <= 2; dy++) {
              for (let dx = -2; dx <= 2; dx++) {
                const ni = (y + dy) * width + (x + dx);
                if (objectMask[ni] === 1) {
                  nearObject = true;
                  break;
                }
              }
              if (nearObject) break;
            }
            
            // 如果靠近边缘，根据颜色相似度决定
            if (nearObject) {
              const pixelIdx = idx * 4;
              const r = data[pixelIdx];
              const g = data[pixelIdx + 1];
              const b = data[pixelIdx + 2];
              
              const colorDiff = Math.sqrt(
                Math.pow(r - avgR, 2) +
                Math.pow(g - avgG, 2) +
                Math.pow(b - avgB, 2)
              );
              
              if (colorDiff <= tolerance * 1.5) {
                objectMask[idx] = 1;
              }
            }
          }
        }
      }
      
      // 应用mask，将背景设为透明
      for (let i = 0; i < width * height; i++) {
        if (objectMask[i] === 0) {
          croppedData.data[i * 4 + 3] = 0; // 设置alpha为0
        }
      }
      
      // 绘制处理后的图像
      outputCtx.putImageData(croppedData, 0, 0);
      
      // 转换为blob URL
      outputCanvas.toBlob((blob) => {
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
  }, [originalImage, detectedBox, imageData, onComplete]);

  // 重置
  const handleReset = useCallback(() => {
    setDetectedBox(null);
    setClickPoint(null);
    setMode('detect');
  }, []);

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="w-5 h-5 text-blue-600" />
          智能物体抠图
        </CardTitle>
        <p className="text-sm text-gray-500">
          点击图片上的物体，系统将自动识别并框选物体边界
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            {/* 画布区域 */}
            <div 
              ref={containerRef} 
              className="relative border rounded-lg overflow-hidden bg-gray-100"
              style={{ width: canvasSize.width, height: canvasSize.height }}
            >
              <canvas
                ref={canvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                onClick={handleCanvasClick}
                className={`cursor-crosshair ${isProcessing ? 'pointer-events-none' : ''}`}
              />
              
              {isProcessing && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-white" />
                </div>
              )}
            </div>

            {/* 状态提示 */}
            <div className="flex items-center gap-2 text-sm">
              {mode === 'detect' ? (
                <div className="flex items-center gap-2 text-blue-600">
                  <Target className="w-4 h-4" />
                  <span>请点击要抠取的物体</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-600">
                  <Square className="w-4 h-4" />
                  <span>已检测到物体边界，确认或重新选择</span>
                </div>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex justify-end gap-2">
              {mode === 'confirm' && detectedBox && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    disabled={isProcessing}
                  >
                    重新选择
                  </Button>
                  <Button
                    onClick={processMatting}
                    disabled={isProcessing}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        处理中...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        确认抠图
                      </>
                    )}
                  </Button>
                </>
              )}
              <Button variant="ghost" onClick={onCancel}>
                <X className="w-4 h-4 mr-2" />
                取消
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
