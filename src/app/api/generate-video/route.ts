import { NextRequest } from 'next/server';
import { 
  VideoGenerationClient, 
  VideoEditClient,
  S3Storage, 
  Config, 
  HeaderUtils
} from 'coze-coding-dev-sdk';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScriptSegment {
  id: number;
  script: string;
  prompt: string;
  duration: number;
}

interface StreamData {
  type: 'segment_start' | 'segment_video' | 'concat_start' | 'download_start' | 'upload_start' | 'subtitle_start' | 'video_url' | 'subtitles' | 'complete' | 'done' | 'error';
  content: string | { segmentId: number; videoUrl: string } | { subtitles: Subtitle[] } | { videoUrl: string; subtitles: Subtitle[]; duration: number };
  segmentId?: number;
}

interface Subtitle {
  start: number;
  end: number;
  text: string;
}

async function sendEvent(controller: ReadableStreamDefaultController, data: StreamData) {
  const encoder = new TextEncoder();
  const message = `data: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(message));
}

// Generate subtitles from segmented script
function generateSubtitlesFromSegments(segments: ScriptSegment[]): Subtitle[] {
  const subtitles: Subtitle[] = [];
  let currentTime = 0;

  for (const segment of segments) {
    const text = segment.script.trim();
    const duration = segment.duration || 4;
    
    subtitles.push({
      start: currentTime,
      end: currentTime + duration,
      text: text,
    });
    
    currentTime += duration;
  }

  return subtitles;
}

// Download video from URL to local file
async function downloadVideo(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outputPath);
    
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirect
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadVideo(redirectUrl, outputPath).then(resolve).catch(reject);
          return;
        }
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download video: HTTP ${response.statusCode}`));
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

export async function POST(request: NextRequest) {
  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  
  // Check if we should use mock mode (for development/testing)
  // Mock mode is only enabled when x-run-mode header is explicitly set to 'test_run'
  // Note: We now use real API for video generation with configured ARK_API_KEY
  const useMockMode = customHeaders['x-run-mode'] === 'test_run';
  
  if (useMockMode) {
    console.log('🧪 Mock mode enabled for video generation');
  }
  
  // Log API configuration for debugging
  console.log('视频生成API配置:', {
    hasApiKey: !!process.env.ARK_API_KEY,
    baseUrl: process.env.ARK_BASE_URL,
    videoModelEP: process.env.VIDEO_MODEL_EP,
  });
  
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
        // SDK will automatically handle API credentials from environment or defaults
        // Only override timeout for video processing (longer duration)
        const config = new Config({ 
          timeout: 180000, // 180 seconds for video processing
        });
        
        // Add mock mode header only for test_run
        const finalHeaders = useMockMode 
          ? { ...customHeaders, 'x-run-mode': 'test_run' }
          : customHeaders;
        
        const videoClient = new VideoGenerationClient(config, finalHeaders);
        const videoEditClient = new VideoEditClient(config, finalHeaders);
        const storage = new S3Storage();

        const segmentVideoUrls: string[] = [];

        // Step 1: Generate video for each segment (with audio)
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          
          sendEvent(controller, {
            type: 'segment_start',
            content: `正在生成第 ${i + 1}/${segments.length} 段视频...`,
            segmentId: segment.id,
          });

          const content: Array<
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string }; role?: 'first_frame' | 'last_frame' }
          > = [];
          
          // Use product image as reference for video generation
          // Include image for all segments to maintain product consistency
          if (imageUrl) {
            content.push({
              type: 'image_url' as const,
              image_url: { url: imageUrl },
              role: i === 0 ? 'first_frame' as const : undefined, // Only first segment uses first_frame
            });
          }
          
          // Add the visual prompt for video generation
          // Include product name and script for better product relevance
          const promptWithScript = productName 
            ? `${productName}产品展示：${segment.prompt}，同时旁白说："${segment.script}"`
            : `${segment.prompt}，同时旁白说："${segment.script}"`;
          
          content.push({
            type: 'text' as const,
            text: promptWithScript,
          });
          
          // Generate video with visual prompt and voiceover script
          // Using doubao-seedance-1-5-pro-251215 model with audio generation support
          // The model can generate synchronized audio including voice, sound effects, and background music
          let videoResponse;
          try {
            videoResponse = await videoClient.videoGeneration(content, {
              model: 'doubao-seedance-1-5-pro-251215',
              duration: Math.max(5, Math.min(10, segment.duration || 5)), // 5-10 seconds
              ratio: '16:9',
              resolution: '720p',
              generateAudio: true, // Enable audio generation
            });
          } catch (error) {
            console.error('视频生成API错误:', error);
            // Check if it's a permission error (403)
            const errorMessage = error instanceof Error ? error.message : '';
            if (errorMessage.includes('403') || errorMessage.includes('permission')) {
              throw new Error(`视频生成服务暂不可用。这可能是因为：
1. 当前环境没有视频生成权限
2. 需要配置火山方舟API密钥

解决方案：
- 在生产环境中部署，视频生成功能将自动可用
- 或者在.env.local中配置有效的API密钥`);
            }
            // 返回更详细的错误信息
            if (error instanceof Error) {
              throw new Error(`第 ${i + 1} 段视频生成失败: ${error.message}`);
            }
            throw error;
          }

          if (!videoResponse.videoUrl) {
            throw new Error(`第 ${i + 1} 段视频生成失败：未返回视频URL`);
          }

          segmentVideoUrls.push(videoResponse.videoUrl);

          sendEvent(controller, {
            type: 'segment_video',
            content: { segmentId: segment.id, videoUrl: videoResponse.videoUrl },
            segmentId: i,
          });
        }

        // Step 2: Concatenate all segment videos (skip in mock mode)
        if (useMockMode) {
          // In mock mode, directly return the first mock video URL
          const totalDuration = segments.reduce((sum, s) => sum + (s.duration || 4), 0);
          const subtitles = generateSubtitlesFromSegments(segments);
          
          sendEvent(controller, {
            type: 'complete',
            content: {
              videoUrl: segmentVideoUrls[0],
              subtitles: subtitles,
              duration: totalDuration,
            },
          });
          
          controller.close();
          return;
        }
        
        sendEvent(controller, {
          type: 'concat_start',
          content: `正在拼接 ${segments.length} 个视频片段...`,
        });

        // Use smooth transitions between segments
        const transitions = [
          '1182376', // 圆形打开
          '1182356', // 百叶窗
          '1182371', // 对角擦除
          '1182374', // 透镜变换
        ];

        // Select transitions (one less than number of segments)
        const selectedTransitions = segments.slice(0, -1).map((_, i) => 
          transitions[i % transitions.length]
        );

        const concatResponse = await videoEditClient.concatVideos(
          segmentVideoUrls,
          selectedTransitions.length > 0 ? { transitions: selectedTransitions } : undefined
        );

        if (!concatResponse.url) {
          throw new Error('视频拼接失败');
        }

        const concatenatedVideoUrl = concatResponse.url;
        const totalDuration = concatResponse.video_meta?.duration || segments.reduce((sum, s) => sum + (s.duration || 4), 0);

        // Step 3: Download concatenated video
        sendEvent(controller, {
          type: 'download_start',
          content: '正在下载拼接后的视频...',
        });

        const tmpDir = '/tmp/video-processing';
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }

        const localVideoPath = path.join(tmpDir, `concatenated_${Date.now()}.mp4`);
        await downloadVideo(concatenatedVideoUrl, localVideoPath);

        // Step 4: Upload to object storage to get accessible URL
        sendEvent(controller, {
          type: 'upload_start',
          content: '正在上传视频到对象存储...',
        });

        // Read the local video file and upload
        const videoBuffer = fs.readFileSync(localVideoPath);
        const uploadedKey = await storage.uploadFile({
          fileContent: videoBuffer,
          fileName: `videos/concatenated_${Date.now()}.mp4`,
          contentType: 'video/mp4',
        });

        // Generate presigned URL for accessing the video
        const accessibleVideoUrl = await storage.generatePresignedUrl({
          key: uploadedKey,
          expireTime: 86400, // 1 day
        });

        // Clean up local file
        try {
          fs.unlinkSync(localVideoPath);
        } catch {
          // Ignore cleanup errors
        }

        // Step 5: Add subtitles to video
        sendEvent(controller, {
          type: 'subtitle_start',
          content: '正在添加字幕到视频...',
        });

        const subtitles = generateSubtitlesFromSegments(segments);

        // Prepare subtitle configuration
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

        try {
          const subtitleResponse = await videoEditClient.addSubtitles(
            accessibleVideoUrl,
            subtitleConfig,
            { textList }
          );

          if (subtitleResponse.url) {
            // Use video with embedded subtitles
            sendEvent(controller, {
              type: 'video_url',
              content: subtitleResponse.url,
            });
          } else {
            // Fallback to video without subtitles
            sendEvent(controller, {
              type: 'video_url',
              content: accessibleVideoUrl,
            });
          }
        } catch (subtitleError) {
          console.error('字幕添加失败，返回无字幕视频:', subtitleError);
          // If subtitle addition fails, return video without subtitles
          sendEvent(controller, {
            type: 'video_url',
            content: accessibleVideoUrl,
          });
        }

        sendEvent(controller, {
          type: 'subtitles',
          content: { subtitles },
        });

        // Done
        sendEvent(controller, {
          type: 'done',
          content: JSON.stringify({
            videoUrl: accessibleVideoUrl,
            duration: totalDuration,
            segments: segments.length,
          }),
        });
        controller.close();
      } catch (error) {
        console.error('视频生成失败:', error);
        sendEvent(controller, {
          type: 'error',
          content: error instanceof Error ? error.message : '生成失败',
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
