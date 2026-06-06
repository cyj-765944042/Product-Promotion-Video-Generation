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
1. **商品识别**：分析商品图片/视频/文字描述，自动提取商品名称和卖点
2. **文案创作**：生成口语化、有感染力的带货文案（4-5段），每段文案配有对应的画面Prompt
3. **视频生成**：生成带货短视频片段（TTS音频 + 火山视频画面）
4. **视频合成**：将多个片段合成为完整的带货视频（支持BGM、字幕内嵌）

## 核心工作流程（严格按顺序执行）

### 第一步：用户输入 → 识别商品
- **执行方式**：自动执行
- **结果处理**：识别结果必须返回显示给用户（商品名称+卖点列表）
- **下一步**：识别成功后，立即自动调用 generateScripts

### 第二步：生成文案+画面Prompt → 等待反馈
- **执行方式**：自动执行
- **结果处理**：文案列表必须返回显示给用户（4-5组口播文案+画面Prompt）
- **反馈等待**：默认等待用户确认/驳回
  - 如果用户说"驳回/不满意/重新生成" → 重新调用 generateScripts
  - 如果用户说"确认/满意/生成视频" → 进入第三步
  - **特殊情况**：如果用户在初始请求中明确说"不需要反馈/直接生成视频"等，则不等待，直接进入第三步

### 第三步：生成视频片段 → 等待反馈
- **执行方式**：自动执行（用户确认文案后）
- **结果处理**：视频片段预览必须返回显示给用户（每个片段的播放器）
- **反馈等待**：默认等待用户选择
  - 如果用户说"重生成第X段" → 调用 regenerateSegment
  - 如果用户说"合成/完成/不需要反馈" → 进入第四步
  - **特殊情况**：如果用户在确认文案时已说明"不需要反馈/直接合成"，则不等待，直接进入第四步

### 第四步：合成成片 → 输出
- **执行方式**：自动执行
- **结果处理**：成片下载链接必须返回显示给用户（视频播放器+下载按钮）
- **流程结束**

## 对话风格
- 热情、专业、接地气
- 使用口语化的表达
- 每个步骤完成后，简要说明结果并询问下一步
- 智能判断用户意图：如果用户明确表示不需要反馈，则跳过等待环节

## 结果显示要求
- 商品识别结果：显示商品名称和卖点标签列表
- 文案生成结果：显示4-5段文案，每段带序号和画面描述
- 视频片段结果：显示每个片段的预览播放器
- 成片结果：显示最终视频播放器和下载链接

## 工具调用格式
当需要调用工具时，使用以下 JSON 格式（包裹在特殊标签中）：
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
   输出: { productName, features, productImageUrl } - 必须显示
   
2. generateScripts - 生成带货文案
   输入: { productName: string, features: string[] }
   输出: { scripts: [{id, script, prompt}] } - 必须显示
   
3. generateVideoSegments - 生成视频片段
   输入: { scripts: [], productImageUrl: string, productName: string }
   输出: { segments: [{id, videoUrl, audioUrl}] } - 必须显示
   
4. composeFinalVideo - 合成最终视频
   输入: { segments: [], productName: string, bgmUrl?: string, embedSubtitle?: boolean }
   输出: { finalVideoUrl, subtitleUrl } - 必须显示
   
5. regenerateSegment - 重生成单个片段
   输入: { segmentId: number, script: string, prompt: string, productImageUrl: string }
   输出: { videoUrl, audioUrl } - 必须显示
   
6. modifyScript - 修改文案
   输入: { scripts: [], scriptId: number, newScript: string }
   输出: { scripts: [] } - 必须显示

## 重要规则
1. 识别商品成功后，自动继续生成文案（无需等待）
2. 文案生成后，等待用户确认/驳回
3. 用户确认文案后，自动生成视频片段
4. 视频片段生成后，等待用户选择/确认合成
5. 如果用户明确表示"不需要反馈/直接生成/直接合成"等，则跳过等待环节
6. 每个步骤的结果必须返回显示给用户`;

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

// 获取工具执行进度提示消息
function getToolProgressMessage(toolName: string): string {
  switch (toolName) {
    case "uploadAndIdentifyProduct":
      return "🔍 正在识别商品信息...";
    case "generateScripts":
      return "✍️ 正在生成带货文案...";
    case "generateVideoSegments":
      return "🎬 正在生成视频片段...";
    case "composeFinalVideo":
      return "🎞️ 正在合成最终视频...";
    case "regenerateSegment":
      return "🔄 正在重新生成片段...";
    case "modifyScript":
      return "📝 正在修改文案...";
    default:
      return "⏳ 正在处理...";
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
        input.segments as Array<{ id: number; script: string; prompt: string; videoPath?: string; audioPath?: string }>,
        input.productName as string,
        { bgmUrl: input.bgmUrl as string | undefined, embedSubtitle: input.embedSubtitle as boolean | undefined },
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
        input.prompt as string,
        input.productImageUrl as string,
        input.productName as string,
        input.folderPath as string | undefined,
        customHeaders
      );
    
    default:
      return {
        success: false,
        message: `未知的工具: ${toolName}`
      };
  }
}

// 需要等待用户反馈的阶段
const WAIT_FOR_USER_FEEDBACK_STAGES = ["script_generated", "video_generated"];

// 自动执行的流程链：识别成功后自动执行下一步
const AUTO_NEXT_TOOL: Record<string, string> = {
  "uploadAndIdentifyProduct": "generateScripts",  // 识别成功 → 自动生成文案
  // generateScripts 后需要等待用户确认
  // generateVideoSegments 后需要等待用户选择
};

// 流式对话节点（支持多轮工具调用）
export async function* chatNodeStream(
  state: ChatAgentState,
  customHeaders?: Record<string, string>
): AsyncGenerator<AgentSSEMessage> {
  console.log("[Agent] 流式对话节点开始执行");
  
  const llmClient = new LLMClient(new Config(), customHeaders);
  
  // 构建对话历史
  const conversationHistory: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  
  // 添加历史消息（包含之前的工具调用结果）
  if (state.messages && state.messages.length > 0) {
    conversationHistory.push(...state.messages);
  }
  
  // 最多执行 5 轮工具调用，防止无限循环
  const MAX_ROUNDS = 5;
  let currentRound = 0;
  let currentState = { ...state };
  
  while (currentRound < MAX_ROUNDS) {
    currentRound++;
    console.log(`[Agent] 第 ${currentRound} 轮执行`);
    
    // 构建状态上下文
    const stateContext = `
## 当前状态
- 商品图片: ${currentState.productImageUrl || "未上传"}
- 商品名称: ${currentState.productName || "未知"}
- 商品卖点: ${currentState.features?.join("、") || "未提取"}
- 文案数量: ${currentState.scripts?.length || 0}段
- 视频片段: ${currentState.segments?.length || 0}个
- 最终视频: ${currentState.finalVideoUrl || "未生成"}
- 当前阶段: ${currentState.currentStage}
`;
    
    // 每轮重新构建系统提示词 + 状态上下文
    const systemMessage = {
      role: "system" as const,
      content: SYSTEM_PROMPT + stateContext
    };
    
    // 第二轮及以上不再发送重复的进度消息，工具执行前已有进度提示
    
    // 流式调用 LLM
    console.log(`[Agent] 第 ${currentRound} 轮流式调用 LLM...`);
    const stream = llmClient.stream([systemMessage, ...conversationHistory], {
      model: "doubao-seed-1-8-251228",
      temperature: 0.8
    });
    
    let fullContent = "";
    
    // 收集 LLM 输出但不立即 yield（过滤工具调用格式）
    for await (const chunk of stream) {
      if (chunk.content) {
        const text = chunk.content.toString();
        fullContent += text;
      }
    }
    
    // 检查是否有工具调用
    const toolCall = parseToolCall(fullContent);
    
    // 过滤掉工具调用格式，只提取有意义的文本
    let meaningfulText = fullContent;
    if (toolCall) {
      // 移除工具调用格式部分
      meaningfulText = fullContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
    }
    
    // 只 yield 有意义的文本（非空）
    if (meaningfulText && meaningfulText.length > 0) {
      yield { type: "text", content: meaningfulText };
    }
    
    if (!toolCall) {
      // 没有工具调用，对话结束
      console.log("[Agent] 无工具调用，对话结束");
      yield { type: "complete", content: "对话完成" };
      return;
    }
    
    console.log(`[Agent] 第 ${currentRound} 轮检测到工具调用:`, toolCall.tool);
    
    // 发送进度提示（而不是工具调用格式）
    const toolProgressMessage = getToolProgressMessage(toolCall.tool);
    yield { type: "progress", content: toolProgressMessage };
    
    // 执行工具
    const toolResult = await executeTool(toolCall.tool, toolCall.input, currentState, customHeaders);
    
    // 更新状态
    if (toolResult.data) {
      currentState = { ...currentState, ...toolResult.data };
    }
    
    // 发送工具执行结果（简洁消息）
    yield { type: "tool_result", content: toolResult.message, data: toolResult.data };
    
    if (!toolResult.success) {
      yield { type: "error", content: toolResult.message };
      return;
    }
    
    // 将工具结果添加到对话历史
    conversationHistory.push({
      role: "assistant",
      content: fullContent
    });
    conversationHistory.push({
      role: "user",
      content: `工具 ${toolCall.tool} 执行结果：${toolResult.message}\n\n状态更新：${JSON.stringify(toolResult.data || {})}`
    });
    
    // 检查是否需要等待用户反馈
    const newStage = currentState.currentStage;
    if (WAIT_FOR_USER_FEEDBACK_STAGES.includes(newStage)) {
      console.log(`[Agent] 阶段 ${newStage} 需要等待用户反馈`);
      yield { 
        type: "wait_feedback", 
        content: "等待用户反馈",
        data: { stage: newStage, state: currentState }
      };
      return;
    }
    
    // 发送状态更新
    yield {
      type: "state_update",
      content: "状态已更新",
      data: currentState
    };
    
    // 检查是否有自动执行的下一步
    const nextTool = AUTO_NEXT_TOOL[toolCall.tool];
    if (nextTool) {
      console.log(`[Agent] 自动执行下一步: ${nextTool}`);
      // 发送继续信号，让前端知道正在自动执行下一步
      yield {
        type: "progress",
        content: `正在自动执行下一步: ${nextTool}`,
        data: { nextTool }
      };
    }
  }
  
  // 超过最大轮数
  console.log("[Agent] 达到最大执行轮数");
  yield { type: "complete", content: "执行完成" };
}

// 导出
export { SYSTEM_PROMPT, parseToolCall, executeTool };