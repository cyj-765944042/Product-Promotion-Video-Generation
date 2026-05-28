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
  type: 'segment_start' | 'segment_video' | 'concat_start' | 'download_start' | 'upload_start' | 'subtitle_start' | 'video_url' | 'subtitles' | 'done' | 'error';
  content: string | { segmentId: number; videoUrl: string } | { subtitles: Subtitle[] };
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
  
  // Parse form data
  const formData = await request.formData();
  const productName = formData.get('productName') as string;
  const segmentsJson = formData.get('segments') as string;
  const imageUrl = formData.get('imageUrl') as string | null;

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
        // Initialize clients with extended timeout for video processing
        // Note: API credentials are loaded from environment variables automatically
        // If you encounter 403 errors, ensure the following env vars are set:
        // - COZE_API_KEY or ARK_API_KEY
        // - COZE_BASE_URL or ARK_BASE_URL (for specific EP)
        
        // Use default configuration - SDK will load credentials from environment variables
        const config = new Config({ 
          timeout: 120000, // 120 seconds for video processing
        });
        const videoClient = new VideoGenerationClient(config, customHeaders);
        const videoEditClient = new VideoEditClient(config, customHeaders);
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
          
          // Use product image as first frame for the first segment only
          if (imageUrl && i === 0) {
            content.push({
              type: 'image_url' as const,
              image_url: { url: imageUrl },
              role: 'first_frame' as const,
            });
          }
          
          // Add the visual prompt for video generation
          content.push({
            type: 'text' as const,
            text: segment.prompt,
          });
          
          // Generate video with the visual prompt only
          // Audio will be added in post-processing if needed
          let videoResponse;
          try {
            videoResponse = await videoClient.videoGeneration(content, {
              model: 'doubao-seedance-1-5-pro-251215',
              duration: Math.max(4, Math.min(12, segment.duration || 5)),
              ratio: '16:9',
            });
          } catch (error) {
            console.error('视频生成API错误:', error);
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

        // Step 2: Concatenate all segment videos
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
