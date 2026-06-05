// 问答式带货视频生成 Agent - 工具定义

import { LLMClient, Config, TTSClient, VideoGenerationClient, HeaderUtils, S3Storage } from "coze-coding-dev-sdk";
import axios from "axios";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

// 环境变量
const TTS_SPEAKER = process.env.TTS_SPEAKER || "zh_female_tianmei";
const VIDEO_MODEL_EP = process.env.VIDEO_MODEL_EP || "ep-20260514120705-pqv86";
const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_BASE_URL = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";

// TTS Client
const ttsClient = new TTSClient(new Config());

// Video Client
const videoGenConfig = ARK_API_KEY ? new Config({
  apiKey: ARK_API_KEY,
  baseUrl: ARK_BASE_URL,
}) : new Config({ timeout: 180000 });
const videoClient = new VideoGenerationClient(videoGenConfig);

// 工具结果类型
export interface ToolResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

// 上传到对象存储
async function uploadToStorage(buffer: Buffer, storagePath: string, contentType: string): Promise<string> {
  const storage = new S3Storage({
    endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
    accessKey: '',
    secretKey: '',
    bucketName: process.env.COZE_BUCKET_NAME,
    region: 'cn-beijing',
  });
  
  const fileKey = await storage.uploadFile({
    fileContent: buffer,
    fileName: storagePath,
    contentType,
  });
  
  return await storage.generatePresignedUrl({
    key: fileKey,
    expireTime: 86400 * 7,
  });
}

// 1. 上传商品图片并识别工具
export async function uploadAndIdentifyProduct(
  imageUrl: string,
  productName?: string,
  customHeaders?: Record<string, string>
): Promise<ToolResult> {
  try {
    console.log("[Tool] 上传商品图片:", imageUrl);
    
    // 下载图片并上传到对象存储
    const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const imageBuffer = Buffer.from(imageResponse.data);
    
    // 生成文件名
    const timestamp = Date.now();
    const fileName = `product_${timestamp}.jpg`;
    const storagePath = `products/${fileName}`;
    
    // 上传到对象存储
    const uploadedUrl = await uploadToStorage(imageBuffer, storagePath, "image/jpeg");
    console.log("[Tool] 图片上传成功:", uploadedUrl);
    
    // 使用 LLM 识别商品信息
    const llmClient = new LLMClient(new Config(), customHeaders);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any = [
      {
        role: "user",
        content: [
          { type: "text", text: `请识别这张图片中的商品信息。${productName ? `商品名称可能是：${productName}` : ""} 请返回 JSON 格式的商品信息，包含：
1. productName: 商品名称
2. category: 商品类别
3. features: 商品特点数组（3-5个卖点）

返回格式示例：
{"productName": "高景观婴儿推车", "category": "母婴用品", "features": ["牛津布材质", "合金钢骨架", "可坐可躺", "高景观设计", "减震避震"]}` },
          { type: "image_url", image_url: { url: uploadedUrl, detail: "high" } }
        ]
      }
    ];
    
    const response = await llmClient.invoke(messages, { model: "doubao-seed-1-8-251228", temperature: 0.7 });
    
    // 解析 JSON
    let productInfo;
    try {
      // 提取 JSON 部分
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        productInfo = JSON.parse(jsonMatch[0]);
      } else {
        productInfo = {
          productName: productName || "商品",
          category: "未知",
          features: ["优质材质", "精工细作", "性价比高"]
        };
      }
    } catch {
      productInfo = {
        productName: productName || "商品",
        category: "未知",
        features: ["优质材质", "精工细作", "性价比高"]
      };
    }
    
    return {
      success: true,
      message: `商品识别成功！这是 ${productInfo.productName}，我为您提取了以下卖点：${productInfo.features.join("、")}`,
      data: {
        productImageUrl: uploadedUrl,
        productName: productInfo.productName,
        category: productInfo.category,
        features: productInfo.features
      }
    };
  } catch (error) {
    console.error("[Tool] 上传识别失败:", error);
    return {
      success: false,
      message: `商品识别失败：${error instanceof Error ? error.message : "未知错误"}`
    };
  }
}

// 2. 生成带货文案工具
export async function generateScripts(
  productName: string,
  features: string[],
  customHeaders?: Record<string, string>
): Promise<ToolResult> {
  try {
    console.log("[Tool] 生成带货文案:", productName);
    
    const llmClient = new LLMClient(new Config(), customHeaders);
    
    const prompt = `你是一位专业的带货主播文案创作专家。请为以下商品生成4段带货短视频文案，每段约15-20字，风格口语化、接地气、有感染力。

商品名称：${productName}
商品卖点：${features.join("、")}

要求：
1. 每段文案要突出一个不同的卖点
2. 语言要口语化，像主播在说话
3. 要有感染力，能吸引观众
4. 每段文案后标注该段主要突出的卖点

返回 JSON 数组格式：
[
  {"id": 1, "script": "文案内容", "feature": "突出的卖点"},
  {"id": 2, "script": "文案内容", "feature": "突出的卖点"},
  {"id": 3, "script": "文案内容", "feature": "突出的卖点"},
  {"id": 4, "script": "文案内容", "feature": "突出的卖点"}
]`;

    const response = await llmClient.invoke(
      [{ role: "user", content: prompt }],
      { model: "doubao-seed-1-8-251228", temperature: 0.9 }
    );
    
    // 解析 JSON
    let scripts;
    try {
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        scripts = JSON.parse(jsonMatch[0]);
      } else {
        // 默认文案
        scripts = features.slice(0, 4).map((f, i) => ({
          id: i + 1,
          script: `${productName}太棒了！${f}`,
          feature: f
        }));
      }
    } catch {
      scripts = features.slice(0, 4).map((f, i) => ({
        id: i + 1,
        script: `${productName}太棒了！${f}`,
        feature: f
      }));
    }
    
    const scriptsText = scripts.map((s: { id: number; script: string }) => `第${s.id}段：${s.script}`).join("\n");
    
    return {
      success: true,
      message: `我为您生成了4段带货文案：\n${scriptsText}\n\n您可以修改任何一段，或者直接开始生成视频！`,
      data: { scripts }
    };
  } catch (error) {
    console.error("[Tool] 生成文案失败:", error);
    return {
      success: false,
      message: `生成文案失败：${error instanceof Error ? error.message : "未知错误"}`
    };
  }
}

// 3. 生成视频片段工具（单个片段）
async function generateSingleSegment(
  script: string,
  productImageUrl: string,
  productName: string,
  outputDir: string,
  segmentId: number
): Promise<{ audioPath: string; videoPath: string; duration: number }> {
  console.log(`[Tool] 生成片段 ${segmentId}:`, script);
  
  // 确保 audio 和 video 目录存在
  const audioDir = path.join(outputDir, "audio");
  const videoDir = path.join(outputDir, "video");
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
  
  // 生成 TTS
  const timestamp = Date.now();
  const audioFileName = `audio_${segmentId}_${timestamp}.mp3`;
  const audioPath = path.join(audioDir, audioFileName);
  
  const ttsResponse = await ttsClient.synthesize({
    uid: `user_${timestamp}`,
    text: script,
    speaker: TTS_SPEAKER,
    audioFormat: 'mp3'
  });
  
  // 下载音频文件
  const audioData = await axios.get(ttsResponse.audioUri, { responseType: 'arraybuffer' });
  fs.writeFileSync(audioPath, audioData.data);
  
  console.log(`[Tool] 片段 ${segmentId}: TTS 完成`);
  
  // 获取音频时长
  const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`);
  const audioDuration = parseFloat(stdout.trim());
  const videoDuration = Math.ceil(audioDuration);
  
  // 生成视频
  const videoFileName = `video_${segmentId}_${timestamp}.mp4`;
  const videoPath = path.join(videoDir, videoFileName);
  
  const prompt = `生成带货视频画面：商品 ${productName} 的展示，画面要精美、专业、吸引人。文案：${script}`;
  
  const content = {
    prompt,
    image_url: productImageUrl
  };
  
  // 使用 SDK 生成视频
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const videoResult = await videoClient.videoGeneration(content as any, {
    model: VIDEO_MODEL_EP,
    duration: videoDuration,
    ratio: "16:9"
  });
  
  // 下载视频（SDK 返回 videoUrl）
  if (videoResult.videoUrl) {
    const videoData = await axios.get(videoResult.videoUrl, { responseType: 'arraybuffer' });
    fs.writeFileSync(videoPath, videoData.data);
  }
  
  console.log(`[Tool] 片段 ${segmentId}: 视频完成`);
  
  return { audioPath, videoPath, duration: videoDuration };
}

// 4. 批量生成视频片段工具
export async function generateVideoSegments(
  scripts: Array<{ id: number; script: string; feature: string }>,
  productImageUrl: string,
  productName: string,
  customHeaders?: Record<string, string>
): Promise<ToolResult> {
  try {
    console.log("[Tool] 生成视频片段:", scripts.length, "个");
    
    // 创建输出目录
    const workspacePath = process.env.COZE_WORKSPACE_PATH || "/workspace/projects";
    const timestamp = Date.now();
    const safeName = productName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
    const outputDir = path.join(workspacePath, "public", `${safeName}_${timestamp}`);
    
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    // 并行生成所有片段
    const segmentPromises = scripts.map((scriptItem, index) =>
      generateSingleSegment(
        scriptItem.script,
        productImageUrl,
        productName,
        outputDir,
        index + 1
      )
    );
    
    const segmentResults = await Promise.all(segmentPromises);
    
    // 构建片段数据
    const segments = scripts.map((scriptItem, index) => ({
      id: scriptItem.id,
      script: scriptItem.script,
      feature: scriptItem.feature,
      audioPath: segmentResults[index].audioPath,
      audioUrl: segmentResults[index].audioPath.replace(workspacePath + "/public", ""),
      videoPath: segmentResults[index].videoPath,
      videoUrl: segmentResults[index].videoPath.replace(workspacePath + "/public", ""),
      duration: segmentResults[index].duration
    }));
    
    return {
      success: true,
      message: `成功生成了 ${segments.length} 个视频片段！每个片段都包含音频和视频。现在可以合成最终视频了。`,
      data: {
        segments,
        outputDir
      }
    };
  } catch (error) {
    console.error("[Tool] 生成片段失败:", error);
    return {
      success: false,
      message: `生成视频片段失败：${error instanceof Error ? error.message : "未知错误"}`
    };
  }
}

// 5. 合成最终视频工具
export async function composeFinalVideo(
  segments: Array<{
    id: number;
    audioPath?: string;
    videoPath?: string;
    duration: number;
  }>,
  outputDir: string,
  productName: string
): Promise<ToolResult> {
  try {
    console.log("[Tool] 合成最终视频:", segments.length, "个片段");
    
    // 过滤有完整路径的片段
    const validSegments = segments.filter(s => s.audioPath && s.videoPath);
    
    if (validSegments.length === 0) {
      return {
        success: false,
        message: "没有有效的视频片段可以合成"
      };
    }
    
    // 1. 合并每个片段的音频和视频
    const mergedVideos: string[] = [];
    
    for (const segment of validSegments) {
      if (!segment.audioPath || !segment.videoPath) continue;
      
      const mergedPath = path.join(outputDir, `merged_${segment.id}.mp4`);
      await execAsync(
        `ffmpeg -y -i "${segment.videoPath}" -i "${segment.audioPath}" -c:v copy -c:a aac -shortest "${mergedPath}"`
      );
      mergedVideos.push(mergedPath);
      console.log(`[Tool] 片段 ${segment.id} 合并完成`);
    }
    
    // 2. 拼接所有片段
    const concatListPath = path.join(outputDir, "concat_list.txt");
    const concatContent = mergedVideos.map(v => `file '${v}'`).join("\n");
    fs.writeFileSync(concatListPath, concatContent);
    
    const finalVideoPath = path.join(outputDir, "final_video.mp4");
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${finalVideoPath}"`
    );
    
    // 获取最终视频时长
    const { stdout: durationOutput } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalVideoPath}"`
    );
    const finalDuration = parseFloat(durationOutput.trim());
    
    // 构建访问 URL
    const workspacePath = process.env.COZE_WORKSPACE_PATH || "/workspace/projects";
    const finalVideoUrl = finalVideoPath.replace(workspacePath + "/public", "");
    
    console.log("[Tool] 最终视频合成完成:", finalVideoPath);
    
    return {
      success: true,
      message: `带货视频合成完成！时长 ${Math.round(finalDuration)} 秒，包含 ${validSegments.length} 个片段。您可以直接下载使用！`,
      data: {
        finalVideoPath,
        finalVideoUrl,
        finalDuration,
        segments: validSegments
      }
    };
  } catch (error) {
    console.error("[Tool] 合成失败:", error);
    return {
      success: false,
      message: `视频合成失败：${error instanceof Error ? error.message : "未知错误"}`
    };
  }
}

// 6. 修改文案工具
export function modifyScript(
  scripts: Array<{ id: number; script: string; feature: string }>,
  scriptId: number,
  newScript: string
): ToolResult {
  try {
    console.log("[Tool] 修改文案:", scriptId);
    
    const updatedScripts = scripts.map(s => 
      s.id === scriptId ? { ...s, script: newScript } : s
    );
    
    return {
      success: true,
      message: `第 ${scriptId} 段文案已更新为："${newScript}"`,
      data: { scripts: updatedScripts }
    };
  } catch (error) {
    return {
      success: false,
      message: `修改文案失败：${error instanceof Error ? error.message : "未知错误"}`
    };
  }
}

// 7. 重新生成单个视频片段工具
export async function regenerateSegment(
  script: string,
  productImageUrl: string,
  productName: string,
  outputDir: string,
  segmentId: number
): Promise<ToolResult> {
  try {
    console.log("[Tool] 重新生成片段:", segmentId);
    
    const result = await generateSingleSegment(script, productImageUrl, productName, outputDir, segmentId);
    
    const workspacePath = process.env.COZE_WORKSPACE_PATH || "/workspace/projects";
    
    return {
      success: true,
      message: `第 ${segmentId} 段视频已重新生成！`,
      data: {
        segment: {
          id: segmentId,
          audioPath: result.audioPath,
          audioUrl: result.audioPath.replace(workspacePath + "/public", ""),
          videoPath: result.videoPath,
          videoUrl: result.videoPath.replace(workspacePath + "/public", ""),
          duration: result.duration
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `重新生成失败：${error instanceof Error ? error.message : "未知错误"}`
    };
  }
}