/**
 * 视频片段生成节点
 * 为每个脚本片段生成 TTS 音频和视频
 */

import { AgentStateType, Step, VideoSegment } from "../state";
import fs from "fs";
import path from "path";
import axios from "axios";
import { exec } from "child_process";
import { promisify } from "util";
import { LLMClient, Config } from "coze-coding-dev-sdk";

const execAsync = promisify(exec);

// 视频生成 API 配置
const VIDEO_API_URL = "https://ark.cn-beijing.volces.com/api/v3/videos/generations";
const VIDEO_MODEL = "Doubao-Seedance-1.5-pro";
const VIDEO_EP = "ep-20260514120705-pqv86";
const VIDEO_API_KEY = "ark-1249de72-68c5-4737-8777-789f626d0a3b-c7bc9";

// TTS API 配置
const TTS_API_URL = "https://ark.cn-beijing.volces.com/api/v3/tts";
const TTS_MODEL = "doubao_tts_1";
const TTS_EP = "ep-2025051401";

// 任务缓存（避免重复创建）
const taskCache = new Map<string, { taskId: string; createdAt: number }>();

/**
 * 生成单个片段的音频和视频
 */
async function generateSegment(
  segment: VideoSegment,
  index: number,
  state: AgentStateType
): Promise<VideoSegment> {
  const workDir = state.workDir;
  const imageUrl = state.productImageUrl;
  
  console.log(`[Agent] 开始生成片段 ${index + 1}: ${segment.script}`);
  
  try {
    // 1. 生成 TTS 音频
    console.log(`[Agent] 片段 ${index + 1}: 开始生成 TTS`);
    
    const ttsResponse = await axios.post(
      `${TTS_API_URL}?model=${TTS_MODEL}&endpoint_id=${TTS_EP}`,
      {
        text: segment.script,
        voice_type: "zh_female_qingxinwenrou",
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VIDEO_API_KEY}`,
        },
        responseType: "arraybuffer",
      }
    );
    
    const audioFileName = `audio_${index + 1}_${Date.now()}.mp3`;
    const audioPath = path.join(workDir, "audio", audioFileName);
    fs.writeFileSync(audioPath, ttsResponse.data);
    
    // 获取音频时长
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    );
    const audioDuration = parseFloat(stdout.trim()) || 5;
    
    console.log(`[Agent] 片段 ${index + 1}: TTS 完成，时长 ${audioDuration}s`);
    
    // 2. 创建视频生成任务
    console.log(`[Agent] 片段 ${index + 1}: 开始创建视频任务`);
    
    // 检查缓存
    const cacheKey = `${state.taskId}_${index}`;
    let videoTaskId: string;
    
    if (taskCache.has(cacheKey)) {
      videoTaskId = taskCache.get(cacheKey)!.taskId;
    } else {
      const videoResponse = await axios.post(
        VIDEO_API_URL,
        {
          model: VIDEO_MODEL,
          endpoint_id: VIDEO_EP,
          content: [
            { type: "text", text: segment.prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
          disable_watermark: true,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${VIDEO_API_KEY}`,
          },
        }
      );
      
      videoTaskId = videoResponse.data.data.task_id;
      taskCache.set(cacheKey, { taskId: videoTaskId, createdAt: Date.now() });
    }
    
    // 3. 等待视频生成完成（带重试）
    console.log(`[Agent] 片段 ${index + 1}: 等待视频生成`);
    
    let videoUrl: string | null = null;
    let retryCount = 0;
    const maxRetries = 60; // 最多等待 5 分钟
    const retryDelay = 5000; // 每次等待 5 秒
    
    while (!videoUrl && retryCount < maxRetries) {
      const statusResponse = await axios.get(
        `${VIDEO_API_URL}/${videoTaskId}`,
        {
          headers: {
            Authorization: `Bearer ${VIDEO_API_KEY}`,
          },
        }
      );
      
      const status = statusResponse.data.data.status;
      
      if (status === "SUCCESS") {
        videoUrl = statusResponse.data.data.video_url;
        break;
      } else if (status === "FAILED") {
        throw new Error(`视频生成失败: ${statusResponse.data.data.error}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      retryCount++;
    }
    
    if (!videoUrl) {
      throw new Error("视频生成超时");
    }
    
    // 4. 下载视频
    console.log(`[Agent] 片段 ${index + 1}: 下载视频`);
    
    const videoResponse = await axios.get(videoUrl, { responseType: "arraybuffer" });
    const videoFileName = `video_${index + 1}_${Date.now()}.mp4`;
    const videoPath = path.join(workDir, "video", videoFileName);
    fs.writeFileSync(videoPath, videoResponse.data);
    
    console.log(`[Agent] 片段 ${index + 1}: 生成完成`);
    
    return {
      ...segment,
      audioUrl: `/api/file?path=${audioPath}`,
      audioLocalPath: audioPath,
      audioDuration,
      videoUrl: `/api/file?path=${videoPath}`,
      videoLocalPath: videoPath,
      videoDuration: audioDuration,
      isGenerating: false,
    };
  } catch (error) {
    console.error(`[Agent] 片段 ${index + 1}: 生成失败`, error);
    return {
      ...segment,
      isGenerating: false,
      error: String(error),
    };
  }
}

/**
 * 视频片段生成节点
 * 并发生成所有片段
 */
export async function generateSegmentsNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  console.log("[Agent] 视频片段生成节点开始执行");
  
  const segments = state.segments || [];
  
  console.log(`[Agent] 当前 segments 状态:`, segments.map(s => ({
    id: s.id,
    script: s.script?.substring(0, 20),
    isSelected: s.isSelected,
    hasVideo: !!s.videoLocalPath,
  })));
  
  if (segments.length === 0) {
    return {
      errors: [...state.errors, "没有脚本片段需要生成"],
      currentStep: Step.ERROR,
    };
  }
  
  // 并发生成所有片段（最多5个并发）
  const batchSize = 5;
  const updatedSegments: VideoSegment[] = [];
  
  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((seg, idx) => generateSegment(seg, i + idx, state))
    );
    updatedSegments.push(...results);
  }
  
  console.log(`[Agent] 所有片段生成完成`);
  
  console.log(`[Agent] 生成后的 segments 状态:`, updatedSegments.map(s => ({
    id: s.id,
    hasVideo: !!s.videoLocalPath,
    hasAudio: !!s.audioLocalPath,
    videoPath: s.videoLocalPath,
    error: s.error,
  })));
  
  // 检查是否有成功的片段
  const successCount = updatedSegments.filter(s => s.videoLocalPath).length;
  if (successCount === 0) {
    return {
      errors: [...state.errors, "所有视频片段生成失败"],
      currentStep: Step.ERROR,
    };
  }
  
  return {
    segments: updatedSegments,
    currentStep: Step.GENERATE_SEGMENTS,
  };
}