import { NextRequest } from 'next/server';
import { Config, VideoGenerationClient, VideoEditClient, S3Storage, TTSClient } from 'coze-coding-dev-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { HeaderUtils } from 'coze-coding-dev-sdk';

// Types
interface ScriptSegment {
  id: number;
  script: string;
  prompt: string;
  duration?: number;
}

interface Subtitle {
  start: number;
  end: number;
  text: string;
}

interface SSEEvent {
  type: 'segment_start' | 'tts_start' | 'tts_complete' | 'segment_video' | 'audio_merge' | 'concat_start' | 'upload_start' | 'subtitle_start' | 'video_url' | 'subtitles' | 'complete' | 'done' | 'error';
  content: unknown;
  segmentId?: number;
  current?: number;
  total?: number;
}

// Send SSE event
function sendEvent(controller: ReadableStreamDefaultController, event: SSEEvent) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

// Download file from URL to local file
async function downloadFile(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outputPath);
    
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadFile(redirectUrl, outputPath).then(resolve).catch(reject);
          return;
        }
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

// Get audio duration from file (simple estimation based on file size for mp3)
// For accurate duration, we'll use the duration from TTS response
async function getAudioDurationFromUrl(audioUrl: string): Promise<number> {
  // TTS usually returns ~1 second per 4-5 Chinese characters
  // We'll estimate based on this, but ideally should use the actual duration from API
  return 5; // Default 5 seconds, will be updated from TTS response
}

export async function POST(request: NextRequest) {
  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  const useMockMode = customHeaders['x-run-mode'] === 'test_run';
  
  // Parse form data
  const formData = await request.formData();
  const productName = formData.get('productName') as string;
  const segmentsJson = formData.get('segments') as string;
  let imageUrl = formData.get('imageUrl') as string | null;
  const productImageFile = formData.get('productImage') as File | null;

  // Upload product image BEFORE creating the stream (if needed)
  if (!imageUrl && productImageFile && productImageFile.size > 0) {
    try {
      console.log('正在上传商品图片...');
      const storage = new S3Storage();
      const arrayBuffer = await productImageFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileName = `product_images/${Date.now()}_${productImageFile.name}`;
      
      const imageKey = await storage.uploadFile({
        fileContent: buffer,
        fileName: fileName,
        contentType: productImageFile.type || 'image/jpeg',
      });
      
      imageUrl = await storage.generatePresignedUrl({ key: imageKey, expireTime: 86400 });
      console.log('商品图片上传成功:', imageUrl);
    } catch (error) {
      console.error('商品图片上传失败:', error);
    }
  }

  if (!segmentsJson) {
    return new Response(JSON.stringify({ error: '缺少分段数据' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let segments: ScriptSegment[];
  try {
    segments = JSON.parse(segmentsJson);
  } catch {
    return new Response(JSON.stringify({ error: '分段数据格式错误' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!segments || segments.length === 0) {
    return new Response(JSON.stringify({ error: '分段数据为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Initialize clients with SDK default configuration
        const finalHeaders = useMockMode 
          ? { ...customHeaders, 'x-run-mode': 'test_run' }
          : customHeaders;
        
        // 火山方舟视频生成配置
        const arkApiKey = process.env.ARK_API_KEY;
        const arkBaseUrl = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com';
        const videoModelEP = process.env.VIDEO_MODEL_EP;
        
        console.log('视频生成配置:', { 
          hasApiKey: !!arkApiKey, 
          baseUrl: arkBaseUrl, 
          videoModelEP: videoModelEP 
        });
        
        // 视频生成客户端使用火山方舟配置
        const videoGenConfig = arkApiKey ? new Config({ 
          apiKey: arkApiKey,
          baseUrl: arkBaseUrl,
          timeout: 180000, // 3 minutes for video processing
        }) : new Config({ timeout: 180000 });
        
        // 其他客户端使用SDK默认配置
        const defaultConfig = new Config({ timeout: 180000 });
        
        const ttsClient = new TTSClient(defaultConfig, finalHeaders);
        // 视频生成使用火山方舟配置，不需要额外headers
        const videoClient = new VideoGenerationClient(videoGenConfig, arkApiKey ? undefined : finalHeaders);
        const videoEditClient = new VideoEditClient(defaultConfig, finalHeaders);
        const storage = new S3Storage();
        
        // 使用用户配置的EP或默认模型
        const videoModel = videoModelEP || 'doubao-seedance-1-5-pro-251215';

        // ==========================================
        // Step 1: Generate TTS audio for each segment
        // ==========================================
        interface AudioInfo {
          url: string;
          duration: number;
          segmentId: number;
        }
        
        const audioInfos: AudioInfo[] = [];
        
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          
          sendEvent(controller, {
            type: 'tts_start',
            content: `正在生成第 ${i + 1}/${segments.length} 段配音...`,
            segmentId: segment.id,
            current: i + 1,
            total: segments.length,
          });
          
          try {
            // Generate TTS audio for the script using synthesize method
            const ttsResponse = await ttsClient.synthesize({
              uid: `user_${Date.now()}`,
              text: segment.script,
              speaker: 'zh_female_mizai_saturn_bigtts', // Video dubbing female voice
              audioFormat: 'mp3',
              speechRate: 0,
            });
            
            if (ttsResponse.audioUri) {
              // Estimate duration: Chinese TTS is roughly 3-4 characters per second
              // Add some buffer for pauses
              const charCount = segment.script.length;
              const estimatedDuration = Math.max(3, Math.min(15, Math.ceil(charCount / 3.5)));
              
              audioInfos.push({
                url: ttsResponse.audioUri,
                duration: estimatedDuration,
                segmentId: segment.id,
              });
              
              sendEvent(controller, {
                type: 'tts_complete',
                content: { 
                  segmentId: segment.id, 
                  audioUrl: ttsResponse.audioUri,
                  duration: estimatedDuration,
                },
                segmentId: i,
              });
              
              console.log(`TTS音频 ${i + 1} 生成成功, 时长约 ${estimatedDuration}秒`);
            } else {
              throw new Error('TTS未返回音频URL');
            }
          } catch (ttsError) {
            console.error(`TTS生成失败 (${i + 1}):`, ttsError);
            // Use default duration if TTS fails
            audioInfos.push({
              url: '',
              duration: segment.duration || 5,
              segmentId: segment.id,
            });
          }
        }

        // ==========================================
        // Step 2: Generate video for each segment based on audio duration
        // ==========================================
        const segmentVideoInfos: Array<{
          videoUrl: string;
          audioUrl: string;
          duration: number;
          script: string;
        }> = [];
        
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          const audioInfo = audioInfos[i];
          
          sendEvent(controller, {
            type: 'segment_start',
            content: `正在生成第 ${i + 1}/${segments.length} 段视频（${audioInfo.duration}秒）...`,
            segmentId: segment.id,
            current: i + 1,
            total: segments.length,
          });

          const content: Array<
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string }; role?: 'first_frame' | 'last_frame' }
          > = [];
          
          // Use product image as reference for video generation
          if (imageUrl) {
            content.push({
              type: 'image_url' as const,
              image_url: { url: imageUrl },
              role: i === 0 ? 'first_frame' as const : undefined,
            });
          }
          
          // Add the visual prompt
          const promptText = productName 
            ? `${productName}产品展示：${segment.prompt}`
            : segment.prompt;
          
          content.push({
            type: 'text' as const,
            text: promptText,
          });
          
          // Generate video with duration matching the audio
          const videoResponse = await videoClient.videoGeneration(content, {
            model: videoModel,
            duration: audioInfo.duration, // Use audio duration
            ratio: '16:9',
            resolution: '720p',
            generateAudio: false, // Don't generate audio, we'll add our own
          });

          if (!videoResponse.videoUrl) {
            throw new Error(`第 ${i + 1} 段视频生成失败：未返回视频URL`);
          }

          console.log(`第 ${i + 1} 段视频生成成功:`, videoResponse.videoUrl);

          segmentVideoInfos.push({
            videoUrl: videoResponse.videoUrl,
            audioUrl: audioInfo.url,
            duration: audioInfo.duration,
            script: segment.script,
          });

          sendEvent(controller, {
            type: 'segment_video',
            content: { 
              segmentId: segment.id, 
              videoUrl: videoResponse.videoUrl,
              duration: audioInfo.duration,
            },
            segmentId: i,
          });
        }

        // ==========================================
        // Step 3: Merge audio and video for each segment
        // ==========================================
        const mergedVideoUrls: string[] = [];
        
        for (let i = 0; i < segmentVideoInfos.length; i++) {
          const info = segmentVideoInfos[i];
          
          if (info.audioUrl) {
            sendEvent(controller, {
              type: 'audio_merge',
              content: `正在为第 ${i + 1}/${segments.length} 段视频添加配音...`,
              segmentId: i + 1,
            });
            
            try {
              // Transfer video to object storage for accessible URL
              const uploadedVideoKey = await storage.uploadFromUrl({
                url: info.videoUrl,
                timeout: 60000,
              });
              const accessibleVideoUrl = await storage.generatePresignedUrl({
                key: uploadedVideoKey,
                expireTime: 3600,
              });
              
              // Transfer audio to object storage
              const uploadedAudioKey = await storage.uploadFromUrl({
                url: info.audioUrl,
                timeout: 30000,
              });
              const accessibleAudioUrl = await storage.generatePresignedUrl({
                key: uploadedAudioKey,
                expireTime: 3600,
              });
              
              // Use video edit client to merge audio
              // Note: compileVideoAudio API merges audio into video
              const mergedVideo = await videoEditClient.compileVideoAudio(
                accessibleVideoUrl,
                accessibleAudioUrl,
                {
                  isAudioReserve: false, // Replace original audio
                }
              );
              
              if (mergedVideo.url) {
                mergedVideoUrls.push(mergedVideo.url);
                console.log(`视频 ${i + 1} 音频合并成功`);
              } else {
                // Fallback to original video
                mergedVideoUrls.push(info.videoUrl);
                console.log(`视频 ${i + 1} 音频合并失败，使用原视频`);
              }
            } catch (mergeError) {
              console.error(`音频合并失败 (${i + 1}):`, mergeError);
              mergedVideoUrls.push(info.videoUrl);
            }
          } else {
            mergedVideoUrls.push(info.videoUrl);
          }
        }

        // ==========================================
        // Step 4: Concatenate all videos (skip if only one segment)
        // ==========================================
        if (segments.length === 1) {
          const subtitles: Subtitle[] = [{
            start: 0,
            end: segmentVideoInfos[0].duration,
            text: segmentVideoInfos[0].script,
          }];
          
          sendEvent(controller, {
            type: 'complete',
            content: {
              videoUrl: mergedVideoUrls[0],
              subtitles: subtitles,
              duration: segmentVideoInfos[0].duration,
            },
          });
          
          controller.close();
          return;
        }
        
        sendEvent(controller, {
          type: 'concat_start',
          content: `正在拼接 ${segments.length} 个视频片段...`,
        });

        // Transfer all videos to object storage for accessible URLs
        const accessibleVideoUrls: string[] = [];
        for (let i = 0; i < mergedVideoUrls.length; i++) {
          try {
            const uploadedKey = await storage.uploadFromUrl({
              url: mergedVideoUrls[i],
              timeout: 60000,
            });
            
            const accessibleUrl = await storage.generatePresignedUrl({
              key: uploadedKey,
              expireTime: 3600,
            });
            
            accessibleVideoUrls.push(accessibleUrl);
            console.log(`视频 ${i + 1} 转存成功`);
          } catch (transferError) {
            console.error(`视频 ${i + 1} 转存失败:`, transferError);
            // Return individual segments on failure
            const subtitles = segmentVideoInfos.map((info, idx) => {
              const prevDuration = segmentVideoInfos.slice(0, idx).reduce((sum, i) => sum + i.duration, 0);
              return {
                start: prevDuration,
                end: prevDuration + info.duration,
                text: info.script,
              };
            });
            
            sendEvent(controller, {
              type: 'complete',
              content: {
                videoUrl: mergedVideoUrls[0],
                segmentVideos: segmentVideoInfos.map((info, idx) => ({
                  id: segments[idx].id,
                  script: info.script,
                  videoUrl: mergedVideoUrls[idx],
                  duration: info.duration,
                })),
                subtitles: subtitles,
                duration: segmentVideoInfos.reduce((sum, i) => sum + i.duration, 0),
                isSegmented: true,
              },
            });
            
            controller.close();
            return;
          }
        }

        // Use smooth transitions between segments
        const transitions = ['1182376', '1182356', '1182371', '1182374'];
        const selectedTransitions = segments.slice(0, -1).map((_, i) => 
          transitions[i % transitions.length]
        );

        let concatenatedVideoUrl: string = '';
        let totalDuration: number = 0;

        // Retry mechanism for concatenation
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`开始视频拼接 (第${attempt}次尝试)`);
            const concatResponse = await videoEditClient.concatVideos(
              accessibleVideoUrls,
              selectedTransitions.length > 0 ? { transitions: selectedTransitions } : undefined
            );

            if (!concatResponse.url) {
              throw new Error('视频拼接失败：未返回视频URL');
            }

            concatenatedVideoUrl = concatResponse.url;
            totalDuration = concatResponse.video_meta?.duration || 
              segmentVideoInfos.reduce((sum, i) => sum + i.duration, 0);
            break;
          } catch (concatErr) {
            console.error(`视频拼接第${attempt}次失败:`, concatErr);
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            }
          }
        }

        if (!concatenatedVideoUrl) {
          // Return individual segments
          const subtitles = segmentVideoInfos.map((info, idx) => {
            const prevDuration = segmentVideoInfos.slice(0, idx).reduce((sum, i) => sum + i.duration, 0);
            return {
              start: prevDuration,
              end: prevDuration + info.duration,
              text: info.script,
            };
          });
          
          sendEvent(controller, {
            type: 'complete',
            content: {
              videoUrl: mergedVideoUrls[0],
              segmentVideos: segmentVideoInfos.map((info, idx) => ({
                id: segments[idx].id,
                script: info.script,
                videoUrl: mergedVideoUrls[idx],
                duration: info.duration,
              })),
              subtitles: subtitles,
              duration: segmentVideoInfos.reduce((sum, i) => sum + i.duration, 0),
              isSegmented: true,
            },
          });
          
          controller.close();
          return;
        }

        // ==========================================
        // Step 5: Add subtitles to final video
        // ==========================================
        sendEvent(controller, {
          type: 'subtitle_start',
          content: '正在添加字幕到视频...',
        });

        // Generate subtitles based on actual durations
        const subtitles: Subtitle[] = [];
        let currentTime = 0;
        for (const info of segmentVideoInfos) {
          subtitles.push({
            start: currentTime,
            end: currentTime + info.duration,
            text: info.script,
          });
          currentTime += info.duration;
        }

        const textList = subtitles.map(sub => ({
          start_time: sub.start,
          end_time: sub.end,
          text: sub.text,
        }));

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
          background_color: '#00000088',
          background_border_width: 0,
          border_width: 1,
          border_color: '#00000088',
        };

        let finalVideoUrl = concatenatedVideoUrl;
        try {
          const subtitleResponse = await videoEditClient.addSubtitles(
            concatenatedVideoUrl,
            subtitleConfig,
            { textList }
          );

          if (subtitleResponse.url) {
            finalVideoUrl = subtitleResponse.url;
          }
        } catch (subtitleError) {
          console.error('字幕添加失败:', subtitleError);
        }

        sendEvent(controller, {
          type: 'video_url',
          content: finalVideoUrl,
        });

        sendEvent(controller, {
          type: 'subtitles',
          content: { subtitles },
        });

        sendEvent(controller, {
          type: 'done',
          content: JSON.stringify({
            videoUrl: finalVideoUrl,
            duration: totalDuration,
            segments: segments.length,
          }),
        });

        controller.close();
      } catch (error) {
        console.error('视频生成失败:', error);
        sendEvent(controller, {
          type: 'error',
          content: error instanceof Error ? error.message : '未知错误',
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
