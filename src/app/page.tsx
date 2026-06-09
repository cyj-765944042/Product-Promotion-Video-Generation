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
  Plus,
  Trash2,
  Pencil,
  MessageSquare,
} from 'lucide-react';

// 用户头像本地存储key
const USER_AVATAR_STORAGE_KEY = 'huxiaoying_user_avatar';

// 会话存储key
const SESSIONS_STORAGE_KEY = 'huxiaoying_sessions';

// 后台任务状态类型
interface BackgroundTask {
  sessionId: string; // 会话ID（用于标识任务属于哪个会话）
  abortController: AbortController; // 用于取消请求
  status: 'running' | 'completed' | 'failed' | 'cancelled'; // 任务状态
  startedAt: string; // 开始时间
}

// 会话类型定义
interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  state: SessionState;
  progress: {
    currentStage: number;
    stageName: string;
    estimatedTime?: string;
    segmentStatus: Record<number, 'pending' | 'processing' | 'completed' | 'failed'>;
  };
  createdAt: string;
  updatedAt: string;
  isGenerating?: boolean; // 是否正在生成中（后台任务运行）
  backendSessionId?: string; // 后端会话ID（用于恢复后端状态）
  voiceLanguage?: string; // 配音语言（每个会话独立）
}

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
          : 'bg-white hover:bg-[#7c3aed]/10 text-[#7c3aed] hover:text-[#5b21b6] cursor-pointer'
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

// 配音语言选择器组件
const VOICE_LANGUAGES = [
  { code: 'mandarin', label: '普通话', ttsVoice: 'zh_female_mizai_saturn_bigtts' },
  { code: 'english', label: '英语', ttsVoice: 'zh_female_vv_uranus_bigtts' },
];

function LanguageSelector({
  language,
  onChange,
}: {
  language: string;
  onChange: (lang: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const currentLang = VOICE_LANGUAGES.find(l => l.code === language) || VOICE_LANGUAGES[0];

  const handleSelect = (langCode: string) => {
    onChange(langCode);
    // 语言现在绑定到会话，会话保存时会自动保存到localStorage
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-2 py-1 text-xs text-[#666666] hover:text-[#333333] hover:bg-[#F1F3F5] rounded transition-colors"
      >
        <span className="font-medium">配音语言：</span>
        <span>{currentLang.label}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-[#E5E5E5] rounded-md shadow-lg z-50 min-w-[120px]">
          {VOICE_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleSelect(lang.code)}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-[#F1F3F5] transition-colors ${
                lang.code === language ? 'text-[#B999F3] font-medium bg-[#ECE6F7]' : 'text-[#666666]'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 会话侧边栏组件
function SessionSidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onUpdateSessionVoiceLanguage,
}: {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onUpdateSessionVoiceLanguage: (sessionId: string, lang: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  // 分组会话：今天、最近
  const groupSessions = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todaySessions = sessions.filter(s => new Date(s.createdAt) >= today);
    const recentSessions = sessions.filter(s => new Date(s.createdAt) < today);
    
    return { todaySessions, recentSessions };
  };

  const { todaySessions, recentSessions } = groupSessions();

  const handleStartEdit = (session: Session) => {
    setEditingId(session.id);
    setEditingTitle(session.title);
  };

  const handleSaveEdit = () => {
    if (editingId && editingTitle.trim()) {
      onRenameSession(editingId, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingTitle('');
  };

  const SessionItem = ({ session }: { session: Session }) => {
    const isSelected = session.id === currentSessionId;
    const isEditing = editingId === session.id;

    return (
      <div
        className={`group relative px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200
          ${isSelected 
            ? 'bg-[#ECE6F7] text-[#333333] border border-[#D4C2F6]' 
            : 'hover:bg-[#F1F3F5] text-[#666666]'
          }`}
        onClick={() => !isEditing && onSelectSession(session.id)}
      >
        <div className="flex items-center justify-between">
          {isEditing ? (
            <input
              type="text"
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit();
                if (e.key === 'Escape') handleCancelEdit();
              }}
              className="w-full bg-white text-[#333333] px-2 py-1 rounded text-sm outline-none border border-[#D4C2F6]"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{session.title}</div>
              <div className="flex items-center gap-2 mt-0.5">
                {session.isGenerating && (
                  <span className="text-xs text-[#B999F3] flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    生成中
                  </span>
                )}
                {/* 配音语言标签 - 可点击切换 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const newLang = session.voiceLanguage === 'english' ? 'mandarin' : 'english';
                    onUpdateSessionVoiceLanguage(session.id, newLang);
                  }}
                  className="text-xs px-1.5 py-0.5 rounded bg-[#F1F3F5] text-[#666666] hover:bg-[#ECE6F7] hover:text-[#333333] transition-colors"
                  title="点击切换配音语言"
                >
                  {session.voiceLanguage === 'english' ? '英语' : '普通话'}
                </button>
                <span className="text-xs text-[#999999]">
                  {new Date(session.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          )}

          {/* hover操作图标 */}
          {!isEditing && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartEdit(session);
                }}
                className="p-1 hover:bg-[#F1F3F5] rounded text-[#7A7A7A] hover:text-[#333333]"
                title="重命名"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSession(session.id);
                }}
                className="p-1 hover:bg-red-500/20 rounded text-[#7A7A7A] hover:text-red-500"
                title="删除"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-[260px] h-full bg-gradient-to-b from-[#F5E6D3] to-[#FFFFFF] flex flex-col border-r border-[#E5E5E5]">
      {/* 货小影Logo区域 */}
      <div className="p-4 flex items-center gap-3">
        <img 
          src="/assets/agent-avatar.png" 
          alt="货小影" 
          className="w-12 h-12 rounded-full object-cover border-2 border-[#D4C2F6] shadow-sm"
        />
        <div className="flex flex-col">
          <span className="text-[#333333] font-semibold text-lg">货小影</span>
          <span className="text-[#666666] text-sm">带货视频智能助手</span>
        </div>
      </div>

      {/* 新建对话按钮 */}
      <div className="px-4 pb-4">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg
            bg-[#D4C2F6] hover:bg-[#B999F3] text-[#333333] font-medium
            transition-all duration-200 shadow-sm hover:shadow-md"
        >
          <Plus className="w-4 h-4" />
          新建对话
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-4">
        {/* 今天 */}
        {todaySessions.length > 0 && (
          <div>
            <div className="text-xs text-[#999999] font-medium mb-2 px-1">今天</div>
            <div className="space-y-1">
              {todaySessions.map(session => (
                <SessionItem key={session.id} session={session} />
              ))}
            </div>
          </div>
        )}

        {/* 最近 */}
        {recentSessions.length > 0 && (
          <div>
            <div className="text-xs text-[#999999] font-medium mb-2 px-1">最近</div>
            <div className="space-y-1">
              {recentSessions.map(session => (
                <SessionItem key={session.id} session={session} />
              ))}
            </div>
          </div>
        )}

        {/* 空状态 */}
        {sessions.length === 0 && (
          <div className="text-center text-[#999999] py-8">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">暂无历史对话</p>
          </div>
        )}
      </div>
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
    <div className="bg-white rounded-lg border border-[#E5E5E5] shadow-sm p-4 mb-4">
      {/* 进度条 */}
      <div className="flex items-center gap-2 mb-3">
        {PROGRESS_STAGES.map((stage, idx) => (
          <div key={stage.key} className="flex items-center flex-1">
            {/* 阶段节点 */}
            <div className={`flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300
              ${currentStage >= stage.key 
                ? 'bg-gradient-to-r from-[#B999F3] to-[#D4C2F6] text-white' 
                : 'bg-[#F1F3F5] text-[#999999]'}`}>
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
                ${currentStage >= stage.key ? 'text-[#B999F3]' : 'text-[#999999]'}`}>
                {stage.name}
              </span>
            </div>
            {/* 连接线 */}
            {idx < PROGRESS_STAGES.length - 1 && (
              <div className={`flex-1 h-1 mx-2 rounded transition-all duration-300
                ${currentStage > stage.key ? 'bg-gradient-to-r from-[#B999F3] to-[#D4C2F6]' : 'bg-[#E5E5E5]'}`} />
            )}
          </div>
        ))}
      </div>
      
      {/* 实时状态文字 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[#B999F3]" />
          <span className="text-sm text-[#B999F3] font-medium">{stageName}</span>
        </div>
        {estimatedTime && (
          <span className="text-xs text-[#666666]">预计等待 {estimatedTime}</span>
        )}
      </div>
    </div>
  );
}

// 镜头卡片状态标签组件
function SegmentStatusBadge({ status }: { status: 'pending' | 'processing' | 'completed' | 'failed' }) {
  const statusConfig = {
    pending: { color: 'text-[#999999]', bg: 'bg-[#F1F3F5]', icon: Circle, text: '待处理' },
    processing: { color: 'text-[#B999F3]', bg: 'bg-[#ECE6F7]', icon: Loader2, text: '处理中' },
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
    pending: 'bg-[#ECE6F7] text-[#B999F3] border-2 border-[#D4C2F6]',
    processing: 'bg-[#B999F3] text-white border-2 border-[#D4C2F6]',
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
            ${status === 'completed' ? 'bg-green-300' : 'bg-[#D4C2F6]'}`} />
        )}
      </div>

      {/* 卡片主体 */}
      <div className={`flex-1 bg-white rounded-lg border transition-all duration-200
        ${editingScript || editingPrompt ? 'border-[#D4C2F6] shadow-md' : 'border-[#E5E5E5] shadow-sm group-hover:shadow-md'}
        ${disabled ? 'opacity-70' : ''}`}>
        
        {/* 状态标签栏 */}
        <div className="flex items-center justify-between px-3 py-1 bg-[#F1F3F5] rounded-t-lg border-b border-[#E5E5E5]">
          <span className="text-xs text-[#999999] font-medium">镜头 {index + 1}</span>
          <SegmentStatusBadge status={status} />
        </div>
        
        {/* 上半部分：镜头脚本编辑区 */}
        <div className="p-3 border-b border-[#E5E5E5]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-[#7A7A7A]" />
              <span className="text-xs text-[#666666] font-medium">镜头描述</span>
            </div>
            {!editingPrompt && !disabled && (
              <button
                onClick={() => setEditingPrompt(true)}
                className="text-xs text-[#7A7A7A] hover:text-[#B999F3] transition-colors"
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
                className="w-full p-2 text-sm border border-[#E5E5E5] rounded-md focus:border-[#D4C2F6] focus:ring-1 focus:ring-[#D4C2F6] resize-none"
                rows={4}
                placeholder="输入镜头描述..."
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleCancelPrompt}
                  className="px-2 py-1 text-xs text-[#666666] hover:bg-[#F1F3F5] rounded"
                >
                  取消
                </button>
                <button
                  onClick={handleSavePrompt}
                  className="px-2 py-1 text-xs bg-[#B999F3] text-white hover:bg-[#D4C2F6] rounded"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => !disabled && setEditingPrompt(true)}
              className={`text-xs text-[#666666] ${disabled ? 'cursor-default' : 'cursor-pointer hover:text-[#333333]'}`}
            >
              {script.prompt || '暂无镜头描述'}
            </div>
          )}
        </div>

        {/* 下半部分：口播文案编辑区 */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#666666] font-medium">口播文案</span>
            <div className="flex items-center gap-2">
              {!editingScript && (
                <>
                  <button
                    onClick={() => !disabled && setEditingScript(true)}
                    className={`text-xs ${disabled ? 'text-[#999999] cursor-default' : 'text-[#7A7A7A] hover:text-[#B999F3] transition-colors'}`}
                    disabled={disabled}
                  >
                    编辑
                  </button>
                  <button
                    onClick={onRegenerate}
                    className={`text-xs ${disabled ? 'text-[#999999] cursor-default' : 'text-[#B999F3] hover:text-[#D4C2F6] font-medium'}`}
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
                className="w-full p-2 text-sm font-medium border border-[#E5E5E5] rounded-md focus:border-[#D4C2F6] focus:ring-1 focus:ring-[#D4C2F6] resize-none"
                rows={3}
                placeholder="输入口播文案..."
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleCancelScript}
                  className="px-2 py-1 text-xs text-[#666666] hover:bg-[#F1F3F5] rounded"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveScript}
                  className="px-2 py-1 text-xs bg-[#B999F3] text-white hover:bg-[#D4C2F6] rounded"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm font-medium text-[#333333] line-clamp-3">
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
  const [sessions, setSessions] = useState<Session[]>([]); // 所有会话列表
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null); // 当前会话ID
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sessionId, setSessionId] = useState<string>(); // 后端会话ID
  const [sessionState, setSessionState] = useState<SessionState>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  // isGenerating 改为从当前会话计算，不再使用全局状态
  // const [isGenerating, setIsGenerating] = useState(false);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  // 配音语言：从当前会话获取（每个会话独立）
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

  // 后台任务管理器：存储每个会话的后台任务状态
  const backgroundTasksRef = useRef<Map<string, BackgroundTask>>(new Map());

  // 存储最新的currentSessionId，用于事件处理时获取最新值（不受React状态更新周期影响）
  const currentSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // 从当前会话获取isGenerating状态（每个会话独立）
  const currentSession = sessions.find(s => s.id === currentSessionId);
  const isGenerating = currentSession?.isGenerating || false;
  const voiceLanguage = currentSession?.voiceLanguage || 'mandarin'; // 从当前会话获取配音语言

  // 更新指定会话的配音语言
  const updateSessionVoiceLanguage = useCallback((sessionId: string, lang: string) => {
    setSessions(prev => prev.map(s => 
      s.id === sessionId ? { ...s, voiceLanguage: lang } : s
    ));
  }, []);

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
    // 配音语言现在从会话中获取，不再使用localStorage存储全局设置
    // 初始化会话列表（从localStorage读取）
    const savedSessions = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (savedSessions) {
      try {
        const parsed = JSON.parse(savedSessions) as Session[];
        // 页面刷新后，后台任务已不存在，所有会话的isGenerating应该重置为false
        const sessionsWithResetGenerating = parsed.map(s => ({
          ...s,
          isGenerating: false, // 重置生成状态
        }));
        setSessions(sessionsWithResetGenerating);
        // 如果有会话，选择第一个并加载其数据
        if (sessionsWithResetGenerating.length > 0) {
          const firstSession = sessionsWithResetGenerating[0];
          setCurrentSessionId(firstSession.id);
          setMessages(firstSession.messages);
          setSessionState(firstSession.state);
          setGenerationProgress(firstSession.progress);
          setSessionId(firstSession.backendSessionId);
          // isGenerating 现在从 currentSession 计算，无需单独设置
        }
      } catch (e) {
        console.error('解析会话数据失败:', e);
        // 创建默认会话
        createDefaultSession();
      }
    } else {
      // 没有保存的会话，创建默认会话
      createDefaultSession();
    }
  }, []);

  // 创建默认欢迎会话
  const createDefaultSession = useCallback(() => {
    const defaultSession: Session = {
      id: `session_${Date.now()}`,
      title: '新对话',
      messages: [{
        id: 'welcome',
        role: 'assistant',
        content: '您好！我是「货小影」，您的专业带货视频智能助手。\n\n我可以帮您：\n1. 上传商品图片，自动识别商品和卖点\n2. 分段创作口播文案与画面提示词\n3. 生成带货视频片段\n4. 合成成片\n\n请上传您的商品图片或描述，开始创作吧！',
        timestamp: new Date().toISOString(),
      }],
      state: {},
      progress: {
        currentStage: 0,
        stageName: '',
        segmentStatus: {},
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setSessions([defaultSession]);
    setCurrentSessionId(defaultSession.id);
    setMessages(defaultSession.messages);
    setSessionState({});
    setGenerationProgress({
      currentStage: 0,
      stageName: '',
      segmentStatus: {},
    });
  }, []);

  // 初始化时如果没有会话，创建默认会话
  useEffect(() => {
    if (sessions.length === 0 && !currentSessionId) {
      createDefaultSession();
    }
  }, [sessions.length, currentSessionId, createDefaultSession]);

  // 保存会话列表到localStorage
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    }
  }, [sessions]);

  // 组件卸载时清理后台任务
  useEffect(() => {
    return () => {
      // 取消所有正在运行的后台任务
      backgroundTasksRef.current.forEach((task, sessionId) => {
        if (task.status === 'running') {
          task.abortController.abort();
          task.status = 'cancelled';
          console.log(`已取消会话 ${sessionId} 的后台任务`);
        }
      });
      backgroundTasksRef.current.clear();
    };
  }, []);

  // 新建会话（保存当前会话状态）
  const handleNewSession = useCallback(() => {
    // 保存当前会话状态
    if (currentSessionId) {
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId 
          ? { 
              ...s, 
              messages, 
              state: sessionState, 
              progress: generationProgress, 
              isGenerating, 
              backendSessionId: sessionId,
              updatedAt: new Date().toISOString() 
            }
          : s
      ));
    }
    
    // 使用更唯一的ID生成方式（时间戳 + 随机数）
    const newId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const newSession: Session = {
      id: newId,
      title: '新对话',
      messages: [{
        id: 'welcome',
        role: 'assistant',
        content: '您好！我是「货小影」，您的专业带货视频智能助手。\n\n我可以帮您：\n1. 上传商品图片，自动识别商品和卖点\n2. 分段创作口播文案与画面提示词\n3. 生成带货视频片段\n4. 合成成片\n\n请上传您的商品图片或描述，开始创作吧！',
        timestamp: new Date().toISOString(),
      }],
      state: {},
      progress: {
        currentStage: 0,
        stageName: '',
        segmentStatus: {},
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      voiceLanguage: 'mandarin', // 默认配音语言
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newId);
    setMessages(newSession.messages);
    setSessionState({});
    setGenerationProgress({
      currentStage: 0,
      stageName: '',
      segmentStatus: {},
    });
    setSessionId(undefined);
    // isGenerating 现在从 currentSession 计算，无需单独设置
    setIsLoading(false);
  }, [currentSessionId, messages, sessionState, generationProgress, isGenerating, sessionId]);

  // 切换会话（保存当前会话状态，不中断后台任务）
  const handleSelectSession = useCallback((id: string) => {
    // 保存当前会话状态
    if (currentSessionId) {
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId 
          ? { 
              ...s, 
              messages, 
              state: sessionState, 
              progress: generationProgress, 
              isGenerating, 
              backendSessionId: sessionId,
              updatedAt: new Date().toISOString() 
            }
          : s
      ));
    }
    
    // 加载新会话的状态
    const session = sessions.find(s => s.id === id);
    if (session) {
      setCurrentSessionId(id);
      setMessages(session.messages);
      setSessionState(session.state);
      setGenerationProgress(session.progress);
      setSessionId(session.backendSessionId);
      // isGenerating 现在从 currentSession 计算，无需单独设置
    }
  }, [currentSessionId, sessions, messages, sessionState, generationProgress, isGenerating, sessionId]);

  // 删除会话（取消后台任务）
  const handleDeleteSession = useCallback((id: string) => {
    // 取消该会话的后台任务
    const task = backgroundTasksRef.current.get(id);
    if (task && task.status === 'running') {
      task.abortController.abort();
      task.status = 'cancelled';
      backgroundTasksRef.current.delete(id);
    }
    
    setSessions(prev => {
      const newSessions = prev.filter(s => s.id !== id);
      // 如果删除的是当前会话，切换到第一个或新建
      if (id === currentSessionId) {
        if (newSessions.length > 0) {
          const firstSession = newSessions[0];
          setCurrentSessionId(firstSession.id);
          setMessages(firstSession.messages);
          setSessionState(firstSession.state);
          setGenerationProgress(firstSession.progress);
          setSessionId(firstSession.backendSessionId);
          // isGenerating 现在从 currentSession 计算，无需单独设置
        } else {
          // 没有会话了，新建一个
          handleNewSession();
        }
      }
      // 更新localStorage
      if (newSessions.length > 0) {
        localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(newSessions));
      } else {
        localStorage.removeItem(SESSIONS_STORAGE_KEY);
      }
      return newSessions;
    });
  }, [currentSessionId, handleNewSession]);

  // 重命名会话
  const handleRenameSession = useCallback((id: string, newTitle: string) => {
    setSessions(prev => prev.map(s => 
      s.id === id ? { ...s, title: newTitle, updatedAt: new Date().toISOString() } : s
    ));
  }, []);

  // 更新当前会话数据
  const updateCurrentSession = useCallback((updates: Partial<Session>) => {
    if (currentSessionId) {
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId 
          ? { ...s, ...updates, updatedAt: new Date().toISOString() }
          : s
      ));
    }
  }, [currentSessionId]);

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

  // 发送消息（支持后台执行）
  const sendMessage = async (content: string, imageUrl?: string) => {
    if (!content.trim() && !imageUrl) return;
    if (!currentSessionId) return; // 确保有当前会话ID

    // 获取目标会话的完整状态（从sessions数组中获取，而非当前的sessionState）
    const targetSession = sessions.find(s => s.id === currentSessionId);
    if (!targetSession) return;
    
    // 使用目标会话的后端sessionId和状态
    const targetBackendSessionId = targetSession.backendSessionId;
    const targetProductName = targetSession.state.productName;
    const targetSessionState = targetSession.state;
    const targetVoiceLanguage = targetSession.voiceLanguage || 'mandarin'; // 使用目标会话的配音语言

    // 创建AbortController用于取消请求
    const abortController = new AbortController();
    
    // 存储后台任务状态
    const task: BackgroundTask = {
      sessionId: currentSessionId,
      abortController,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    backgroundTasksRef.current.set(currentSessionId, task);

    const sessionClientId = currentSessionId; // 保存当前会话ID，用于后台更新

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: imageUrl ? '[已上传商品图片]' : content,
      timestamp: new Date().toISOString(),
      imageUrl: imageUrl,
    };
    
    // 只有当前会话是发起请求的会话时，才更新显示的消息列表
    if (currentSessionId === sessionClientId) {
      setMessages(prev => [...prev, userMessage]);
    }
    
    // 同时更新会话数据（用于后台持久化）
    setSessions(prev => prev.map(s => 
      s.id === sessionClientId 
        ? { ...s, messages: [...s.messages, userMessage], updatedAt: new Date().toISOString() }
        : s
    ));
    
    setInputValue('');
    setIsLoading(true);
    
    // 如果发送的是生成视频或合成视频指令，立即设置isGenerating为true（仅更新目标会话）
    if (content === '生成分段视频' || content === '合成完整视频') {
      // 只更新目标会话的isGenerating状态，不影响其他会话
      setSessions(prev => prev.map(s => 
        s.id === sessionClientId 
          ? { ...s, isGenerating: true, updatedAt: new Date().toISOString() }
          : s
      ));
    }

    const assistantMessage: ChatMessage = {
      id: `assistant_${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };
    
    // 只有当前会话是发起请求的会话时，才更新显示的消息列表
    if (currentSessionId === sessionClientId) {
      setMessages(prev => [...prev, assistantMessage]);
    }
    
    // 同时更新会话数据（用于后台持久化）
    setSessions(prev => prev.map(s => 
      s.id === sessionClientId 
        ? { ...s, messages: [...s.messages, assistantMessage], updatedAt: new Date().toISOString() }
        : s
    ));

    try {
      const response = await fetch('/api/chat-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: targetBackendSessionId, // 使用目标会话的后端sessionId
          message: content,
          imageUrl,
          productName: targetProductName, // 使用目标会话的productName
          voiceLanguage: targetVoiceLanguage, // 使用目标会话的配音语言
        }),
        signal: abortController.signal, // 添加AbortController signal
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

              // 核心改动：根据sessionClientId更新对应会话的数据
              // 如果是当前会话，同时更新当前状态
              // 使用currentSessionIdRef.current获取最新的当前会话ID（不受React状态更新周期影响）
              const isCurrentSession = sessionClientId === currentSessionIdRef.current;

              switch (eventData.type) {
                case 'text':
                  const textContent = eventData.content;
                  if (textContent.includes('<tool_call>') || 
                      textContent.match(/^[\s\n]*$/) ||
                      textContent.match(/^[{}\s":,]*$/)) {
                    break;
                  }
                  // 更新会话数据
                  setSessions(prev => prev.map(s => {
                    if (s.id !== sessionClientId) return s;
                    const updatedMessages = s.messages.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, content: m.content + textContent }
                        : m
                    );
                    return { ...s, messages: updatedMessages, updatedAt: new Date().toISOString() };
                  }));
                  // 如果是当前会话，更新当前状态
                  if (isCurrentSession) {
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantMessage.id
                          ? { ...m, content: m.content + textContent }
                          : m
                      )
                    );
                  }
                  break;

                case 'progress':
                  // 更新会话数据
                  setSessions(prev => prev.map(s => {
                    if (s.id !== sessionClientId) return s;
                    const updatedMessages = s.messages.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, content: m.content ? `${m.content}\n${eventData.content}` : eventData.content }
                        : m
                    );
                    return { ...s, messages: updatedMessages, updatedAt: new Date().toISOString() };
                  }));
                  if (isCurrentSession) {
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantMessage.id
                          ? { ...m, content: m.content ? `${m.content}\n${eventData.content}` : eventData.content }
                          : m
                      )
                    );
                  }
                  break;

                case 'tool_result':
                  const toolData = eventData.data || {};
                  // 更新会话数据
                  setSessions(prev => prev.map(s => {
                    if (s.id !== sessionClientId) return s;
                    const updatedMessages = s.messages.map(m =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            content: m.content ? `${m.content}\n${eventData.content}` : eventData.content,
                            state: { ...m.state, ...toolData },
                          }
                        : m
                    );
                    // 自动命名：如果productName首次出现且会话名称是默认的"新对话"，则自动更新为商品名称
                    let newTitle = s.title;
                    if (toolData.productName && (s.title === '新对话' || s.title.startsWith('新对话'))) {
                      newTitle = toolData.productName;
                    }
                    return { ...s, title: newTitle, messages: updatedMessages, state: { ...s.state, ...toolData }, updatedAt: new Date().toISOString() };
                  }));
                  if (isCurrentSession) {
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
                  }
                  break;

                case 'state_update':
                  const newBackendSessionId = eventData.sessionId;
                  const stateData = eventData.data || {};
                  // 更新会话数据（保存后端会话ID）
                  setSessions(prev => prev.map(s => {
                    if (s.id !== sessionClientId) return s;
                    const updatedMessages = s.messages.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, state: { ...m.state, ...stateData } }
                        : m
                    );
                    // 自动命名：如果productName首次出现且会话名称是默认的"新对话"，则自动更新为商品名称
                    let newTitle = s.title;
                    if (stateData.productName && (s.title === '新对话' || s.title.startsWith('新对话'))) {
                      newTitle = stateData.productName;
                    }
                    return { 
                      ...s, 
                      title: newTitle,
                      messages: updatedMessages, 
                      state: { ...s.state, ...stateData },
                      backendSessionId: newBackendSessionId,
                      updatedAt: new Date().toISOString() 
                    };
                  }));
                  if (isCurrentSession) {
                    setSessionId(newBackendSessionId);
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantMessage.id
                          ? { ...m, state: { ...m.state, ...stateData } }
                          : m
                      )
                    );
                    setSessionState(prev => ({ ...prev, ...stateData }));
                  }
                  break;

                case 'wait_feedback':
                  const feedbackState = eventData.data?.state || {};
                  // 更新会话数据
                  setSessions(prev => prev.map(s => {
                    if (s.id !== sessionClientId) return s;
                    const updatedMessages = s.messages.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, state: { ...m.state, ...feedbackState }, isStreaming: false }
                        : m
                    );
                    return { 
                      ...s, 
                      messages: updatedMessages, 
                      state: { ...s.state, ...feedbackState },
                      isGenerating: false,
                      updatedAt: new Date().toISOString() 
                    };
                  }));
                  if (isCurrentSession) {
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantMessage.id
                          ? { ...m, state: { ...m.state, ...feedbackState }, isStreaming: false }
                          : m
                      )
                    );
                    setSessionState(prev => ({ ...prev, ...feedbackState }));
                    setIsLoading(false);
                    // 只更新目标会话的isGenerating状态为false
                    setSessions(prev => prev.map(s => 
                      s.id === sessionClientId 
                        ? { ...s, isGenerating: false, updatedAt: new Date().toISOString() }
                        : s
                    ));
                    setGenerationProgress(prev => ({
                      ...prev,
                      currentStage: 0,
                      stageName: '',
                    }));
                  }
                  // 更新后台任务状态
                  if (backgroundTasksRef.current.has(sessionClientId)) {
                    const currentTask = backgroundTasksRef.current.get(sessionClientId);
                    if (currentTask) {
                      currentTask.status = 'completed';
                    }
                  }
                  break;

                // 视频生成进度事件
                case 'generation_progress':
                  const progressData = eventData.data || {};
                  // 更新会话数据
                  setSessions(prev => prev.map(s => {
                    if (s.id !== sessionClientId) return s;
                    const newProgress = {
                      currentStage: progressData.currentStage || s.progress.currentStage,
                      stageName: progressData.stageName || s.progress.stageName,
                      estimatedTime: progressData.estimatedTime,
                      segmentStatus: progressData.segmentStatus || s.progress.segmentStatus,
                    };
                    return { 
                      ...s, 
                      progress: newProgress,
                      isGenerating: progressData.isGenerating || s.isGenerating,
                      updatedAt: new Date().toISOString() 
                    };
                  }));
                  if (isCurrentSession) {
                    setGenerationProgress(prev => ({
                      currentStage: progressData.currentStage || prev.currentStage,
                      stageName: progressData.stageName || prev.stageName,
                      estimatedTime: progressData.estimatedTime,
                      segmentStatus: progressData.segmentStatus || prev.segmentStatus,
                    }));
                    // isGenerating 已在 setSessions 中更新，无需单独设置
                  }
                  break;

                // 镜头片段状态更新
                case 'segment_status':
                  const segId = eventData.segmentId;
                  const segStatus = eventData.status;
                  // 更新会话数据
                  setSessions(prev => prev.map(s => {
                    if (s.id !== sessionClientId) return s;
                    const newSegmentStatus = {
                      ...s.progress.segmentStatus,
                      [segId]: segStatus,
                    };
                    return { 
                      ...s, 
                      progress: { ...s.progress, segmentStatus: newSegmentStatus },
                      updatedAt: new Date().toISOString() 
                    };
                  }));
                  if (isCurrentSession) {
                    setGenerationProgress(prev => ({
                      ...prev,
                      segmentStatus: {
                        ...prev.segmentStatus,
                        [segId]: segStatus,
                      },
                    }));
                  }
                  break;

                // 镜头片段视频URL更新 - 视频生成完成后实时显示
                case 'segment_video':
                  const videoSegId = eventData.content?.segmentId;
                  const videoSegUrl = eventData.content?.videoUrl;
                  const videoSegAudioUrl = eventData.content?.audioUrl;
                  const videoSegDuration = eventData.content?.duration;
                  console.log(`收到片段视频事件: segmentId=${videoSegId}, videoUrl=${videoSegUrl}`);
                  // 更新会话数据中的segments数组
                  setSessions(prev => prev.map(s => {
                    if (s.id !== sessionClientId) return s;
                    // 找到最后一条助手消息并更新其segments（从后往前查找）
                    let lastAssistantIdx = -1;
                    for (let i = s.messages.length - 1; i >= 0; i--) {
                      if (s.messages[i].role === 'assistant') {
                        lastAssistantIdx = i;
                        break;
                      }
                    }
                    if (lastAssistantIdx === -1) return s;
                    const targetMsg = s.messages[lastAssistantIdx];
                    const existingSegments = targetMsg.state?.segments || [];
                    // 更新对应segment的videoUrl
                    const updatedSegments = existingSegments.map(seg => {
                      if (seg.id === videoSegId) {
                        return {
                          ...seg,
                          videoUrl: videoSegUrl,
                          audioUrl: videoSegAudioUrl,
                          duration: videoSegDuration,
                        };
                      }
                      return seg;
                    });
                    // 如果该segment不存在，添加一个新的
                    if (!existingSegments.find(seg => seg.id === videoSegId)) {
                      updatedSegments.push({
                        id: videoSegId,
                        videoUrl: videoSegUrl,
                        audioUrl: videoSegAudioUrl,
                        duration: videoSegDuration,
                        script: eventData.content?.script || '',
                        prompt: '', // 视频生成时没有prompt，后续会由state_update补充
                      });
                    }
                    const updatedMessages = s.messages.map((m, idx) =>
                      idx === lastAssistantIdx
                        ? { ...m, state: { ...m.state, segments: updatedSegments } }
                        : m
                    );
                    return { 
                      ...s, 
                      messages: updatedMessages,
                      state: { ...s.state, segments: updatedSegments },
                      updatedAt: new Date().toISOString() 
                    };
                  }));
                  if (isCurrentSession) {
                    setMessages(prev => {
                      const lastAssistantIdx = prev.findIndex(m => m.role === 'assistant');
                      if (lastAssistantIdx === -1) return prev;
                      const targetMsg = prev[lastAssistantIdx];
                      const existingSegments = targetMsg.state?.segments || [];
                      const updatedSegments = existingSegments.map(seg => {
                        if (seg.id === videoSegId) {
                          return {
                            ...seg,
                            videoUrl: videoSegUrl,
                            audioUrl: videoSegAudioUrl,
                            duration: videoSegDuration,
                          };
                        }
                        return seg;
                      });
                      if (!existingSegments.find(seg => seg.id === videoSegId)) {
                        updatedSegments.push({
                          id: videoSegId,
                          videoUrl: videoSegUrl,
                          audioUrl: videoSegAudioUrl,
                          duration: videoSegDuration,
                          script: eventData.content?.script || '',
                          prompt: '', // 视频生成时没有prompt，后续会由state_update补充
                        });
                      }
                      return prev.map((m, idx) =>
                        idx === lastAssistantIdx
                          ? { ...m, state: { ...m.state, segments: updatedSegments } }
                          : m
                      );
                    });
                    setSessionState(prev => {
                      const existingSegments = prev.segments || [];
                      const updatedSegments = existingSegments.map(seg => {
                        if (seg.id === videoSegId) {
                          return {
                            ...seg,
                            videoUrl: videoSegUrl,
                            audioUrl: videoSegAudioUrl,
                            duration: videoSegDuration,
                          };
                        }
                        return seg;
                      });
                      if (!existingSegments.find(seg => seg.id === videoSegId)) {
                        updatedSegments.push({
                          id: videoSegId,
                          videoUrl: videoSegUrl,
                          audioUrl: videoSegAudioUrl,
                          duration: videoSegDuration,
                          script: eventData.content?.script || '',
                          prompt: '', // 视频生成时没有prompt，后续会由state_update补充
                        });
                      }
                      return { ...prev, segments: updatedSegments };
                    });
                  }
                  break;

                case 'complete':
                  // 更新会话数据
                  setSessions(prev => prev.map(s => {
                    if (s.id !== sessionClientId) return s;
                    const updatedMessages = s.messages.map(m =>
                      m.id === assistantMessage.id
                        ? { ...m, isStreaming: false }
                        : m
                    );
                    return { 
                      ...s, 
                      messages: updatedMessages, 
                      isGenerating: false,
                      progress: { ...s.progress, currentStage: 0, stageName: '' },
                      updatedAt: new Date().toISOString() 
                    };
                  }));
                  if (isCurrentSession) {
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantMessage.id
                          ? { ...m, isStreaming: false }
                          : m
                      )
                    );
                    setIsLoading(false);
                    // isGenerating 已在 setSessions 中更新为false，无需单独设置
                    setGenerationProgress(prev => ({
                      ...prev,
                      currentStage: 0,
                      stageName: '',
                    }));
                  }
                  // 更新后台任务状态
                  if (backgroundTasksRef.current.has(sessionClientId)) {
                    const currentTask = backgroundTasksRef.current.get(sessionClientId);
                    if (currentTask) {
                      currentTask.status = 'completed';
                    }
                  }
                  break;

                case 'error':
                  // 更新会话数据
                  setSessions(prev => prev.map(s => {
                    if (s.id !== sessionClientId) return s;
                    const updatedMessages = s.messages.map(m =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            content: `错误: ${eventData.content}`,
                            isStreaming: false,
                          }
                        : m
                    );
                    return { 
                      ...s, 
                      messages: updatedMessages, 
                      isGenerating: false,
                      updatedAt: new Date().toISOString() 
                    };
                  }));
                  if (isCurrentSession) {
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
                  }
                  // 更新后台任务状态
                  if (backgroundTasksRef.current.has(sessionClientId)) {
                    const currentTask = backgroundTasksRef.current.get(sessionClientId);
                    if (currentTask) {
                      currentTask.status = 'failed';
                    }
                  }
                  break;
              }
            } catch {
              // 解析失败，忽略
            }
          }
        }
      }
    } catch (error) {
      // 如果是主动取消，不显示错误
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('请求已取消');
        return;
      }
      
      console.error('发送消息失败:', error);
      
      // 更新会话数据
      setSessions(prev => prev.map(s => {
        if (s.id !== sessionClientId) return s;
        const updatedMessages = s.messages.map(m =>
          m.id === assistantMessage.id
            ? {
                ...m,
                content: `抱歉，处理时出现错误：${error instanceof Error ? error.message : '未知错误'}`,
                isStreaming: false,
              }
            : m
        );
        return { 
          ...s, 
          messages: updatedMessages, 
          isGenerating: false,
          updatedAt: new Date().toISOString() 
        };
      }));
      
      // 使用ref获取最新的当前会话ID（不受React状态更新周期影响）
      if (sessionClientId === currentSessionIdRef.current) {
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
      
      // 更新后台任务状态
      if (backgroundTasksRef.current.has(sessionClientId)) {
        const currentTask = backgroundTasksRef.current.get(sessionClientId);
        if (currentTask) {
          currentTask.status = 'failed';
        }
      }
    }
  };

  // 上传图片
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      console.log('没有选择文件');
      return;
    }

    console.log('开始上传图片:', file.name, file.type, file.size);
    const formData = new FormData();
    formData.append('file', file);

    try {
      setIsLoading(true); // 显示加载状态
      const response = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData,
      });

      console.log('上传响应状态:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('上传失败:', errorData);
        throw new Error(errorData.error || '上传失败');
      }

      const data = await response.json();
      console.log('上传成功，imageUrl:', data.imageUrl);
      
      // 显示上传成功提示
      setIsLoading(false);
      sendMessage('请帮我分析这张商品图片，识别商品信息并提取卖点', data.imageUrl);
    } catch (error) {
      setIsLoading(false);
      console.error('上传图片失败:', error);
      alert(`上传图片失败: ${error instanceof Error ? error.message : '请重试'}`);
    }
    
    // 清空input，允许再次选择同一文件
    e.target.value = '';
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
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#B999F3] text-white rounded-lg text-sm hover:bg-[#D4C2F6] transition-colors"
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
                  <Badge variant="secondary" className="bg-[#ECE6F7] text-[#333333]">商品</Badge>
                  <span className="font-medium text-sm">{msgState.productName}</span>
                </div>
                {msgState.features && msgState.features.length > 0 && (
                  <div className="text-xs text-[#666666]">
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
                <div className="p-3 bg-[#F1F3F5]">
                  <Badge variant="outline" className="mb-2 text-xs border-[#D4C2F6] text-[#B999F3]">片段 {segment.id}</Badge>
                  <p className="text-sm text-[#333333] mt-1 line-clamp-2 leading-relaxed">{segment.script}</p>
                </div>
              </div>
            ))}
          </div>
          
          {/* 操作按钮 */}
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              className="bg-[#B999F3] hover:bg-[#D4C2F6]"
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
                  <Badge variant="secondary" className="bg-[#ECE6F7] text-[#B999F3]">商品</Badge>
                  <span className="font-medium text-sm">{msgState.productName}</span>
                </div>
                {msgState.features && msgState.features.length > 0 && (
                  <div className="text-xs text-[#666666]">
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
          <div className="text-xs text-[#666666] mb-3 p-2 bg-[#ECE6F7] rounded-lg">
            📹 以下是为你生成的连续镜头，可直接修改镜头描述和口播文案，调整顺序或单独重制某一镜头，再生成完整视频
          </div>
          
          {/* 镜头序列卡片 - 左侧流程线 + 纵向排列 */}
          <div className="relative pl-8">
            {/* 左侧垂直流程线 */}
            <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-[#D4C2F6]" />
            {/* 流程节点 */}
            {msgState.scripts.map((script, index) => (
              <div key={script.id} className="relative mb-4 last:mb-0">
                {/* 左侧节点圆点 */}
                <div className="absolute -left-5 top-4 w-3 h-3 rounded-full bg-[#B999F3] border-2 border-white shadow" />
                
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
          <div className="mt-4 p-3 bg-white rounded-lg shadow-sm border border-[#E5E5E5]">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#666666]">
                {isGenerating ? '正在生成中，请稍候...' : 
                  msgState.currentStage === 'video_generated' 
                    ? '分段视频已生成，点击合成完整视频' 
                    : '确认所有镜头内容后，点击生成分段视频'}
              </span>
              <Button
                size="sm"
                className="bg-[#B999F3] hover:bg-[#D4C2F6] text-white"
                onClick={() => sendMessage(
                  msgState.currentStage === 'video_generated' 
                    ? '[COMPOSE_VIDEO] 请将所有分段视频合成为完整视频，添加背景音乐和字幕。' 
                    : '[GENERATE_SEGMENTS] 请根据文案生成分段视频，每个分段包含配音和画面。'
                )}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    生成中...
                  </>
                ) : (
                  msgState.currentStage === 'video_generated' 
                    ? '🎬 合成完整视频' 
                    : '🎥 生成分段视频'
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
                <Badge variant="secondary" className="bg-[#ECE6F7] text-[#B999F3]">商品</Badge>
                <span className="font-medium text-sm">{msgState.productName}</span>
              </div>
              {msgState.features && msgState.features.length > 0 && (
                <div className="text-xs text-[#666666]">
                  <span className="font-medium">核心卖点：</span>
                  {msgState.features.join('、')}
                </div>
              )}
            </CardContent>
          </Card>
          <Button
            size="sm"
            className="bg-[#B999F3] hover:bg-[#D4C2F6] text-white"
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
          <div className="max-w-[72%] bg-[#B999F3] text-white rounded-2xl rounded-tr-md px-4 py-2.5 shadow-sm">
            {message.imageUrl && (
              <img 
                src={message.imageUrl} 
                alt="商品图片" 
                className="max-w-full rounded-lg mb-2 max-h-[200px] object-contain"
              />
            )}
            <p className="text-sm">{message.content}</p>
            <p className="text-xs text-[#D4C2F6] mt-1 text-right">
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
        <div className="max-w-[72%] bg-[#F1F3F5] text-[#333333] rounded-2xl rounded-tl-md px-4 py-2.5 shadow-sm">
          {/* Agent名称标签 - 仅纯文本消息显示 */}
          {isPlainText && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs font-medium text-[#B999F3]">货小影</span>
            </div>
          )}
          
          {/* 内容 */}
          {message.isStreaming && !message.content ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#B999F3]" />
              <span className="text-sm text-[#666666]">正在思考...</span>
            </div>
          ) : (
            renderAssistantContent(message)
          )}
          
          <p className="text-xs text-[#999999] mt-2">
            <ClientTime timestamp={message.timestamp} />
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* 全屏背景 */}
      <div className="fixed inset-0 bg-[#F8F7F5]" />
      
      {/* 左右分栏布局 */}
      <div 
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-lg overflow-hidden flex"
        style={{
          width: 'calc(82vw + 260px)',
          minWidth: '840px',
          maxWidth: '1460px',
          height: isCollapsed ? '56px' : '88vh',
          minHeight: isCollapsed ? '56px' : '480px',
          maxHeight: isCollapsed ? '56px' : '92vh',
          transition: 'height 0.3s ease',
        }}
      >
        {/* 左侧会话侧边栏 - 260px宽 */}
        {!isCollapsed && (
          <SessionSidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            onUpdateSessionVoiceLanguage={updateSessionVoiceLanguage}
          />
        )}
        
        {/* 右侧聊天窗口 */}
        <div className="flex-1 flex flex-col" style={{ width: isCollapsed ? '100%' : 'calc(100% - 260px)' }}>
          {/* 顶部导航栏 - 固定56px */}
          <div className="h-[56px] bg-gradient-to-r from-[#F5E6D3] to-[#FFFFFF] flex items-center justify-between px-4 shrink-0 border-b border-[#E5E5E5]">
            {/* 折叠时显示货小影logo */}
            {isCollapsed && (
              <div className="flex items-center gap-3">
                <img 
                  src="/assets/agent-avatar.png" 
                  alt="货小影" 
                  className="w-12 h-12 rounded-full object-cover border-2 border-[#D4C2F6] shadow-sm"
                />
                <div className="flex flex-col">
                  <span className="text-[#333333] font-semibold text-lg">货小影</span>
                  <span className="text-[#666666] text-sm">带货视频智能助手</span>
                </div>
              </div>
            )}
            {/* 非折叠时左侧留空 */}
            {!isCollapsed && <div />}
            
            {/* 用户头像 + 折叠按钮 */}
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
                className="p-2 hover:bg-[#F1F3F5] rounded-lg transition-colors"
                title={isCollapsed ? '展开' : '折叠'}
              >
                {isCollapsed ? (
                  <ChevronUp className="w-5 h-5 text-[#7A7A7A]" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-[#7A7A7A]" />
                )}
              </button>
            </div>
          </div>
          
          {/* 中间聊天区 - 弹性高度 */}
          {!isCollapsed && (
            <div 
              ref={scrollAreaRef}
              className="flex-1 min-h-0 bg-[#F8F7F5] overflow-y-auto p-4 relative"
              style={{ overflowX: 'hidden' }}
              onScroll={handleScroll}
            >
              {messages.map(renderMessage)}
              
              {/* 加载指示器 */}
              {isLoading && messages[messages.length - 1]?.isStreaming && messages[messages.length - 1]?.content && (
                <div className="flex justify-start mb-3">
                  <div className="bg-[#F1F3F5] rounded-2xl px-4 py-2 shadow-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-[#B999F3]" />
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* 底部输入栏 - 固定70px */}
          {!isCollapsed && (
            <div className="h-[70px] bg-white border-t border-[#E5E5E5] flex items-center justify-center px-4 gap-3 shrink-0 relative">
              {/* 滚动到底部按钮 - 输入框正上方 */}
              {!isAtBottom && (
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-20">
                  <ScrollToBottomButton onClick={scrollToBottom} isAtBottom={isAtBottom} />
                </div>
              )}
              
              {/* 上传按钮 */}
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <div className="p-2.5 bg-[#F1F3F5] hover:bg-[#ECE6F7] rounded-lg transition-colors">
                  <ImageIcon className="w-5 h-5 text-[#7A7A7A]" />
                </div>
              </label>
              
              {/* 输入框 */}
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="输入消息或上传商品图片..."
                className="flex-1 max-w-[500px] h-[40px] rounded-full border-[#E5E5E5] focus:border-[#D4C2F6] focus:ring-[#D4C2F6]"
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
                className="w-[40px] h-[40px] rounded-full shrink-0 bg-[#B999F3] hover:bg-[#D4C2F6] text-white"
                onClick={() => sendMessage(inputValue)}
                disabled={isLoading || !inputValue.trim()}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}