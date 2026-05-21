import { NextRequest } from 'next/server';
import { LLMClient, VideoGenerationClient, S3Storage, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StreamData {
  type: 'script' | 'prompt' | 'video_url' | 'done' | 'error';
  content: string;
}

async function sendEvent(controller: ReadableStreamDefaultController, data: StreamData) {
  const encoder = new TextEncoder();
  const message = `data: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(message));
}

export async function POST(request: NextRequest) {
  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  
  // Parse form data
  const formData = await request.formData();
  const productName = formData.get('productName') as string;
  const productSellingPoints = formData.get('productSellingPoints') as string;
  const productImageFile = formData.get('productImage') as File | null;

  if (!productName || !productSellingPoints) {
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
        const llmClient = new LLMClient(config, customHeaders);
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

        // Step 1: Generate sales script
        const scriptPrompt = `你是一位专业的带货主播，请为以下商品生成一段吸引人的口播文案。

商品名称：${productName}
商品卖点：${productSellingPoints}

要求：
1. 文案要生动有趣，能吸引观众注意力
2. 突出商品的核心卖点和优势
3. 语言要口语化，适合视频口播
4. 长度控制在100-150字
5. 要有引导购买的号召性语言

请直接输出文案内容，不要有其他说明。`;

        const scriptMessages = [{ role: 'user' as const, content: scriptPrompt }];
        const scriptStream = await llmClient.stream(scriptMessages, {
          model: 'doubao-seed-1-8-251228',
          temperature: 0.8,
        });

        let script = '';
        for await (const chunk of scriptStream) {
          if (chunk.content) {
            script += chunk.content.toString();
          }
        }

        sendEvent(controller, { type: 'script', content: script.trim() });

        // Step 2: Generate video prompt
        const videoPromptText = `你是一位专业的视频导演，请根据以下信息生成视频镜头描述。

商品名称：${productName}
商品卖点：${productSellingPoints}
口播文案：${script}

请生成一个适合带货短视频的镜头描述，要求：
1. 镜头要生动展示商品特点
2. 画面要专业、清晰
3. 光线明亮，背景简洁
4. 展示商品使用场景
5. 镜头时长5-8秒

请直接输出镜头描述，例如："镜头从商品正面特写开始，慢慢旋转展示商品全貌，背景简洁明亮，突出商品的质感和设计细节"
不要包含任何其他说明文字。`;

        const videoPromptMessages = [{ role: 'user' as const, content: videoPromptText }];
        const videoPromptStream = await llmClient.stream(videoPromptMessages, {
          model: 'doubao-seed-1-8-251228',
          temperature: 0.7,
        });

        let videoPrompt = '';
        for await (const chunk of videoPromptStream) {
          if (chunk.content) {
            videoPrompt += chunk.content.toString();
          }
        }

        sendEvent(controller, { type: 'prompt', content: videoPrompt.trim() });

        // Step 3: Generate video
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

        // Done
        sendEvent(controller, { type: 'done', content: '生成完成' });
        controller.close();
      } catch (error) {
        console.error('生成失败:', error);
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
