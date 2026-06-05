/**
 * 重新生成单个视频片段 API
 */

import { NextRequest } from "next/server";
import { VideoSegment, AgentStateType } from "@/agent";
import fs from "fs";
import path from "path";
import axios from "axios";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// API 配置
const VIDEO_API_URL = "https://ark.cn-beijing.volces.com/api/v3/videos/generations";
const VIDEO_MODEL = "Doubao-Seedance-1.5-pro";
const VIDEO_EP = "ep-20260514120705-pqv86";
const VIDEO_API_KEY = "ark-1249de72-68c5-4737-8777-789f626d0a3b-c7bc9";

const TTS_API_URL = "https://ark.cn-beijing.volces.com/api/v3/tts";
const TTS_MODEL = "doubao_tts_1";
const TTS_EP = "ep-2025051401";

export async function POST(request: NextRequest) {
  const body = await request.json();
  
  const { segmentId, script, prompt, imageUrl, folderPath } = body;
  
  console.log(`[Regenerate API] 重新生成片段 ${segmentId}`);
  
  // 创建 SSE 流
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
      };
      
      try {
        sendEvent("start", { segmentId, message: "开始重新生成" });
        
        // 1. 生成 TTS
        sendEvent("tts_start", { segmentId });
        
        const ttsResponse = await axios.post(
          `${TTS_API_URL}?model=${TTS_MODEL}&endpoint_id=${TTS_EP}`,
          {
            text: script,
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
        
        const audioFileName = `audio_${segmentId}_${Date.now()}.mp3`;
        const audioPath = path.join(folderPath, "audio", audioFileName);
        fs.writeFileSync(audioPath, ttsResponse.data);
        
        // 获取音频时长
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
        );
        const audioDuration = parseFloat(stdout.trim()) || 5;
        
        sendEvent("tts_complete", {
          segmentId,
          audioUrl: `/api/file?path=${audioPath}`,
          audioLocalPath: audioPath,
          duration: audioDuration,
        });
        
        // 2. 生成视频
        sendEvent("video_start", { segmentId });
        
        const videoResponse = await axios.post(
          VIDEO_API_URL,
          {
            model: VIDEO_MODEL,
            endpoint_id: VIDEO_EP,
            content: [
              { type: "text", text: prompt },
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
        
        const taskId = videoResponse.data.data.task_id;
        
        // 等待视频完成
        let videoUrl: string | null = null;
        let retryCount = 0;
        
        while (!videoUrl && retryCount < 60) {
          await new Promise(r => setTimeout(r, 5000));
          
          const statusResponse = await axios.get(
            `${VIDEO_API_URL}/${taskId}`,
            {
              headers: { Authorization: `Bearer ${VIDEO_API_KEY}` },
            }
          );
          
          const status = statusResponse.data.data.status;
          
          if (status === "SUCCESS") {
            videoUrl = statusResponse.data.data.video_url;
          } else if (status === "FAILED") {
            throw new Error(`视频生成失败`);
          }
          
          retryCount++;
        }
        
        if (!videoUrl) throw new Error("视频生成超时");
        
        // 下载视频
        const videoResponseData = await axios.get(videoUrl, { responseType: "arraybuffer" });
        const videoFileName = `video_${segmentId}_${Date.now()}.mp4`;
        const videoPath = path.join(folderPath, "video", videoFileName);
        fs.writeFileSync(videoPath, videoResponseData.data);
        
        sendEvent("video_complete", {
          segmentId,
          videoUrl: `/api/file?path=${videoPath}`,
          videoLocalPath: videoPath,
          duration: audioDuration,
        });
        
        // 3. 完成
        sendEvent("done", {
          segmentId,
          audio: {
            url: `/api/file?path=${audioPath}`,
            localPath: audioPath,
            duration: audioDuration,
          },
          video: {
            url: `/api/file?path=${videoPath}`,
            localPath: videoPath,
            duration: audioDuration,
          },
        });
        
      } catch (error) {
        console.error(`[Regenerate API] 错误:`, error);
        sendEvent("error", { segmentId, message: String(error) });
      }
      
      controller.close();
    },
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}