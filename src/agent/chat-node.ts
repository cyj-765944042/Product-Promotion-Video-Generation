// 问答式带货视频生成 Agent - 对话节点

import { LLMClient, Config } from "coze-coding-dev-sdk";
import {
  uploadAndIdentifyProduct,
  generateScripts,
  generateVideoSegments,
  composeFinalVideo,
  modifyScript,
  regenerateSegment,
  ToolResult
} from "./tools";
import type { ChatAgentState, AgentSSEMessage } from "./chat-state";

// 系统提示词 - 定义 Agent 的角色和能力
const SYSTEM_PROMPT = `你是"带货视频小助手"，一位专精于带货短视频生成的 AI Agent。

## 你的能力
1. **商品识别**：分析商品图片，自动提取商品名称和卖点
2. **文案创作**：生成口语化、有感染力的带货文案
3. **视频生成**：生成带货短视频，包含音频和画面
4. **视频合成**：将多个片段合成为完整的带货视频

## 工作流程
用户可以按照以下流程与你互动：
1. 上传商品图片 → 你识别商品并提取卖点
2. 确认/修改商品信息 → 你生成带货文案
3. 确认/修改文案 → 你生成视频片段
4. 确认片段 → 你合成最终视频

## 对话风格
- 烿情、专业、接地气
- 使用口语化的表达
- 主动引导用户完成流程
- 在每个阶段询问用户是否满意，是否需要修改

## 工具调用格式
当需要调用工具时，使用以下 JSON 格式：
<tool_call>
{
  "tool": "工具名称",
  "input": {
    "参数名": "参数值"
  }
}
</tool_call>

## 可用工具
1. uploadAndIdentifyProduct - 上传图片并识别商品
   输入: { imageUrl: string, productName?: string }
   
2. generateScripts - 生成带货文案
   输入: { productName: string, features: string[] }
   
3. generateVideoSegments - 生成视频片段
   输入: { scripts: [], productImageUrl: string, productName: string }
   
4. composeFinalVideo - 合成最终视频
   输入: { segments: [], outputDir: string, productName: string }
   
5. modifyScript - 修改文案
   输入: { scripts: [], scriptId: number, newScript: string }
   
6. regenerateSegment - 重新生成片段
   输入: { script: string, productImageUrl: string, productName: string, outputDir: string, segmentId: number }

## 重要规则
1. 每次只调用一个工具
2. 工具调用后等待结果再继续对话
3. 如果用户表示不满意，主动提供修改建议
4. 完成一个阶段后，询问是否继续下一阶段`;

// 解析工具调用
function parseToolCall(content: string): { tool: string; input: Record<string, unknown> } | null {
  const toolCallMatch = content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
  if (!toolCallMatch) return null;
  
  try {
    const parsed = JSON.parse(toolCallMatch[1]);
    return parsed;
  } catch {
    return null;
  }
}

// 执行工具
async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  state: ChatAgentState,
  customHeaders?: Record<string, string>
): Promise<ToolResult> {
  console.log(`[Agent] 执行工具: ${toolName}`, input);
  
  switch (toolName) {
    case "uploadAndIdentifyProduct":
      return await uploadAndIdentifyProduct(
        input.imageUrl as string,
        input.productName as string | undefined,
        customHeaders
      );
    
    case "generateScripts":
      return await generateScripts(
        input.productName as string,
        input.features as string[],
        input.productImageUrl as string | undefined,
        customHeaders
      );
    
    case "generateVideoSegments":
      return await generateVideoSegments(
        state.scripts || input.scripts,
        input.productImageUrl as string,
        input.productName as string,
        customHeaders
      );
    
    case "composeFinalVideo":
      return await composeFinalVideo(
        input.segments as Array<{ id: number; script: string; videoPath?: string; audioPath?: string }>,
        input.productName as string,
        customHeaders
      );
    
    case "modifyScript":
      return modifyScript(
        input.scriptId as number,
        input.newScript as string,
        input.productName as string,
        input.features as string[],
        customHeaders
      );
    
    case "regenerateSegment":
      return await regenerateSegment(
        input.segmentId as number,
        input.script as string,
        input.productImageUrl as string,
        input.productName as string,
        customHeaders
      );
    
    default:
      return {
        success: false,
        message: `未知的工具: ${toolName}`
      };
  }
}

// 流式对话节点
export async function* chatNodeStream(
  state: ChatAgentState,
  customHeaders?: Record<string, string>
): AsyncGenerator<AgentSSEMessage> {
  console.log("[Agent] 流式对话节点开始执行");
  
  const llmClient = new LLMClient(new Config(), customHeaders);
  
  // 构建对话历史
  const conversationHistory: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  
  // 添加系统提示词
  const stateContext = `
## 当前状态
- 商品图片: ${state.productImageUrl || "未上传"}
- 商品名称: ${state.productName || "未知"}
- 商品卖点: ${state.features?.join("、") || "未提取"}
- 文案数量: ${state.scripts?.length || 0}段
- 视频片段: ${state.segments?.length || 0}个
- 最终视频: ${state.finalVideoUrl || "未生成"}
- 当前阶段: ${state.currentStage}
`;
  
  conversationHistory.push({
    role: "system",
    content: SYSTEM_PROMPT + stateContext
  });
  
  // 添加历史消息
  if (state.messages && state.messages.length > 0) {
    conversationHistory.push(...state.messages);
  }
  
  // 流式调用 LLM
  console.log("[Agent] 流式调用 LLM...");
  const stream = llmClient.stream(conversationHistory, {
    model: "doubao-seed-1-8-251228",
    temperature: 0.8
  });
  
  let fullContent = "";
  
  for await (const chunk of stream) {
    if (chunk.content) {
      const text = chunk.content.toString();
      fullContent += text;
      yield { type: "text", content: text };
    }
  }
  
  // 检查是否有工具调用
  const toolCall = parseToolCall(fullContent);
  
  if (toolCall) {
    console.log("[Agent] 检测到工具调用:", toolCall.tool);
    yield { type: "tool_call", content: JSON.stringify(toolCall), data: toolCall };
    
    // 执行工具
    const toolResult = await executeTool(toolCall.tool, toolCall.input, state, customHeaders);
    
    yield { type: "tool_result", content: toolResult.message, data: toolResult.data };
    
    if (toolResult.success) {
      yield { 
        type: "complete", 
        content: "工具执行完成", 
        data: { tool: toolCall.tool, result: toolResult }
      };
    } else {
      yield { type: "error", content: toolResult.message };
    }
  } else {
    // 没有工具调用，直接完成
    yield { type: "complete", content: "对话完成" };
  }
}

// 导出
export { SYSTEM_PROMPT, parseToolCall, executeTool };