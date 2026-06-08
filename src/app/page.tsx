'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { getAccessibleUrl } from '@/lib/utils';
import {
  Send,
  Video,
  Download,
  Loader2,
  Image as ImageIcon,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Minimize2,
  Camera,
  Play,
  User,
  AlertCircle,
  CheckCircle2,
  Circle,
} from 'lucide-react';

// 用户头像本地存储key
const USER_AVATAR_STORAGE_KEY = 'huxiaoying_user_avatar';

// 滚动到底部悬浮按钮组件
function ScrollToBottomButton({
  onClick,
  isAtBottom,
}: {
  onClick: () => void;
  isAtBottom: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isAtBottom}
      className={`w-9 h-9 rounded-full flex items-center justify-center
        transition-all duration-200 shadow-md
        ${isAtBottom 
          ? 'bg-gray-200/50 text-gray-300 cursor-default opacity-50' 
          : 'bg-gray-100/80 hover:bg-gray-200/90 text-gray-500 hover:text-blue-500 cursor-pointer'
        }`}
      style={{
        backdropFilter: 'blur(4px)',
      }}
    >
      <ChevronDown className="w-5 h-5" />
    </button>
  );
}

// 用户头像组件
function UserAvatar({
  avatarUrl,
  onUpload,
  onReset,
  isUploading,
}: {
  avatarUrl: string | null;
  onUpload: (file: File) => Promise<void>;
  onReset: () => void;
  isUploading: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  const handleClick = () => {
    if (isUploading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await onUpload(file);
    }
    e.target.value = ''; // 清空以允许重复选择
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (avatarUrl && !isUploading) {
      onReset();
    }
  };

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* 头像容器 */}
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        disabled={isUploading}
        className={`w-9 h-9 rounded-full overflow-hidden border-2 border-white/50 shadow-sm
          transition-all duration-200 ${isUploading ? 'cursor-default' : 'hover:border-blue-300 hover:shadow-md cursor-pointer'}`}
        title="右键恢复默认头像"
      >
        {isUploading ? (
          <div className="w-full h-full bg-gray-200 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
          </div>
        ) : avatarUrl ? (
          <img 
            src={avatarUrl} 
            alt="用户头像" 
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gray-300 flex items-center justify-center">
            <User className="w-4 h-4 text-gray-500" />
          </div>
        )}
      </button>

      {/* hover提示 */}
      {showTooltip && !isUploading && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-gray-800 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
            {avatarUrl ? '点击更换头像 · 右键恢复默认' : '点击上传头像'}
          </div>
        </div>
      )}

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}

// 客户端时间组件 - 避免 hydration 问题
function ClientTime({ timestamp }: { timestamp: string }) {
  const [time, setTime] = useState<string>('');
  
  useEffect(() => {
    setTime(new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
  }, [timestamp]);
  
  return <span>{time || '--:--'}</span>;
}

// 消息类型
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  imageUrl?: string;
  isStreaming?: boolean;
  state?: Partial<SessionState>;
}

// 镜头片段状态
interface SegmentProgress {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  stage?: 'tts' | 'video' | 'merge' | 'upload';
  error?: string;
}

// 全局进度状态
interface ProgressState {
  currentStage: number; // 1-5 对应5个主阶段
  stageName: string;
  estimatedTime?: string;
  segmentProgress?: SegmentProgress[];
}

// 会话状态
interface SessionState {
  productImageUrl?: string;
  productName?: string;
  features?: string[];
  scripts?: Array<{ id: number; script: string; prompt: string }>;
  segments?: Array<{
    id: number;
    script: string;
    prompt: string;
    audioUrl?: string;
    videoUrl?: string;
    duration?: number;
    localVideoPath?: string;
    status?: 'pending' | 'processing' | 'completed' | 'failed';
  }>;
  finalVideoUrl?: string;
  localVideoPath?: string;
  finalDuration?: number;
  currentStage?: 'idle' | 'identifying' | 'product_identified' | 'script_generated' | 'video_generated' | 'composing' | 'done';
  progress?: ProgressState;
}

// 视频播放器组件（16:9固定比例，支持单独音频轨道，支持隐藏控制条）
function VideoPlayer({
  videoUrl,
  localVideoPath,
  audioUrl,
  showControls = true,
}: {
  videoUrl?: string;
  localVideoPath?: string;
  audioUrl?: string;
  showControls?: boolean;
}) {
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const effectiveVideoUrl = localVideoPath || (videoUrl ? getAccessibleUrl(videoUrl) : '');
  const effectiveAudioUrl = audioUrl ? getAccessibleUrl(audioUrl) : '';

  // 点击播放按钮
  const handlePlayClick = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.play();
      setIsPlaying(true);
    }
  }, []);

  // 同步视频和音频播放
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    if (audioRef.current && videoRef.current) {
      audioRef.current.currentTime = videoRef.current.currentTime;
      audioRef.current.play();
    }
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  const handleSeeked = useCallback(() => {
    if (audioRef.current && videoRef.current) {
      audioRef.current.currentTime = videoRef.current.currentTime;
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current && videoRef.current) {
      // 保持音视频同步（容差0.1秒）
      const diff = Math.abs(audioRef.current.currentTime - videoRef.current.currentTime);
      if (diff > 0.1) {
        audioRef.current.currentTime = videoRef.current.currentTime;
      }
    }
  }, []);

  return (
    <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
      {effectiveVideoUrl ? (
        <>
          <video
            ref={videoRef}
            src={effectiveVideoUrl}
            className="w-full h-full object-contain"
            controls={showControls}
            playsInline
            preload="auto"
            onPlay={handlePlay}
            onPause={handlePause}
            onSeeked={handleSeeked}
            onTimeUpdate={handleTimeUpdate}
            onError={() => {
              setVideoError('视频加载失败');
              setIsLoading(false);
            }}
            onCanPlay={() => {
              setIsLoading(false);
              setVideoError(null);
            }}
          />
          {/* 隐藏的音频元素，用于播放TTS音频 */}
          {effectiveAudioUrl && (
            <audio
              ref={audioRef}
              src={effectiveAudioUrl}
              preload="auto"
            />
          )}
          
          {/* 悬浮播放按钮（仅当隐藏控制条且未播放时显示） */}
          {!showControls && !isPlaying && !isLoading && effectiveVideoUrl && (
            <button
              onClick={handlePlayClick}
              className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors cursor-pointer"
            >
              <div className="w-12 h-12 rounded-full bg-white/80 flex items-center justify-center shadow-lg">
                <Play className="w-6 h-6 text-blue-600 ml-1" />
              </div>
            </button>
          )}
        </>
      ) : (
        <div className="w-full h-full bg-gray-800 flex items-center justify-center">
          <p className="text-gray-400 text-sm">视频生成中...</p>
        </div>
      )}
      
      {isLoading && effectiveVideoUrl && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-6 h-6 animate-spin text-white" />
        </div>
      )}
      
      {videoError && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
          <p className="text-red-400 text-sm">{videoError}</p>
        </div>
      )}
    </div>
  );
}

// 5阶段进度条组件
const PROGRESS_STAGES = [
  { key: 1, name: 'TTS音频生成', icon: 'mic' },
  { key: 2, name: '视频画面生成', icon: 'video' },
  { key: 3, name: '音视频合并', icon: 'merge' },
  { key: 4, name: '整体拼接合成', icon: 'compose' },
  { key: 5, name: '任务完成', icon: 'check' },
];

function ProgressTracker({
  currentStage,
  stageName,
  estimatedTime,
  isGenerating,
}: {
  currentStage: number;
  stageName: string;
  estimatedTime?: string;
  isGenerating: boolean;
}) {
  if (!isGenerating || currentStage === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-blue-100 shadow-sm p-4 mb-4">
      {/* 进度条 */}
      <div className="flex items-center gap-2 mb-3">
        {PROGRESS_STAGES.map((stage, idx) => (
          <div key={stage.key} className="flex items-center flex-1">
            {/* 阶段节点 */}
            <div className={`flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300
              ${currentStage >= stage.key 
                ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white' 
                : 'bg-gray-100 text-gray-400'}`}>
              {currentStage === stage.key ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : currentStage > stage.key ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Circle className="w-4 h-4" />
              )}
            </div>
            {/* 阶段名称 */}
            <div className="ml-2 hidden sm:block">
              <span className={`text-xs font-medium transition-colors
                ${currentStage >= stage.key ? 'text-blue-600' : 'text-gray-400'}`}>
                {stage.name}
              </span>
            </div>
            {/* 连接线 */}
            {idx < PROGRESS_STAGES.length - 1 && (
              <div className={`flex-1 h-1 mx-2 rounded transition-all duration-300
                ${currentStage > stage.key ? 'bg-gradient-to-r from-blue-500 to-purple-500' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>
      
      {/* 实时状态文字 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          <span className="text-sm text-blue-600 font-medium">{stageName}</span>
        </div>
        {estimatedTime && (
          <span className="text-xs text-gray-500">预计等待 {estimatedTime}</span>
        )}
      </div>
    </div>
  );
}

// 镜头卡片状态标签组件
function SegmentStatusBadge({ status }: { status: 'pending' | 'processing' | 'completed' | 'failed' }) {
  const statusConfig = {
    pending: { color: 'text-gray-400', bg: 'bg-gray-100', icon: Circle, text: '待处理' },
    processing: { color: 'text-blue-500', bg: 'bg-blue-50', icon: Loader2, text: '处理中' },
    completed: { color: 'text-green-500', bg: 'bg-green-50', icon: CheckCircle2, text: '已完成' },
    failed: { color: 'text-red-500', bg: 'bg-red-50', icon: AlertCircle, text: '失败' },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${config.bg} ${config.color}`}>
      <Icon className={`w-3 h-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
      <span className="text-xs font-medium">{config.text}</span>
    </div>
  );
}

// 镜头文案卡片组件（支持编辑、状态标识、拖拽）
function ScriptCard({
  script,
  index,
  total,
  onEdit,
  onRegenerate,
  onMoveUp,
  onMoveDown,
  segmentStatus,
  isGenerating,
}: {
  script: { id: number; script: string; prompt: string };
  index: number;
  total: number;
  onEdit: (field: 'script' | 'prompt', value: string) => void;
  onRegenerate: () => Promise<void>;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  segmentStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  isGenerating?: boolean;
}) {
  const [editingScript, setEditingScript] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [scriptValue, setScriptValue] = useState(script.script);
  const [promptValue, setPromptValue] = useState(script.prompt);

  const handleSaveScript = () => {
    onEdit('script', scriptValue);
    setEditingScript(false);
  };

  const handleSavePrompt = () => {
    onEdit('prompt', promptValue);
    setEditingPrompt(false);
  };

  const handleCancelScript = () => {
    setScriptValue(script.script);
    setEditingScript(false);
  };

  const handleCancelPrompt = () => {
    setPromptValue(script.prompt);
    setEditingPrompt(false);
  };

  const isLast = index === total - 1;
  const status = segmentStatus || 'pending';
  const disabled = isGenerating;

  // 根据状态配置节点样式
  const nodeStyle = {
    pending: 'bg-blue-100 text-blue-600 border-2 border-blue-300',
    processing: 'bg-blue-500 text-white border-2 border-blue-400',
    completed: 'bg-green-500 text-white border-2 border-green-400',
    failed: 'bg-red-500 text-white border-2 border-red-400',
  };

  return (
    <div className="relative flex items-start gap-4 group">
      {/* 左侧流程线 */}
      <div className="flex flex-col items-center w-8 shrink-0">
        {/* 圆形节点 */}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 transition-all duration-300 ${nodeStyle[status]}`}>
          {status === 'processing' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : status === 'completed' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : status === 'failed' ? (
            <AlertCircle className="w-4 h-4" />
          ) : (
            index + 1
          )}
        </div>
        {/* 连接线 */}
        {!isLast && (
          <div className={`w-0.5 h-full mt-1 flex-1 min-h-[20px] transition-colors duration-300
            ${status === 'completed' ? 'bg-green-300' : 'bg-blue-200'}`} />
        )}
      </div>

      {/* 卡片主体 */}
      <div className={`flex-1 bg-white rounded-lg border transition-all duration-200
        ${editingScript || editingPrompt ? 'border-blue-300 shadow-md' : 'border-gray-100 shadow-sm group-hover:shadow-md'}
        ${disabled ? 'opacity-70' : ''}`}>
        
        {/* 状态标签栏 */}
        <div className="flex items-center justify-between px-3 py-1 bg-gray-50 rounded-t-lg border-b border-gray-100">
          <span className="text-xs text-gray-400 font-medium">镜头 {index + 1}</span>
          <SegmentStatusBadge status={status} />
        </div>
        
        {/* 上半部分：镜头脚本编辑区 */}
        <div className="p-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">镜头描述</span>
            </div>
            {!editingPrompt && !disabled && (
              <button
                onClick={() => setEditingPrompt(true)}
                className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
              >
                编辑
              </button>
            )}
          </div>
          
          {editingPrompt ? (
            <div className="space-y-2">
              <textarea
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                className="w-full p-2 text-sm border border-gray-200 rounded-md focus:border-blue-300 focus:ring-1 focus:ring-blue-200 resize-none"
                rows={4}
                placeholder="输入镜头描述..."
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleCancelPrompt}
                  className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded"
                >
                  取消
                </button>
                <button
                  onClick={handleSavePrompt}
                  className="px-2 py-1 text-xs bg-blue-500 text-white hover:bg-blue-600 rounded"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => !disabled && setEditingPrompt(true)}
              className={`text-xs text-gray-500 ${disabled ? 'cursor-default' : 'cursor-pointer hover:text-gray-700'}`}
            >
              {script.prompt || '暂无镜头描述'}
            </div>
          )}
        </div>

        {/* 下半部分：口播文案编辑区 */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 font-medium">口播文案</span>
            <div className="flex items-center gap-2">
              {!editingScript && (
                <>
                  <button
                    onClick={() => !disabled && setEditingScript(true)}
                    className={`text-xs ${disabled ? 'text-gray-300 cursor-default' : 'text-gray-400 hover:text-blue-600 transition-colors'}`}
                    disabled={disabled}
                  >
                    编辑
                  </button>
                  <button
                    onClick={onRegenerate}
                    className={`text-xs ${disabled ? 'text-gray-300 cursor-default' : 'text-blue-500 hover:text-blue-600 font-medium'}`}
                    disabled={disabled}
                  >
                    重新生成
                  </button>
                </>
              )}
            </div>
          </div>
          
          {editingScript ? (
            <div className="space-y-2">
              <textarea
                value={scriptValue}
                onChange={(e) => setScriptValue(e.target.value)}
                className="w-full p-2 text-sm font-medium border border-gray-200 rounded-md focus:border-blue-300 focus:ring-1 focus:ring-blue-200 resize-none"
                rows={3}
                placeholder="输入口播文案..."
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleCancelScript}
                  className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveScript}
                  className="px-2 py-1 text-xs bg-blue-500 text-white hover:bg-blue-600 rounded"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm font-medium text-gray-700 line-clamp-3">
              {script.script || '暂无口播文案'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// 主页面
export default function ChatAgentPage() {
  // 状态
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '您好！我是「货小影」，您的专业带货视频智能助手。\n\n我可以帮您：\n1. 上传商品图片，自动识别商品和卖点\n2. 分段创作口播文案与画面提示词\n3. 生成带货视频片段\n4. 合成成片\n\n请上传您的商品图片或描述，开始创作吧！',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [sessionId, setSessionId] = useState<string>();
  const [sessionState, setSessionState] = useState<SessionState>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{
    currentStage: number;
    stageName: string;
    estimatedTime?: string;
    segmentStatus: Record<number, 'pending' | 'processing' | 'completed' | 'failed'>;
  }>({
    currentStage: 0,
    stageName: '',
    segmentStatus: {},
  });

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true); // 是否滚动到底部

  // 初始化用户头像（从localStorage读取）
  useEffect(() => {
    const savedAvatar = localStorage.getItem(USER_AVATAR_STORAGE_KEY);
    if (savedAvatar) {
      setUserAvatar(savedAvatar);
    }
  }, []);

  // 上传用户头像
  const handleAvatarUpload = async (file: File) => {
    setIsAvatarUploading(true);
    try {
      // 创建canvas裁剪图片为圆形
      const img = await createImageFromFile(file);
      const canvas = document.createElement('canvas');
      const size = 200; // 输出尺寸
      canvas.width = size;
      canvas.height = size;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建canvas');

      // 计算裁剪区域（居中裁剪）
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      
      // 绘制圆形裁剪
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      
      // 转为base64存储
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      localStorage.setItem(USER_AVATAR_STORAGE_KEY, dataUrl);
      setUserAvatar(dataUrl);
    } catch (error) {
      console.error('头像上传失败:', error);
      alert('头像上传失败，请重试');
    } finally {
      setIsAvatarUploading(false);
    }
  };

  // 从File创建Image对象
  const createImageFromFile = (file: File): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // 恢复默认头像
  const handleAvatarReset = () => {
    localStorage.removeItem(USER_AVATAR_STORAGE_KEY);
    setUserAvatar(null);
  };

  // 滚动到底部（平滑滚动）
  const scrollToBottom = useCallback(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({
        top: scrollAreaRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  // 监听滚动位置，判断是否到达底部
  const handleScroll = useCallback(() => {
    if (scrollAreaRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollAreaRef.current;
      const isBottom = scrollHeight - scrollTop - clientHeight < 10; // 10px容差
      setIsAtBottom(isBottom);
    }
  }, []);

  // 自动滚动（新消息时）
  useEffect(() => {
    scrollToBottom();
    setIsAtBottom(true);
  }, [messages, scrollToBottom]);

  // 发送消息
  const sendMessage = async (content: string, imageUrl?: string) => {
    if (!content.trim() && !imageUrl) return;

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: imageUrl ? '[已上传商品图片]' : content,
      timestamp: new Date().toISOString(),
      imageUrl: imageUrl,
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    const assistantMessage: ChatMessage = {
      id: `assistant_${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      const response = await fetch('/api/chat-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: content,
          imageUrl,
          productName: sessionState.productName,
        }),
      });

      if (!response.ok) throw new Error('请求失败');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法获取流');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6));

              switch (eventData.type) {
                case 'text':
                  const textContent = eventData.content;
                  if (textContent.includes('<tool_call>') || 
                      textContent.match(/^[\s\n]*$/) ||
                      textContent.match(/^[{}\s":,]*$/)) {
                    break;
                  }
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, content: m.content + textContent }
                        : m
                    )
                  );
                  break;

                case 'progress':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, content: m.content ? `${m.content}\n${eventData.content}` : eventData.content }
                        : m
                    )
                  );
                  break;

                case 'tool_result':
                  const toolData = eventData.data || {};
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            content: m.content ? `${m.content}\n${eventData.content}` : eventData.content,
                            state: { ...m.state, ...toolData },
                          }
                        : m
                    )
                  );
                  setSessionState(prev => ({ ...prev, ...toolData }));
                  break;

                case 'state_update':
                  setSessionId(eventData.sessionId);
                  const stateData = eventData.data || {};
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, state: { ...m.state, ...stateData } }
                        : m
                    )
                  );
                  setSessionState(prev => ({ ...prev, ...stateData }));
                  break;

                case 'wait_feedback':
                  const feedbackState = eventData.data?.state || {};
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, state: { ...m.state, ...feedbackState }, isStreaming: false }
                        : m
                    )
                  );
                  setSessionState(prev => ({ ...prev, ...feedbackState }));
                  setIsLoading(false);
                  setIsGenerating(false);
                  setGenerationProgress(prev => ({
                    ...prev,
                    currentStage: 0,
                    stageName: '',
                  }));
                  break;

                // 视频生成进度事件
                case 'generation_progress':
                  const progressData = eventData.data || {};
                  setGenerationProgress(prev => ({
                    currentStage: progressData.currentStage || prev.currentStage,
                    stageName: progressData.stageName || prev.stageName,
                    estimatedTime: progressData.estimatedTime,
                    segmentStatus: progressData.segmentStatus || prev.segmentStatus,
                  }));
                  if (progressData.isGenerating) {
                    setIsGenerating(true);
                  }
                  break;

                // 镜头片段状态更新
                case 'segment_status':
                  const segId = eventData.segmentId;
                  const segStatus = eventData.status;
                  setGenerationProgress(prev => ({
                    ...prev,
                    segmentStatus: {
                      ...prev.segmentStatus,
                      [segId]: segStatus,
                    },
                  }));
                  break;

                case 'complete':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, isStreaming: false }
                        : m
                    )
                  );
                  setIsLoading(false);
                  setIsGenerating(false);
                  setGenerationProgress(prev => ({
                    ...prev,
                    currentStage: 0,
                    stageName: '',
                  }));
                  break;

                case 'error':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            content: `错误: ${eventData.content}`,
                            isStreaming: false,
                          }
                        : m
                    )
                  );
                  setIsLoading(false);
                  break;
              }
            } catch {
              // 解析失败，忽略
            }
          }
        }
      }
    } catch (error) {
      console.error('发送消息失败:', error);
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMessage.id
            ? {
                ...m,
                content: `抱歉，处理时出现错误：${error instanceof Error ? error.message : '未知错误'}`,
                isStreaming: false,
              }
            : m
        )
      );
      setIsLoading(false);
    }
  };

  // 上传图片
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('上传失败');

      const data = await response.json();
      sendMessage('请帮我分析这张商品图片，识别商品信息并提取卖点', data.imageUrl);
    } catch (error) {
      console.error('上传图片失败:', error);
      alert('上传图片失败，请重试');
    }
  };

  // 清除会话
  const clearSession = async () => {
    if (sessionId) {
      await fetch(`/api/chat-agent?sessionId=${sessionId}`, { method: 'DELETE' });
    }
    setSessionId(undefined);
    setSessionState({});
    setMessages([
      {
        id: 'welcome_new',
        role: 'assistant',
        content: '会话已清除。请上传新的商品图片，开始新的创作！',
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  // 渲染助手消息内容
  const renderAssistantContent = (message: ChatMessage) => {
    const msgState = message.state || {};

    // 最终视频
    if (msgState.finalVideoUrl || msgState.localVideoPath) {
      const videoSrc = msgState.localVideoPath || getAccessibleUrl(msgState.finalVideoUrl || '');
      return (
        <div className="space-y-3">
          <p className="text-sm">{message.content}</p>
          <div className="bg-white rounded-xl p-3 shadow-sm">
            <VideoPlayer videoUrl={msgState.finalVideoUrl} localVideoPath={msgState.localVideoPath} />
            <div className="mt-2 flex gap-2">
              <a
                href={videoSrc}
                download
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
              >
                <Download className="w-4 h-4" />
                下载视频
              </a>
              <Button variant="outline" size="sm" onClick={clearSession}>
                开始新创作
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // 视频片段网格
    if (msgState.segments && msgState.segments.length > 0) {
      return (
        <div className="space-y-3">
          <p className="text-sm">{message.content}</p>
          
          {/* 商品信息卡片 */}
          {msgState.productName && (
            <Card className="bg-white shadow-sm max-w-[600px]">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className="bg-blue-100 text-blue-700">商品</Badge>
                  <span className="font-medium text-sm">{msgState.productName}</span>
                </div>
                {msgState.features && msgState.features.length > 0 && (
                  <div className="text-xs text-gray-600">
                    <span className="font-medium">核心卖点：</span>
                    {msgState.features.join('、')}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          
          {/* 视频片段网格 - 自适应布局，最小260px，大屏优先2列 */}
          <div className="grid gap-4" style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          }}>
            {(msgState.segments || [])
              .sort((a, b) => (a.id || 0) - (b.id || 0))
              .map(segment => (
              <div key={segment.id} className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow">
                {/* 视频预览区 - 16:9比例 */}
                <div className="relative aspect-video bg-gray-900 group">
                  <VideoPlayer
                    videoUrl={segment.videoUrl}
                    localVideoPath={segment.localVideoPath}
                    audioUrl={segment.audioUrl}
                    showControls={true}
                  />
                </div>
                {/* 文案与操作区 */}
                <div className="p-3 bg-gray-50">
                  <Badge variant="outline" className="mb-2 text-xs border-blue-200 text-blue-600">片段 {segment.id}</Badge>
                  <p className="text-sm text-gray-700 mt-1 line-clamp-2 leading-relaxed">{segment.script}</p>
                </div>
              </div>
            ))}
          </div>
          
          {/* 操作按钮 */}
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              className="bg-blue-500 hover:bg-blue-600"
              onClick={() => sendMessage('请合成所有片段为最终视频')}
              disabled={isLoading}
            >
              <Video className="w-4 h-4 mr-1" />
              合成视频
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sendMessage('重新生成所有视频片段')}
              disabled={isLoading}
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              重新生成
            </Button>
          </div>
        </div>
      );
    }

    // 文案内容
    if (msgState.scripts && msgState.scripts.length > 0) {
      return (
        <div className="space-y-3">
          <p className="text-sm">{message.content}</p>
          
          {/* 商品信息卡片 */}
          {msgState.productName && (
            <Card className="bg-white shadow-sm max-w-[600px]">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className="bg-blue-100 text-blue-700">商品</Badge>
                  <span className="font-medium text-sm">{msgState.productName}</span>
                </div>
                {msgState.features && msgState.features.length > 0 && (
                  <div className="text-xs text-gray-600">
                    <span className="font-medium">核心卖点：</span>
                    {msgState.features.join('、')}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          
          {/* 全流程进度条 */}
          <ProgressTracker
            currentStage={generationProgress.currentStage}
            stageName={generationProgress.stageName}
            estimatedTime={generationProgress.estimatedTime}
            isGenerating={isGenerating}
          />
          
          {/* 镜头序列引导语 */}
          <div className="text-xs text-gray-500 mb-3 p-2 bg-blue-50 rounded-lg">
            📹 以下是为你生成的连续镜头，可直接修改镜头描述和口播文案，调整顺序或单独重制某一镜头，再生成完整视频
          </div>
          
          {/* 镜头序列卡片 - 左侧流程线 + 纵向排列 */}
          <div className="relative pl-8">
            {/* 左侧垂直流程线 */}
            <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-blue-200" />
            {/* 流程节点 */}
            {msgState.scripts.map((script, index) => (
              <div key={script.id} className="relative mb-4 last:mb-0">
                {/* 左侧节点圆点 */}
                <div className="absolute -left-5 top-4 w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow" />
                
                {/* 镜头卡片 */}
                <ScriptCard
                  script={script}
                  index={index}
                  total={msgState.scripts?.length || 0}
                  segmentStatus={generationProgress.segmentStatus[script.id] || 'pending'}
                  isGenerating={isGenerating}
                  onEdit={(field: 'script' | 'prompt', value: string) => {
                    // 更新文案内容
                    const updatedScripts = msgState.scripts?.map(s => 
                      s.id === script.id ? { ...s, [field]: value } : s
                    ) || [];
                    setSessionState(prev => ({
                      ...prev,
                      scripts: updatedScripts
                    }));
                  }}
                  onRegenerate={() => sendMessage(`重新生成镜头${script.id}`)}
                  onMoveUp={index > 0 ? () => {
                    const newScripts = [...(msgState.scripts || [])];
                    [newScripts[index - 1], newScripts[index]] = [newScripts[index], newScripts[index - 1]];
                    setSessionState(prev => ({ ...prev, scripts: newScripts }));
                  } : undefined}
                  onMoveDown={index < (msgState.scripts?.length || 0) - 1 ? () => {
                    const newScripts = [...(msgState.scripts || [])];
                    [newScripts[index], newScripts[index + 1]] = [newScripts[index + 1], newScripts[index]];
                    setSessionState(prev => ({ ...prev, scripts: newScripts }));
                  } : undefined}
                />
              </div>
            ))}
          </div>
          
          {/* 底部统一操作按钮 */}
          <div className="mt-4 p-3 bg-white rounded-lg shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {isGenerating ? '正在生成中，请稍候...' : '确认所有镜头内容后，点击生成完整视频'}
              </span>
              <Button
                size="sm"
                className="bg-blue-500 hover:bg-blue-600 text-white"
                onClick={() => sendMessage('确认文案，开始生成视频')}
                disabled={isLoading || isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    生成中...
                  </>
                ) : (
                  '🎬 生成完整视频'
                )}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // 商品识别结果
    if (msgState.productName && !msgState.scripts) {
      return (
        <div className="space-y-3">
          <p className="text-sm">{message.content}</p>
          <Card className="bg-white shadow-sm max-w-[600px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary" className="bg-blue-100 text-blue-700">商品</Badge>
                <span className="font-medium text-sm">{msgState.productName}</span>
              </div>
              {msgState.features && msgState.features.length > 0 && (
                <div className="text-xs text-gray-600">
                  <span className="font-medium">核心卖点：</span>
                  {msgState.features.join('、')}
                </div>
              )}
            </CardContent>
          </Card>
          <Button
            size="sm"
            className="bg-blue-500 hover:bg-blue-600"
            onClick={() => sendMessage('请根据商品信息生成带货文案')}
            disabled={isLoading}
          >
            生成文案
          </Button>
        </div>
      );
    }

    // 默认文本
    return <p className="text-sm whitespace-pre-wrap">{message.content}</p>;
  };

  // 渲染单条消息
  // 判断是否是纯文本消息（无结构化数据）
  const isPlainTextMessage = (message: ChatMessage) => {
    const msgState = message.state || {};
    // 如果有商品信息、文案、视频片段、最终视频等结构化数据，则不是纯文本
    return !msgState.productName && 
           !msgState.scripts?.length && 
           !msgState.segments?.length && 
           !msgState.finalVideoUrl && 
           !msgState.localVideoPath;
  };

  // 渲染单条消息
  const renderMessage = (message: ChatMessage) => {
    const isPlainText = isPlainTextMessage(message);
    
    if (message.role === 'user') {
      // 用户消息：头像在右侧
      return (
        <div key={message.id} className="flex justify-end items-start gap-2 mb-3">
          {/* 消息气泡 */}
          <div className="max-w-[72%] bg-blue-500 text-white rounded-2xl rounded-tr-md px-4 py-2.5 shadow-sm">
            {message.imageUrl && (
              <img 
                src={message.imageUrl} 
                alt="商品图片" 
                className="max-w-full rounded-lg mb-2 max-h-[200px] object-contain"
              />
            )}
            <p className="text-sm">{message.content}</p>
            <p className="text-xs text-blue-200 mt-1 text-right">
              <ClientTime timestamp={message.timestamp} />
            </p>
          </div>
          {/* 用户头像 - 仅纯文本消息显示 */}
          {isPlainText && (
            <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-300 flex items-center justify-center shadow-sm shrink-0 ring-2 ring-white/50">
              {userAvatar ? (
                <img 
                  src={userAvatar} 
                  alt="用户头像" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-4 h-4 text-gray-500" />
              )}
            </div>
          )}
        </div>
      );
    }

    // Agent消息：头像在左侧
    return (
      <div key={message.id} className="flex justify-start items-start gap-2 mb-3">
        {/* Agent头像 - 仅纯文本消息显示 */}
        {isPlainText && (
          <img 
            src="/assets/agent-avatar.png" 
            alt="货小影" 
            className="w-8 h-8 rounded-full object-cover shadow-sm shrink-0 ring-2 ring-white/50"
          />
        )}
        {/* 消息气泡 */}
        <div className="max-w-[72%] bg-blue-50 text-gray-800 rounded-2xl rounded-tl-md px-4 py-2.5 shadow-sm">
          {/* Agent名称标签 - 仅纯文本消息显示 */}
          {isPlainText && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs font-medium text-blue-600">货小影</span>
            </div>
          )}
          
          {/* 内容 */}
          {message.isStreaming && !message.content ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              <span className="text-sm text-gray-500">正在思考...</span>
            </div>
          ) : (
            renderAssistantContent(message)
          )}
          
          <p className="text-xs text-gray-400 mt-2">
            <ClientTime timestamp={message.timestamp} />
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* 全屏背景 */}
      <div className="fixed inset-0 bg-gray-100" />
      
      {/* 悬浮弹窗 */}
      <div 
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col relative"
        style={{
          width: '82vw',
          minWidth: '580px',
          maxWidth: '1200px',
          height: isCollapsed ? '56px' : '88vh',
          minHeight: isCollapsed ? '56px' : '480px',
          maxHeight: isCollapsed ? '56px' : '92vh',
          transition: 'height 0.3s ease',
        }}
      >
        {/* 顶部导航栏 - 固定56px */}
        <div className="h-[56px] bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3">
            <img 
              src="/assets/agent-avatar.png" 
              alt="货小影" 
              className="w-8 h-8 rounded-full object-cover border-2 border-white/30"
            />
            <div className="flex flex-col">
              <span className="text-white font-medium text-sm">货小影</span>
              <span className="text-blue-100 text-xs">带货视频智能助手</span>
            </div>
          </div>
          
          {/* 右侧：用户头像 + 折叠按钮 */}
          <div className="flex items-center gap-3">
            {/* 用户头像 */}
            <UserAvatar
              avatarUrl={userAvatar}
              onUpload={handleAvatarUpload}
              onReset={handleAvatarReset}
              isUploading={isAvatarUploading}
            />
            
            {/* 折叠按钮 */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              title={isCollapsed ? '展开' : '折叠'}
            >
              {isCollapsed ? (
                <ChevronUp className="w-5 h-5 text-white" />
              ) : (
                <ChevronDown className="w-5 h-5 text-white" />
              )}
            </button>
          </div>
        </div>
        
        {/* 中间聊天区 - 弹性高度 */}
        {!isCollapsed && (
          <div 
            ref={scrollAreaRef}
            className="flex-1 min-h-0 bg-gray-100 overflow-y-auto p-4 relative"
            style={{ overflowX: 'hidden' }}
            onScroll={handleScroll}
          >
            {messages.map(renderMessage)}
            
            {/* 加载指示器 */}
            {isLoading && messages[messages.length - 1]?.isStreaming && messages[messages.length - 1]?.content && (
              <div className="flex justify-start mb-3">
                <div className="bg-blue-50 rounded-2xl px-4 py-2 shadow-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                </div>
              </div>
            )}
            
            {/* 滚动到底部悬浮按钮 - 输入框正上方 */}
            {!isAtBottom && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
                <ScrollToBottomButton onClick={scrollToBottom} isAtBottom={isAtBottom} />
              </div>
            )}
          </div>
        )}
        
        {/* 底部输入栏 - 固定70px */}
        {!isCollapsed && (
          <div className="h-[70px] bg-white border-t border-gray-200 flex items-center justify-center px-4 gap-3 shrink-0">
            {/* 上传按钮 */}
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <div className="p-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                <ImageIcon className="w-5 h-5 text-gray-600" />
              </div>
            </label>
            
            {/* 输入框 */}
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="输入消息或上传商品图片..."
              className="flex-1 max-w-[500px] h-[40px] rounded-full border-gray-300 focus:border-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(inputValue);
                }
              }}
              disabled={isLoading}
            />
            
            {/* 发送按钮 */}
            <Button
              size="icon"
              className="w-[40px] h-[40px] rounded-full bg-blue-500 hover:bg-blue-600 shrink-0"
              onClick={() => sendMessage(inputValue)}
              disabled={isLoading || !inputValue.trim()}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </>
  );
}