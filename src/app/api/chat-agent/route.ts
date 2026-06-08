// 问答式带货视频生成 Agent API - 对话式交互

import { NextRequest, NextResponse } from "next/server";
import { HeaderUtils } from "coze-coding-dev-sdk";
import { chatNodeStream } from "@/agent/chat-node";
import { getDefaultState, ChatAgentState, AgentSSEMessage } from "@/agent/chat-state";

// 会话存储（简单实现，生产环境应使用数据库）
const sessions = new Map<string, ChatAgentState>();

// POST 处理对话请求
export async function POST(request: NextRequest) {
  console.log("[Chat Agent API] 收到请求");
  
  const body = await request.json();
  const { sessionId, message, imageUrl, productName, voiceLanguage } = body;
  
  // 获取或创建会话
  let state: ChatAgentState = sessionId ? sessions.get(sessionId) || getDefaultState() : getDefaultState();
  const newSessionId = sessionId || `session_${Date.now()}`;
  
  // 添加用户消息到历史
  const userMessage: { role: "user"; content: string } = {
    role: "user",
    content: message
  };
  
  // 如果有图片，添加图片信息到消息
  if (imageUrl) {
    userMessage.content = `${message}\n\n商品图片链接：${imageUrl}`;
    state.productImageUrl = imageUrl; // 预存储图片 URL
  }
  
  // 如果有商品名称，预存储
  if (productName) {
    state.productName = productName;
  }
  
  // 如果有配音语言，预存储
  if (voiceLanguage) {
    state.voiceLanguage = voiceLanguage;
  }
  
  state.messages = [...state.messages, userMessage];
  
  // 提取请求头
  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  
  const encoder = new TextEncoder();
  
  // 使用 TransformStream 创建持续的 SSE 流
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    }
  });
  
  const writer = transformStream.writable.getWriter();
  
  // 后台处理 generator
  (async () => {
    try {
      const generator = chatNodeStream(state, customHeaders);
      
      for await (const agentMessage of generator) {
        const eventData = JSON.stringify({
          type: agentMessage.type,
          content: agentMessage.content,
          data: agentMessage.data,
          sessionId: newSessionId
        });
        
        await writer.write(encoder.encode(`data: ${eventData}\n\n`));
        
        // 收集状态更新
        if (agentMessage.type === "complete" && agentMessage.data) {
          const result = agentMessage.data as { result?: { data?: Record<string, unknown> } };
          if (result.result?.data) {
            const toolData = result.result.data;
            if (toolData.productImageUrl) state.productImageUrl = toolData.productImageUrl as string;
            if (toolData.productName) state.productName = toolData.productName as string;
            if (toolData.category) state.category = toolData.category as string;
            if (toolData.features) state.features = toolData.features as string[];
            if (toolData.scripts) state.scripts = toolData.scripts as Array<{ id: number; script: string; feature: string; prompt?: string }>;
            if (toolData.currentStage) state.currentStage = toolData.currentStage as ChatAgentState["currentStage"];
          }
        }
        
        // 处理 tool_result 更新状态
        if (agentMessage.type === "tool_result" && agentMessage.data) {
          const toolData = agentMessage.data as Record<string, unknown>;
          const segmentsData = toolData.segments as Array<unknown> | undefined;
          console.log(`[API] tool_result 数据: segments=${segmentsData ? `${segmentsData.length}个` : '无'}`);
          if (toolData.productImageUrl) state.productImageUrl = toolData.productImageUrl as string;
          if (toolData.productName) state.productName = toolData.productName as string;
          if (toolData.features) state.features = toolData.features as string[];
          if (toolData.scripts) state.scripts = toolData.scripts as Array<{ id: number; script: string; feature: string; prompt?: string }>;
          if (toolData.segments) {
            state.segments = toolData.segments as Array<{
              id: number;
              script: string;
              feature: string;
              prompt?: string;
              audioPath?: string;
              audioUrl?: string;
              videoPath?: string;
              videoUrl?: string;
              duration: number;
            }>;
            console.log(`[API] 更新 state.segments: ${state.segments.length} 个片段`);
            if (state.segments.length > 0 && toolData.currentStage) {
              state.currentStage = toolData.currentStage as ChatAgentState["currentStage"];
            }
          }
          if (toolData.finalVideoUrl) {
            state.finalVideoUrl = toolData.finalVideoUrl as string;
            state.currentStage = "done";
          }
          if (toolData.finalVideoPath) state.finalVideoPath = toolData.finalVideoPath as string;
          if (toolData.finalDuration) state.finalDuration = toolData.finalDuration as number;
          if (toolData.subtitleUrl) state.subtitleUrl = toolData.subtitleUrl as string;
          if (toolData.currentStage) state.currentStage = toolData.currentStage as ChatAgentState["currentStage"];
        }
        
        // 处理 wait_feedback 更新状态
        if (agentMessage.type === "wait_feedback" && agentMessage.data?.state) {
          const stateData = agentMessage.data.state as ChatAgentState;
          state.productImageUrl = stateData.productImageUrl;
          state.productName = stateData.productName;
          state.features = stateData.features;
          state.scripts = stateData.scripts;
          state.segments = stateData.segments;
          state.currentStage = stateData.currentStage;
        }
      }
      
      // 保存会话
      sessions.set(newSessionId, state);
      
      // 发送最终状态
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: "state_update",
        sessionId: newSessionId,
        data: {
          productImageUrl: state.productImageUrl,
          productName: state.productName,
          features: state.features,
          scripts: state.scripts,
          segments: state.segments,
          finalVideoUrl: state.finalVideoUrl,
          currentStage: state.currentStage
        }
      })}\n\n`));
      
      await writer.close();
    } catch (error) {
      console.error("[Chat Agent API] 流处理错误:", error);
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify({
          type: "error",
          content: error instanceof Error ? error.message : "处理失败"
        })}\n\n`));
        await writer.close();
      } catch {
        // Writer 已关闭，忽略
      }
    }
  })();
  
  return new Response(transformStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}

// GET 获取会话状态
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  
  if (!sessionId) {
    return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });
  }
  
  const state = sessions.get(sessionId);
  
  if (!state) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }
  
  return NextResponse.json({
    sessionId,
    state: {
      productImageUrl: state.productImageUrl,
      productName: state.productName,
      features: state.features,
      scripts: state.scripts,
      segments: state.segments,
      finalVideoUrl: state.finalVideoUrl,
      currentStage: state.currentStage,
      messages: state.messages
    }
  });
}

// DELETE 清除会话
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  
  if (!sessionId) {
    return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });
  }
  
  sessions.delete(sessionId);
  
  return NextResponse.json({ success: true, message: "会话已清除" });
}