// 问答式带货视频生成 Agent - 状态定义

// Agent 状态接口
export interface ChatAgentState {
  // 对话历史
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  
  // 商品信息
  productImageUrl?: string;
  productName?: string;
  category?: string;
  features: string[];
  
  // 文案信息
  scripts: Array<{ id: number; script: string; feature: string }>;
  
  // 视频片段
  segments: Array<{
    id: number;
    script: string;
    feature: string;
    audioPath?: string;
    audioUrl?: string;
    videoPath?: string;
    videoUrl?: string;
    duration: number;
  }>;
  
  // 输出目录
  outputDir?: string;
  
  // 最终视频
  finalVideoUrl?: string;
  finalVideoPath?: string;
  finalDuration?: number;
  
  // 当前阶段
  currentStage: "chat" | "upload" | "scripts" | "segments" | "compose" | "done";
  
  // 错误信息
  error?: string;
}

// 工具结果类型
export interface ToolResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

// Agent 消息类型（用于 SSE）
export interface AgentSSEMessage {
  type: "text" | "tool_call" | "tool_result" | "progress" | "state_update" | "complete" | "error";
  content: string;
  data?: Record<string, unknown>;
  sessionId?: string;
}

// 默认状态
export function getDefaultState(): ChatAgentState {
  return {
    messages: [],
    features: [],
    scripts: [],
    segments: [],
    currentStage: "chat"
  };
}