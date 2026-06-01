import { NextRequest } from 'next/server';
import { 
  VideoGenerationClient,
  VideoEditClient,
  S3Storage, 
  Config, 
  TTSClient,
  HeaderUtils
} from 'coze-coding-dev-sdk';
import { 
  downloadFile,
  generateSrtFile,
  mergeVideoAudio,
  concatenateVideos,
  burnSubtitles
} from '@/lib/video-processor';
import path from 'path';
import fs from 'fs';

// 火山方舟视频生成配置
const VOLC_ARK_API_KEY = process.env.VOLC_ARK_API_KEY || '';
const VOLC_ARK_ENDPOINT = process.env.VOLC_ARK_ENDPOINT || '';

// 视频生成函数 - 优先使用用户配置的火山方舟，失败则回退到SDK
async function generateVideo(
  prompt: string,
  imageUrl: string | undefined,
  duration: number,
  config: Config,
  customHeaders: Record<string, string>
): Promise<string> {
  // 如果有用户配置的火山方舟凭证，先尝试使用
  if (VOLC_ARK_API_KEY && VOLC_ARK_ENDPOINT) {
    console.log('尝试使用用户配置的火山方舟API...');
    try {
      const url = 'https://ark.cn-beijing.volces.com/api/v3/videos/generations';
      
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
      
      if (imageUrl) {
        content.push({
          type: 'image_url',
          image_url: { url: imageUrl }
        });
      }
      
      content.push({
        type: 'text',
        text: prompt
      });
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${VOLC_ARK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: VOLC_ARK_ENDPOINT,
          content: content,
          duration: duration,
          ratio: '16:9',
          resolution: '720p'
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.data?.[0]?.url) {
          console.log('火山方舟视频生成成功');
          return data.data[0].url;
        } else if (data.video_url || data.url) {
          console.log('火山方舟视频生成成功');
          return data.video_url || data.url;
        }
      }
      
      console.log(`火山方舟API返回 ${response.status}，回退到SDK...`);
    } catch (error) {
      console.log('火山方舟API调用失败，回退到SDK:', error);
    }
  }
  
  // 使用coze SDK生成视频
  console.log('使用coze SDK生成视频...');
  
  // 开发环境使用mock模式
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';
  const videoHeaders = isDev 
    ? { ...customHeaders, 'x-run-mode': 'test_run' }
    : customHeaders;
  
  const videoClient = new VideoGenerationClient(config, videoHeaders);
  
  const videoContent: Array<
    { type: 'text'; text: string } | 
    { type: 'image_url'; image_url: { url: string }; role?: 'first_frame' }
  > = [];
  
  if (imageUrl) {
    videoContent.push({ 
      type: 'image_url', 
      image_url: { url: imageUrl },
      role: 'first_frame'
    });
  }
  
  videoContent.push({ type: 'text', text: prompt });
  
  const response = await videoClient.videoGeneration(videoContent, {
    model: 'doubao-seedance-1-5-pro-251215',
    duration: duration,
    ratio: '16:9',
    resolution: '720p'
  });
  
  if (!response.videoUrl) {
    throw new Error('视频生成失败：未返回视频URL');
  }
  
  return response.videoUrl;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScriptSegment {
  id: number;
  script: string;
  prompt: string;
  duration: number;
}

interface Subtitle {
  start: number;
  end: number;
  text: string;
}

// Retry helper with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 2000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms delay`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Get storage directory based on environment
function getStorageDir(): string {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';
  const baseDir = isDev 
    ? process.env.COZE_WORKSPACE_PATH || '/workspace/projects'
    : '/tmp';
  
  const storageDir = path.join(baseDir, 'public', 'videos');
  
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  
  return storageDir;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const productName = formData.get('productName') as string;
  const segmentsStr = formData.get('segments') as string;
  const imageUrl = formData.get('imageUrl') as string | null;

  let segments: ScriptSegment[] = [];
  try {
    segments = JSON.parse(segmentsStr || '[]');
  } catch {
    segments = [];
  }

  if (!segments || segments.length === 0) {
    return new Response(JSON.stringify({ error: '缺少视频分段信息' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const config = new Config();
  
  // Extract headers from request for proper authentication
  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  
  // Use Volc Ark for video generation, coze SDK for other services
  const videoEditClient = new VideoEditClient(config, customHeaders);
  const ttsClient = new TTSClient(config, customHeaders);

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (type: string, data: unknown) => {
        const message = `data: ${JSON.stringify({ type, content: data })}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      const storageDir = getStorageDir();
      const timestamp = Date.now();
      
      try {
        // Arrays to store local file paths
        const localVideoPaths: string[] = [];
        const localAudioPaths: string[] = [];
        const subtitles: Subtitle[] = [];
        let currentTime = 0;

        // Process each segment
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          
          // Step 1: Generate TTS audio
          sendEvent('segment_start', { 
            content: `正在生成第 ${i + 1} 段口播音频...`, 
            segmentId: i, 
            current: i + 1, 
            total: segments.length 
          });

          let audioUrl: string | null = null;
          let audioDuration = segment.duration || 5;

          try {
            const ttsResponse = await ttsClient.synthesize({ 
              uid: `user_${timestamp}_${i}`,
              text: segment.script,
              speaker: 'zh_female_xiaohe_uranus_bigtts'
            });
            audioUrl = ttsResponse.audioUri || null;
            audioDuration = segment.duration || 5;
            console.log(`Segment ${i + 1} audio generated: ${audioUrl ? 'success' : 'failed'}`);
          } catch (ttsError) {
            console.error(`TTS failed for segment ${i + 1}:`, ttsError);
          }

          // Download audio to local storage
          if (audioUrl) {
            try {
              const localAudioPath = await downloadFile(
                audioUrl,
                `audio_${timestamp}_${i}.mp3`
              );
              localAudioPaths.push(localAudioPath);
              sendEvent('download', { content: `已下载第 ${i + 1} 段音频到本地` });
            } catch (downloadError) {
              console.error(`Audio download failed for segment ${i + 1}:`, downloadError);
              localAudioPaths.push('');
            }
          } else {
            localAudioPaths.push('');
          }

          // Step 2: Generate video
          sendEvent('segment_start', { 
            content: `正在生成第 ${i + 1}/${segments.length} 段视频...`, 
            segmentId: i + 1, 
            current: i + 1, 
            total: segments.length 
          });

          let videoUrl = '';
          const videoDuration = Math.max(3, Math.min(10, audioDuration));

          try {
            // Use video generation with fallback support
            const prompt = segment.prompt || `高质量产品展示视频，专业摄影，精美画面，展示商品细节和特点`;
            videoUrl = await retryWithBackoff(async () => {
              return await generateVideo(prompt, imageUrl || undefined, videoDuration, config, customHeaders);
            }, 3);

            console.log(`Segment ${i + 1} video generated: ${videoUrl ? 'success' : 'failed'}`);
          } catch (videoError) {
            console.error(`Video generation failed for segment ${i + 1}:`, videoError);
            
            const errorMessage = videoError instanceof Error ? videoError.message : '未知错误';
            if (errorMessage.includes('403') || errorMessage.includes('ErrSourceLimit')) {
              throw new Error('视频生成服务当前资源受限，请稍后重试或联系管理员');
            }
            throw new Error(`第 ${i + 1} 段视频生成失败: ${errorMessage}`);
          }

          // Download video to local storage
          if (videoUrl) {
            try {
              const localVideoPath = await downloadFile(
                videoUrl,
                `video_${timestamp}_${i}.mp4`
              );
              localVideoPaths.push(localVideoPath);
              sendEvent('download', { content: `已下载第 ${i + 1} 段视频到本地` });
            } catch (downloadError) {
              console.error(`Video download failed for segment ${i + 1}:`, downloadError);
              throw new Error(`第 ${i + 1} 段视频下载失败`);
            }
          } else {
            throw new Error(`第 ${i + 1} 段视频生成失败：未返回视频URL`);
          }

          // Send segment video URL
          sendEvent('segment_video', {
            segmentId: i + 1,
            videoUrl: videoUrl
          });

          // Add subtitle entry
          subtitles.push({
            start: currentTime,
            end: currentTime + videoDuration,
            text: segment.script
          });
          currentTime += videoDuration;
        }

        // Step 3: Merge audio into each video segment using FFmpeg
        sendEvent('merge_start', { content: '正在合并音频和视频...' });
        
        const mergedVideoPaths: string[] = [];
        
        for (let i = 0; i < localVideoPaths.length; i++) {
          const localVideo = localVideoPaths[i];
          const localAudio = localAudioPaths[i];
          
          if (localAudio) {
            const mergedPath = path.join(storageDir, `merged_${timestamp}_${i}.mp4`);
            try {
              await mergeVideoAudio(localVideo, localAudio, mergedPath);
              mergedVideoPaths.push(mergedPath);
              sendEvent('merge_progress', { 
                content: `已合并第 ${i + 1}/${localVideoPaths.length} 段音频`,
                current: i + 1,
                total: localVideoPaths.length
              });
            } catch (mergeError) {
              console.error(`Merge failed for segment ${i + 1}:`, mergeError);
              mergedVideoPaths.push(localVideo); // Fallback to original video
            }
          } else {
            mergedVideoPaths.push(localVideo);
          }
        }

        // Step 4: Concatenate all videos using FFmpeg
        sendEvent('concat_start', { content: `正在拼接 ${mergedVideoPaths.length} 个视频片段...` });
        
        let finalVideoPath: string;
        
        if (mergedVideoPaths.length > 1) {
          finalVideoPath = path.join(storageDir, `concat_${timestamp}.mp4`);
          try {
            await concatenateVideos(mergedVideoPaths, finalVideoPath);
            sendEvent('concat_done', { content: '视频拼接完成' });
          } catch (concatError) {
            console.error('Video concatenation failed:', concatError);
            // Fallback to first video
            finalVideoPath = mergedVideoPaths[0];
            sendEvent('concat_fallback', { 
              content: '视频拼接暂时不可用，使用第一个片段'
            });
          }
        } else {
          finalVideoPath = mergedVideoPaths[0];
        }

        // Step 5: Generate SRT and burn subtitles using FFmpeg
        sendEvent('subtitle_start', { content: '正在生成并嵌入字幕...' });
        
        const srtPath = generateSrtFile(subtitles, `subs_${timestamp}.srt`);
        const finalOutputPath = path.join(storageDir, `final_${timestamp}.mp4`);
        
        try {
          await burnSubtitles(finalVideoPath, srtPath, finalOutputPath);
          finalVideoPath = finalOutputPath;
          sendEvent('subtitle_done', { content: '字幕已嵌入视频' });
        } catch (subtitleError) {
          console.error('Subtitle burn failed:', subtitleError);
          // Continue without subtitles
          sendEvent('subtitle_fallback', { content: '字幕嵌入失败，使用无字幕版本' });
        }

        // Cleanup SRT file
        try {
          if (fs.existsSync(srtPath)) {
            fs.unlinkSync(srtPath);
          }
        } catch (cleanupError) {
          console.warn('SRT cleanup warning:', cleanupError);
        }

        // Generate public URL
        const filename = path.basename(finalVideoPath);
        const publicUrl = `/videos/${filename}`;
        
        // Get file size
        const stats = fs.statSync(finalVideoPath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

        // Send final result
        sendEvent('video_url', publicUrl);
        sendEvent('subtitles', { subtitles, localPath: finalVideoPath });
        sendEvent('done', JSON.stringify({
          videoUrl: publicUrl,
          localPath: finalVideoPath,
          fileSize: `${fileSizeMB} MB`,
          duration: currentTime,
          segments: segments.length
        }));

        // Cleanup intermediate files
        try {
          for (const file of [...localVideoPaths, ...localAudioPaths, ...mergedVideoPaths]) {
            if (fs.existsSync(file) && file !== finalVideoPath) {
              fs.unlinkSync(file);
            }
          }
        } catch (cleanupError) {
          console.warn('Intermediate files cleanup warning:', cleanupError);
        }

      } catch (error) {
        console.error('Video generation error:', error);
        sendEvent('error', error instanceof Error ? error.message : '视频生成失败');
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
