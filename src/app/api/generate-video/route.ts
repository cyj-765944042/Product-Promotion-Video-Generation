import { NextRequest } from 'next/server';
import { LLMClient, VideoGenerationClient, S3Storage, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StreamData {
  type: 'video_url' | 'subtitles' | 'done' | 'error';
  content: string | Subtitle[];
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

// Generate subtitles from script text
function generateSubtitles(script: string, videoDuration: number): Subtitle[] {
  // Clean the script and split by punctuation
  const cleanScript = script.replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。！？、；：""''！？~\s]/g, '');
  
  // Split by Chinese and English punctuation
  const segments = cleanScript.split(/(?<=[，。！？、；：！？])\s*|(?<=[。！？])/g).filter(s => s.trim());
  
  if (segments.length === 0) {
    return [];
  }

  const subtitles: Subtitle[] = [];
  const avgDuration = videoDuration / segments.length;
  let currentTime = 0;

  for (const segment of segments) {
    const text = segment.trim();
    if (text) {
      // Calculate duration based on text length (longer text = more time)
      const textLength = text.length;
      const baseDuration = Math.max(avgDuration, 1.5);
      const duration = Math.min(textLength * 0.15, 4); // Max 4 seconds per segment
      
      subtitles.push({
        start: currentTime,
        end: currentTime + duration,
        text: text,
      });
      
      currentTime += duration;
    }
  }

  // Adjust the last subtitle to match video duration
  if (subtitles.length > 0) {
    subtitles[subtitles.length - 1].end = videoDuration;
  }

  return subtitles;
}

export async function POST(request: NextRequest) {
  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  
  // Parse form data
  const formData = await request.formData();
  const productName = formData.get('productName') as string;
  const script = formData.get('script') as string;
  const videoPrompt = formData.get('videoPrompt') as string;
  const productImageFile = formData.get('productImage') as File | null;

  if (!script || !videoPrompt) {
    return new Response(JSON.stringify({ error: '缺少必要参数' }), {
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
        const storage = new S3Storage();

        let imageUrl: string | undefined;

        // Upload image if provided
        if (productImageFile && productImageFile.size > 0) {
          const imageBuffer = await productImageFile.arrayBuffer();
          const imageKey = await storage.uploadFile({
            fileContent: Buffer.from(imageBuffer),
            fileName: `products/${productName}_${Date.now()}.jpg`,
            contentType: productImageFile.type || 'image/jpeg',
          });
          imageUrl = await storage.generatePresignedUrl({
            key: imageKey,
            expireTime: 86400,
          });
        }

        // Generate video
        const content: any[] = [];
        
        if (imageUrl) {
          // Image-to-video: use uploaded product image as first frame
          content.push({
            type: 'image_url' as const,
            image_url: { url: imageUrl },
            role: 'first_frame' as const,
          });
        }
        
        content.push({
          type: 'text' as const,
          text: videoPrompt.trim(),
        });

        const videoResponse = await videoClient.videoGeneration(content, {
          model: 'doubao-seedance-1-5-pro-251215',
          duration: 6,
          ratio: '16:9',
          resolution: '720p',
          generateAudio: true,
        });

        if (!videoResponse.videoUrl) {
          throw new Error('视频生成失败：未返回视频URL');
        }

        sendEvent(controller, { type: 'video_url', content: videoResponse.videoUrl });

        // Generate subtitles
        const videoDuration = videoResponse.response.duration || 6;
        const subtitles = generateSubtitles(script, videoDuration);

        sendEvent(controller, { type: 'subtitles', content: subtitles });

        // Done
        sendEvent(controller, { type: 'done', content: '生成完成' });
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
