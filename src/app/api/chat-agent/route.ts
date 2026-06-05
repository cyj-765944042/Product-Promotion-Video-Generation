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
  const { sessionId, message, imageUrl, productName } = body;
  
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
  
  state.messages = [...state.messages, userMessage];
  
  // 提取请求头
  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  
  // 创建 SSE 流
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 使用流式对话节点
        const generator = chatNodeStream(state, customHeaders);
        
        for await (const agentMessage of generator) {
          // 发送消息
          const eventData = JSON.stringify({
            type: agentMessage.type,
            content: agentMessage.content,
            data: agentMessage.data,
            sessionId: newSessionId
          });
          controller.enqueue(encoder.encode(`data: ${eventData}\n\n`));
          
          // 收集状态更新
          if (agentMessage.type === "complete" && agentMessage.data) {
            const result = agentMessage.data as { result?: { data?: Record<string, unknown> } };
            if (result.result?.data) {
              const toolData = result.result.data;
              if (toolData.productImageUrl) state.productImageUrl = toolData.productImageUrl as string;
              if (toolData.productName) state.productName = toolData.productName as string;
              if (toolData.category) state.category = toolData.category as string;
              if (toolData.features) state.features = toolData.features as string[];
              if (toolData.scripts) state.scripts = toolData.scripts as Array<{ id: number; script: string; feature: string }>;
              if (toolData.segments) {
                state.segments = toolData.segments as Array<{
                  id: number;
                  script: string;
                  feature: string;
                  audioPath?: string;
                  audioUrl?: string;
                  videoPath?: string;
                  videoUrl?: string;
                  duration: number;
                }>;
                // 更新当前阶段
                if (state.segments.length > 0) {
                  state.currentStage = "segments";
                }
              }
              if (toolData.outputDir) state.outputDir = toolData.outputDir as string;
              if (toolData.finalVideoUrl) {
                state.finalVideoUrl = toolData.finalVideoUrl as string;
                state.currentStage = "done";
              }
              if (toolData.finalVideoPath) state.finalVideoPath = toolData.finalVideoPath as string;
              if (toolData.finalDuration) state.finalDuration = toolData.finalDuration as number;
            }
          }
        }
        
        // 保存会话
        sessions.set(newSessionId, state);
        
        // 发送最终状态
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: "state_update",
          sessionId: newSessionId,
          state: {
            productImageUrl: state.productImageUrl,
            productName: state.productName,
            features: state.features,
            scripts: state.scripts,
            segments: state.segments,
            finalVideoUrl: state.finalVideoUrl,
            currentStage: state.currentStage
          }
        })}\n\n`));
        
        controller.close();
      } catch (error) {
        console.error("[Chat Agent API] 流处理错误:", error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: "error",
          content: error instanceof Error ? error.message : "处理失败"
        })}\n\n`));
        controller.close();
      }
    }
  });
  
  return new Response(stream, {
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