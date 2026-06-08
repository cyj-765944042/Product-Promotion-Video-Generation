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
  timestamp: string;
  imageUrl?: string;
  isStreaming?: boolean;
  state?: Partial<SessionState>;
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
  }>;
  finalVideoUrl?: string;
  localVideoPath?: string;
  finalDuration?: number;
  currentStage?: 'idle' | 'identifying' | 'product_identified' | 'script_generated' | 'video_generated' | 'composing' | 'done';
}

// 视频播放器组件（16:9固定比例）
function VideoPlayer({
  videoUrl,
  localVideoPath,
}: {
  videoUrl?: string;
  localVideoPath?: string;
}) {
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const effectiveVideoUrl = localVideoPath || (videoUrl ? getAccessibleUrl(videoUrl) : '');

  return (
    <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
      {effectiveVideoUrl ? (
        <video
          src={effectiveVideoUrl}
          className="w-full h-full object-contain"
          controls
          playsInline
          preload="auto"
          onError={() => {
            setVideoError('视频加载失败');
            setIsLoading(false);
          }}
          onCanPlay={() => {
            setIsLoading(false);
            setVideoError(null);
          }}
        />
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

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, []);

  // 自动滚动（新消息时）
  useEffect(() => {
    scrollToBottom();
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
          
          {/* 视频片段网格 */}
          <div className="grid gap-3" style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
          }}>
            {msgState.segments.map(segment => (
              <div key={segment.id} className="bg-white rounded-xl p-2 shadow-sm">
                <Badge variant="outline" className="mb-2 text-xs">片段 {segment.id}</Badge>
                <VideoPlayer
                  videoUrl={segment.videoUrl}
                  localVideoPath={segment.localVideoPath}
                />
                <p className="text-xs text-gray-500 mt-2 line-clamp-2">{segment.script}</p>
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
          
          {/* 文案列表 */}
          <div className="space-y-2">
            {msgState.scripts.map(script => (
              <div key={script.id} className="bg-white rounded-lg p-3 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">文案 {script.id}</Badge>
                  <span className="text-xs text-gray-400">{script.prompt}</span>
                </div>
                <p className="text-sm">{script.script}</p>
              </div>
            ))}
          </div>
          
          {/* 操作按钮 */}
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              className="bg-blue-500 hover:bg-blue-600"
              onClick={() => sendMessage('确认文案，开始生成视频')}
              disabled={isLoading}
            >
              生成视频
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sendMessage('请修改文案内容')}
              disabled={isLoading}
            >
              修改文案
            </Button>
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
  const renderMessage = (message: ChatMessage) => {
    if (message.role === 'user') {
      return (
        <div key={message.id} className="flex justify-end mb-3">
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
        </div>
      );
    }

    return (
      <div key={message.id} className="flex justify-start mb-3">
        <div className="max-w-[72%] bg-blue-50 text-gray-800 rounded-2xl rounded-tl-md px-4 py-2.5 shadow-sm">
          {/* Agent头像 */}
          <div className="flex items-center gap-2 mb-2">
            <img 
              src="/assets/agent-avatar.png" 
              alt="货小影" 
              className="w-6 h-6 rounded-full object-cover"
            />
            <span className="text-xs font-medium text-blue-600">货小影</span>
          </div>
          
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
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
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
        
        {/* 中间聊天区 - 弹性高度 */}
        {!isCollapsed && (
          <div 
            ref={scrollAreaRef}
            className="flex-1 min-h-0 bg-gray-100 overflow-y-auto p-4"
            style={{ overflowX: 'hidden' }}
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