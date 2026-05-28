import { NextRequest } from 'next/server';
import { 
  VideoGenerationClient, 
  VideoEditClient,
  S3Storage, 
  Config, 
  HeaderUtils
} from 'coze-coding-dev-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScriptSegment {
  id: number;
  script: string;
  prompt: string;
  duration: number;
}

interface StreamData {
  type: 'segment_start' | 'segment_video' | 'concat_start' | 'video_url' | 'subtitles' | 'done' | 'error';
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
        // Initialize clients
        const config = new Config();
        const videoClient = new VideoGenerationClient(config, customHeaders);
        const videoEditClient = new VideoEditClient(config, customHeaders);
        const storage = new S3Storage();

        const segmentVideoUrls: string[] = [];

        // Step 1: Generate video for each segment
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
          
          content.push({
            type: 'text' as const,
            text: segment.prompt,
          });

          // Generate video with minimal parameters to avoid 400 errors
          const videoResponse = await videoClient.videoGeneration(content, {
            model: 'doubao-seedance-1-5-pro-251215',
            duration: Math.max(4, Math.min(12, segment.duration || 5)), // Ensure duration is between 4-12
            ratio: '16:9',
          });

          if (!videoResponse.videoUrl) {
            throw new Error(`第 ${i + 1} 段视频生成失败`);
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

        const finalVideoUrl = concatResponse.url;
        const totalDuration = concatResponse.video_meta?.duration || segments.reduce((sum, s) => sum + (s.duration || 4), 0);

        // Step 3: Generate subtitles
        const subtitles = generateSubtitlesFromSegments(segments);

        // Return video URL and subtitles (subtitles will be displayed on frontend)
        sendEvent(controller, {
          type: 'video_url',
          content: finalVideoUrl,
        });

        sendEvent(controller, {
          type: 'subtitles',
          content: { subtitles },
        });

        // Done
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
