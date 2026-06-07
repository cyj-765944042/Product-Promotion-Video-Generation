'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { getAccessibleUrl } from '@/lib/utils';
import {
  Upload,
  Send,
  Video,
  FileText,
  Download,
  Loader2,
  Image as ImageIcon,
  Sparkles,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Play,
  Pause,
  Volume2,
  VolumeX,
  MessageCircle,
  Bot,
  User,
} from 'lucide-react';

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
  timestamp: string; // ISO string to avoid hydration issues
  imageUrl?: string; // 用户上传的图片 URL
  isStreaming?: boolean;
  state?: Partial<SessionState>; // 每条消息自己的状态数据，避免共享状态导致渲染混乱
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
    audioLocalPath?: string;
    videoLocalPath?: string;
    localVideoPath?: string;  // 本地视频路径（用于播放）
  }>;
  finalVideoUrl?: string;
  finalVideoLocalPath?: string;
  localVideoPath?: string;  // 本地最终视频路径（用于播放）
  finalDuration?: number;
  subtitleUrl?: string;
  currentStage?: 'idle' | 'identifying' | 'product_identified' | 'script_generated' | 'video_generated' | 'composing' | 'done';
}

// 视频播放器组件
function VideoPlayer({
  videoUrl,
  audioUrl,
  script,
  localVideoPath, // 本地视频路径（优先使用）
}: {
  videoUrl?: string;
  audioUrl?: string;
  script: string;
  localVideoPath?: string; // 本地视频路径
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 优先使用本地视频路径，否则使用远程 URL
  const effectiveVideoUrl = localVideoPath || (videoUrl ? getAccessibleUrl(videoUrl) : '');
  const accessibleAudioUrl = audioUrl ? getAccessibleUrl(audioUrl) : '';

  const togglePlay = useCallback(() => {
    if (!videoRef.current || !audioRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      audioRef.current.pause();
    } else {
      videoRef.current.play().catch(() => setVideoError('视频播放失败'));
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleError = useCallback(() => {
    setVideoError('视频加载失败，可能由于网络或权限限制');
    setIsLoading(false);
  }, []);

  const handleCanPlay = useCallback(() => {
    setIsLoading(false);
    setVideoError(null);
  }, []);

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative bg-black rounded-lg overflow-hidden">
      {effectiveVideoUrl ? (
        <video
          ref={videoRef}
          src={effectiveVideoUrl}
          className="w-full aspect-video object-contain"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          onError={handleError}
          onCanPlay={handleCanPlay}
          onClick={togglePlay}
          playsInline
          controls
          preload="auto"
        />
      ) : (
        <div className="w-full aspect-video bg-gray-800 flex items-center justify-center">
          <p className="text-gray-400 text-sm">视频生成中...</p>
        </div>
      )}
      
      {/* 加载状态 */}
      {isLoading && effectiveVideoUrl && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <div className="text-white text-sm">加载视频中...</div>
        </div>
      )}
      
      {/* 错误状态 */}
      {videoError && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 text-sm mb-2">{videoError}</p>
            <a 
              href={effectiveVideoUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-400 text-xs underline hover:text-blue-300"
            >
              点击在新窗口打开视频
            </a>
          </div>
        </div>
      )}
      
      {accessibleAudioUrl && <audio ref={audioRef} src={accessibleAudioUrl} />}

      {/* 字幕 */}
      <div className="absolute bottom-12 left-0 right-0 flex justify-center pointer-events-none">
        <div className="bg-black/70 text-white px-3 py-1 rounded max-w-[80%]">
          <p className="text-sm">{script}</p>
        </div>
      </div>

      {/* 控制栏 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
        <div className="flex items-center gap-2">
          <button onClick={togglePlay} className="text-white p-1">
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={toggleMute} className="text-white p-1">
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={duration}
            value={currentTime}
            onChange={(e) => {
              const time = parseFloat(e.target.value);
              if (videoRef.current && audioRef.current) {
                videoRef.current.currentTime = time;
                audioRef.current.currentTime = time;
              }
            }}
            className="flex-1 h-1 accent-blue-500"
          />
          <span className="text-white text-xs">{formatTime(currentTime)}/{formatTime(duration)}</span>
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
      content: '您好！我是「货小影」，您的专业带货视频智能助手。\n\n我可以帮您：\n1. 📷 上传商品图片，自动识别商品和卖点\n2. ✍️ 分段创作口播文案与画面提示词\n3. 🎬 生成带货视频片段（配音+画面）\n4. 🎞️ 合成成片（字幕+背景音乐）\n\n请上传您的商品图片或描述，开始创作吧！',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [sessionId, setSessionId] = useState<string>();
  const [sessionState, setSessionState] = useState<SessionState>({});
  const [isLoading, setIsLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动滚动
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 发送消息
  const sendMessage = async (content: string, imageUrl?: string) => {
    if (!content.trim() && !imageUrl) return;

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: imageUrl ? `${content}\n[已上传商品图片]` : content,
      timestamp: new Date().toISOString(),
      imageUrl: imageUrl, // 添加图片 URL
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // 创建助手消息占位
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
                  // 过滤掉工具调用格式，只显示有意义的文本
                  const textContent = eventData.content;
                  // 如果是工具调用格式的开始，跳过
                  if (textContent.includes('<tool_call>') || 
                      textContent.match(/^[\s\n]*$/) ||
                      textContent.match(/^[{}\s":,]*$/)) {
                    // 不显示工具调用格式
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

                case 'tool_call':
                  // 不显示工具调用细节
                  break;

                case 'progress':
                  // 显示进度提示（追加到当前消息）
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, content: m.content ? `${m.content}\n${eventData.content}` : eventData.content }
                        : m
                    )
                  );
                  break;

                case 'tool_result':
                  // 显示工具执行结果消息，同时将状态数据绑定到消息
                  const toolData = eventData.data || {};
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            content: m.content ? `${m.content}\n${eventData.content}` : eventData.content,
                            state: { ...m.state, ...toolData }, // 将状态绑定到消息
                          }
                        : m
                    )
                  );
                  // 同时更新全局状态（用于按钮状态判断）
                  setSessionState(prev => ({
                    ...prev,
                    ...toolData,
                  }));
                  break;

                case 'state_update':
                  setSessionId(eventData.sessionId);
                  const stateData = eventData.data || {};
                  // 更新消息状态
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, state: { ...m.state, ...stateData } }
                        : m
                    )
                  );
                  // 更新全局状态
                  setSessionState(prev => ({
                    ...prev,
                    ...stateData,
                  }));
                  break;

                case 'wait_feedback':
                  // 等待用户反馈阶段，更新状态并停止加载
                  const feedbackState = eventData.data?.state || {};
                  // 更新消息状态
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, state: { ...m.state, ...feedbackState } }
                        : m
                    )
                  );
                  // 更新全局状态
                  setSessionState(prev => ({
                    ...prev,
                    ...feedbackState,
                  }));
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, isStreaming: false }
                        : m
                    )
                  );
                  setIsLoading(false);
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
                  break;

                case 'error':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            content: `❌ 错误: ${eventData.content}`,
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
    // 使用消息自己的状态，如果没有则使用空对象（避免旧消息显示新状态）
    const msgState = message.state || {};

    // 如果有最终视频，显示下载按钮
    if (msgState.finalVideoUrl || msgState.localVideoPath) {
      const videoSrc = msgState.localVideoPath || getAccessibleUrl(msgState.finalVideoUrl || '');
      return (
        <div className="space-y-3">
          <p className="text-sm">{message.content}</p>
          <Card className="p-3">
            <video
              src={videoSrc}
              controls
              className="w-full aspect-video rounded-lg mb-3 object-contain"
            />
            <Button className="w-full bg-gradient-to-r from-green-600 to-teal-600">
              <Download className="w-4 h-4 mr-2" />
              下载完整视频
            </Button>
          </Card>
        </div>
      );
    }

    // 如果有视频片段，显示片段卡片 + 交互按钮
    if (msgState.segments && msgState.segments.length > 0) {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-blue-600 font-medium">
            <Video className="w-4 h-4" />
            <span>🎬 已生成 {msgState.segments.length} 个视频片段</span>
          </div>
          <p className="text-sm">{message.content}</p>
          <div className="grid grid-cols-1 gap-4">
            {msgState.segments.map((segment, index) => (
              <Card key={`segment-${segment.id}-${index}`} className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline" className="text-sm">片段 {segment.id}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {segment.localVideoPath ? '✅ 视频已下载' : segment.videoUrl ? '✅ 视频已生成' : '⏳ 视频生成中'}
                  </span>
                </div>
                <div className="w-full">
                  <VideoPlayer
                    videoUrl={segment.videoUrl}
                    audioUrl={segment.audioUrl}
                    script={segment.script}
                    localVideoPath={segment.localVideoPath}
                  />
                </div>
                {/* 单片段重生成按钮 */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full mt-2 text-xs"
                  onClick={() => sendMessage(`请重新生成片段 ${segment.id}`)}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  重生成此片段
                </Button>
              </Card>
            ))}
          </div>
          {/* 确认合成按钮 */}
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              className="bg-gradient-to-r from-green-600 to-teal-600"
              onClick={() => sendMessage("确认片段，请合成最终视频，添加背景音乐")}
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />
              确认合成
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => sendMessage("确认片段，请合成最终视频，不添加背景音乐")}
            >
              <Video className="w-4 h-4 mr-1" />
              无BGM合成
            </Button>
          </div>
        </div>
      );
    }

    // 如果有文案列表，显示文案卡片 + 交互按钮
    if (msgState.scripts && msgState.scripts.length > 0) {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-purple-600 font-medium">
            <FileText className="w-4 h-4" />
            <span>✍️ 已生成 {msgState.scripts.length} 段带货文案</span>
          </div>
          <p className="text-sm">{message.content}</p>
          <div className="space-y-2">
            {msgState.scripts.map((script, index) => (
              <Card key={index} className="p-2">
                <Badge variant="outline" className="mb-2">文案 {script.id || index + 1}</Badge>
                <p className="text-sm">{script.script}</p>
                {script.prompt && (
                  <p className="text-xs text-muted-foreground mt-1">画面: {script.prompt}</p>
                )}
              </Card>
            ))}
          </div>
          {/* 文案确认/驳回按钮 */}
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              className="bg-gradient-to-r from-blue-600 to-purple-600"
              onClick={() => sendMessage("确认文案，请生成视频片段")}
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />
              确认文案
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => sendMessage("驳回文案，请重新生成")}
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              重新生成
            </Button>
          </div>
        </div>
      );
    }

    // 如果有商品信息，显示商品卡片
    if (msgState.productImageUrl || msgState.productName) {
      return (
        <div className="space-y-3">
          <p className="text-sm">{message.content}</p>
          <Card className="p-3">
            <div className="flex items-start gap-3">
              {msgState.productImageUrl && (
                <img 
                  src={msgState.productImageUrl} 
                  alt="商品图片" 
                  className="w-24 h-24 object-cover rounded-lg"
                />
              )}
              <div className="space-y-2">
                {msgState.productName && (
                  <div>
                    <Badge variant="secondary">商品名称</Badge>
                    <p className="text-sm font-medium mt-1">{msgState.productName}</p>
                  </div>
                )}
                {msgState.features && msgState.features.length > 0 && (
                  <div>
                    <Badge variant="secondary">核心卖点</Badge>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {msgState.features.map((feature, index) => (
                        <Badge key={index} variant="outline">{feature}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      );
    }

    // 普通文本消息
    return <div className="text-sm whitespace-pre-wrap">{message.content}</div>;
  };

  // 渲染消息
  const renderMessage = (message: ChatMessage) => {
    const isUser = message.role === 'user';

    return (
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
        <div className={`flex items-start gap-2 max-w-[85%] ${isUser ? 'flex-row-reverse' : ''}`}>
          {/* 头像 */}
          <div className={`p-1 rounded-full shrink-0`}>
            {isUser ? (
              <div className="bg-blue-100 rounded-full p-1.5">
                <User className="w-4 h-4 text-blue-600" />
              </div>
            ) : (
              <img 
                src="/assets/agent-avatar.png" 
                alt="货小影" 
                className="w-10 h-10 rounded-full object-cover"
              />
            )}
          </div>

          {/* 内容 */}
          <div className={`rounded-lg p-3 ${isUser ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
            {message.isStreaming && !message.content && (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">正在思考...</span>
              </div>
            )}

            {isUser ? (
              <div className="space-y-2">
                {message.imageUrl && (
                  <img 
                    src={message.imageUrl} 
                    alt="商品图片" 
                    className="max-w-[200px] rounded-lg"
                  />
                )}
                <div className="text-sm whitespace-pre-wrap">{message.content}</div>
              </div>
            ) : (
              renderAssistantContent(message)
            )}

            {/* 时间 - 仅在客户端渲染 */}
            <div className="text-xs opacity-60 mt-1">
              <ClientTime timestamp={message.timestamp} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  // 当前阶段提示
  const getStageHint = () => {
    switch (sessionState.currentStage) {
      case 'product_identified':
        return '已识别商品，正在生成文案...';
      case 'script_generated':
        return '已生成文案，请确认后生成视频';
      case 'video_generated':
        return '已生成视频片段，请确认后合成最终视频';
      case 'composing':
        return '正在合成最终视频...';
      case 'done':
        return '视频已完成，可以下载使用';
      default:
        return '请上传商品图片开始';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="max-w-4xl mx-auto p-4 py-8">
        {/* 标题 */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <MessageCircle className="w-6 h-6 text-purple-600" />
            <h1 className="text-2xl font-bold text-gray-800">货小影 - 带货视频助手</h1>
          </div>
          <p className="text-gray-500 text-sm">AI Agent 驱动的带货短视频生成工具</p>
        </div>

        {/* 商品信息卡片 */}
        {sessionState.productName && (
          <Card className="mb-4 p-3 bg-white/80 backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {sessionState.productImageUrl && (
                  <img
                    src={sessionState.productImageUrl}
                    alt={sessionState.productName}
                    className="w-12 h-12 object-cover rounded"
                  />
                )}
                <div>
                  <h3 className="font-semibold text-sm">{sessionState.productName}</h3>
                  {sessionState.features && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {sessionState.features.slice(0, 3).map(f => (
                        <Badge key={f} variant="secondary" className="text-xs">{f}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{getStageHint()}</Badge>
                <Button variant="ghost" size="sm" onClick={clearSession}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* 对话区域 */}
        <Card className="bg-white/80 backdrop-blur mb-4">
          <ScrollArea className="h-[600px] p-4">
            <div ref={scrollRef}>
              {messages.map((message, index) => (
                <div key={index}>
                  {renderMessage(message)}
                </div>
              ))}

              {/* 加载提示 */}
              {isLoading && messages[messages.length - 1]?.role === 'user' && (
                <div className="flex justify-start mb-4">
                  <div className="flex items-start gap-2">
                    <div className="p-2 rounded-full bg-purple-100">
                      <Bot className="w-4 h-4 text-purple-600" />
                    </div>
                    <div className="rounded-lg p-3 bg-gray-100">
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                      正在处理...
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* 输入区域 */}
        <Card className="bg-white/80 backdrop-blur p-4">
          <div className="flex gap-2">
            {/* 图片上传 */}
            <div className="relative inline-block">
              <Button variant="outline" className="relative pointer-events-none">
                <ImageIcon className="w-4 h-4 mr-1" />
                上传图片
              </Button>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </div>

            {/* 文本输入 */}
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder="输入您的需求..."
              className="flex-1"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendMessage(inputValue);
                }
              }}
            />

            {/* 发送按钮 */}
            <Button
              onClick={() => sendMessage(inputValue)}
              disabled={isLoading || !inputValue.trim()}
              className="bg-gradient-to-r from-blue-600 to-purple-600"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* 快捷操作 */}
          <div className="flex gap-2 mt-3">
            <span className="text-xs text-gray-500">快捷操作:</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => sendMessage('请生成带货文案')}
              disabled={!sessionState.productName}
            >
              <FileText className="w-3 h-3 mr-1" />
              生成文案
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => sendMessage('请生成视频片段')}
              disabled={!sessionState.scripts?.length}
            >
              <Video className="w-3 h-3 mr-1" />
              生成视频
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => sendMessage('请合成最终视频')}
              disabled={!sessionState.segments?.length}
            >
              <Sparkles className="w-3 h-3 mr-1" />
              合成视频
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}