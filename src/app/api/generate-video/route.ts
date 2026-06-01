import { NextRequest } from 'next/server';
import { 
  VideoGenerationClient, 
  VideoEditClient,
  S3Storage, 
  Config, 
  TTSClient
} from 'coze-coding-dev-sdk';

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
  const videoClient = new VideoGenerationClient(config);
  const videoEditClient = new VideoEditClient(config);
  const storage = new S3Storage();
  const ttsClient = new TTSClient(config);

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (type: string, data: unknown) => {
        const message = `data: ${JSON.stringify({ type, content: data })}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      try {
        // Process each segment
        const segmentVideos: { url: string; duration: number; script: string }[] = [];
        const subtitles: Subtitle[] = [];
        let currentTime = 0;

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
              uid: `user_${Date.now()}_${i}`,
              text: segment.script,
              speaker: 'zh_female_xiaohe_uranus_bigtts'
            });
            // TTS response has audioUri, use it as the audio URL
            audioUrl = ttsResponse.audioUri || null;
            audioDuration = segment.duration || 5; // Use segment duration as fallback
            console.log(`Segment ${i + 1} audio generated: ${audioUrl ? 'success' : 'failed'}`);
          } catch (ttsError) {
            console.error(`TTS failed for segment ${i + 1}:`, ttsError);
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
            // Build video generation content
            const videoContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
            
            if (segment.prompt) {
              videoContent.push({ type: 'text', text: segment.prompt });
            }

            if (imageUrl) {
              videoContent.push({ 
                type: 'image_url', 
                image_url: { url: imageUrl } 
              });
            }

            // Generate video with retry
            const videoResponse = await retryWithBackoff(async () => {
              return await videoClient.videoGeneration(videoContent as any, {
                duration: videoDuration,
                ratio: '16:9',
                generateAudio: false,
              });
            }, 3);

            videoUrl = videoResponse.videoUrl || '';
          } catch (videoError) {
            console.error(`Video generation failed for segment ${i + 1}:`, videoError);
            throw new Error(`第 ${i + 1} 段视频生成失败: ${videoError instanceof Error ? videoError.message : '未知错误'}`);
          }

          // Step 3: Compile video with audio
          if (audioUrl && videoUrl) {
            sendEvent('subtitle_start', { content: `正在合并第 ${i + 1} 段音频...` });

            try {
              const compiledVideo = await retryWithBackoff(async () => {
                return await videoEditClient.compileVideoAudio(videoUrl, audioUrl, { 
                  isAudioReserve: false 
                });
              }, 3);
              videoUrl = compiledVideo.url;
            } catch (compileError) {
              console.error(`Audio merge failed for segment ${i + 1}:`, compileError);
              // Continue with original video if audio merge fails
            }
          }

          // Send segment video
          sendEvent('segment_video', {
            segmentId: i + 1,
            videoUrl: videoUrl
          });

          segmentVideos.push({
            url: videoUrl,
            duration: videoDuration,
            script: segment.script
          });

          // Add subtitle
          subtitles.push({
            start: currentTime,
            end: currentTime + videoDuration,
            text: segment.script
          });
          currentTime += videoDuration;
        }

        // Step 4: Concatenate videos if multiple segments
        let finalVideoUrl = segmentVideos[0]?.url || '';

        if (segmentVideos.length > 1) {
          sendEvent('concat_start', { content: `正在拼接 ${segmentVideos.length} 个视频片段...` });

          try {
            const videoUrls = segmentVideos.map(v => v.url);
            
            // Upload videos to accessible storage first
            const accessibleUrls: string[] = [];
            for (let i = 0; i < videoUrls.length; i++) {
              try {
                const key = await storage.uploadFromUrl({ url: videoUrls[i], timeout: 60000 });
                const presignedUrl = await storage.generatePresignedUrl({ key, expireTime: 3600 });
                accessibleUrls.push(presignedUrl);
              } catch (uploadError) {
                console.error(`Failed to upload segment ${i + 1}:`, uploadError);
                accessibleUrls.push(videoUrls[i]); // Fallback to original URL
              }
            }

            // Concatenate videos
            const concatResponse = await retryWithBackoff(async () => {
              return await videoEditClient.concatVideos(accessibleUrls);
            }, 3);

            finalVideoUrl = concatResponse.url;
          } catch (concatError) {
            console.error('Video concatenation failed:', concatError);
            // Fallback to first segment video
            sendEvent('concat_fallback', { 
              content: '视频拼接暂时不可用，已生成分段视频',
              segmentVideos: segmentVideos.map(v => ({ url: v.url, duration: v.duration }))
            });
          }
        }

        // Step 5: Add subtitles
        if (subtitles.length > 0) {
          sendEvent('subtitle_start', { content: '正在添加字幕到视频...' });

          try {
            // Convert subtitles to textList format for addSubtitles
            const textList = subtitles.map(s => ({
              start_time: s.start,
              end_time: s.end,
              text: s.text
            }));
            
            // Define subtitle styling configuration
            const subtitleConfig = {
              font_pos_config: {
                pos_x: '0',
                pos_y: '90%',
                width: '100%',
                height: '10%',
              },
              font_size: 36,
              font_color: '#FFFFFFFF',
              font_type: '1525745',
              background_color: '#00000000',
              border_width: 1,
              border_color: '#00000088',
            };
            
            const subtitleResponse = await retryWithBackoff(async () => {
              return await videoEditClient.addSubtitles(finalVideoUrl, subtitleConfig, { textList });
            }, 3);

            finalVideoUrl = subtitleResponse.url;
          } catch (subtitleError) {
            console.error('Subtitle addition failed:', subtitleError);
            // Continue without subtitles
          }
        }

        // Send final result
        sendEvent('video_url', finalVideoUrl);
        sendEvent('subtitles', { subtitles });
        sendEvent('done', JSON.stringify({
          videoUrl: finalVideoUrl,
          duration: currentTime,
          segments: segments.length
        }));

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
