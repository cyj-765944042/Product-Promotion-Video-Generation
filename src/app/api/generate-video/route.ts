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
  
  // Production: Use real API (no mock mode)
  const videoClient = new VideoGenerationClient(config, customHeaders);
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
            // Build video generation content with proper typing
            const videoContent: Array<
              { type: 'text'; text: string } | 
              { type: 'image_url'; image_url: { url: string }; role?: 'first_frame' | 'last_frame' }
            > = [];
            
            // Add image as first frame if available
            if (imageUrl) {
              videoContent.push({ 
                type: 'image_url', 
                image_url: { url: imageUrl },
                role: 'first_frame'
              });
            }
            
            // Add text prompt
            if (segment.prompt) {
              videoContent.push({ type: 'text', text: segment.prompt });
            }

            // Generate video with retry
            const videoResponse = await retryWithBackoff(async () => {
              return await videoClient.videoGeneration(videoContent, {
                model: 'doubao-seedance-1-5-pro-251215',
                duration: videoDuration,
                ratio: '16:9',
                resolution: '720p',
                generateAudio: false,
              });
            }, 3);

            videoUrl = videoResponse.videoUrl || '';
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
