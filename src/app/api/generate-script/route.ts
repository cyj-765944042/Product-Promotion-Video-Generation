import { NextRequest } from 'next/server';
import { LLMClient, S3Storage, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StreamData {
  type: 'identify' | 'script' | 'prompt' | 'done' | 'error';
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
        const storage = new S3Storage();

        let productInfo = '';
        let imageUrl: string | undefined;

        // Step 1: Identify product image if provided
        if (productImageFile && productImageFile.size > 0) {
          // Upload image
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

          // Use LLM vision to identify product
          const identifyPrompt = `请识别这张商品图片中的关键信息，包括：
1. 商品外观特征（颜色、形状、材质等）
2. 商品使用场景
3. 商品设计亮点

请用简洁的语言描述，不超过100字。`;

          const identifyMessages = [
            {
              role: 'user' as const,
              content: [
                { type: 'text' as const, text: identifyPrompt },
                {
                  type: 'image_url' as const,
                  image_url: { url: imageUrl },
                },
              ],
            },
          ];

          const identifyStream = await llmClient.stream(identifyMessages, {
            model: 'doubao-seed-1-8-251228',
            temperature: 0.7,
          });

          for await (const chunk of identifyStream) {
            if (chunk.content) {
              productInfo += chunk.content.toString();
            }
          }

          sendEvent(controller, { type: 'identify', content: productInfo.trim() });
        } else {
          // No image, use basic product info
          productInfo = `商品名称：${productName}，核心卖点：${productSellingPoints}`;
          sendEvent(controller, { type: 'identify', content: productInfo });
        }

        // Step 2: Generate sales script (抖音带货口播文案)
        const scriptPrompt = `你是一位专业的抖音带货主播，请为以下商品生成一段吸引人的口播文案。

商品名称：${productName}
核心卖点：${productSellingPoints}
${productInfo ? `商品特征：${productInfo}` : ''}

要求：
1. 开头要有吸引人的钩子，比如"家人们看过来！"、"这个真的绝了！"
2. 语言要生动有趣，符合抖音风格
3. 突出商品的核心卖点和优势，用具体的使用场景描述
4. 加入适当的表情符号和网络流行语
5. 结尾要有引导购买的号召性语言，比如"快冲！"、"手慢无！"
6. 长度控制在120-180字

请直接输出文案内容，不要有其他说明。`;

        const scriptMessages = [{ role: 'user' as const, content: scriptPrompt }];
        const scriptStream = await llmClient.stream(scriptMessages, {
          model: 'doubao-seed-1-8-251228',
          temperature: 0.9,
        });

        let script = '';
        for await (const chunk of scriptStream) {
          if (chunk.content) {
            script += chunk.content.toString();
          }
        }

        sendEvent(controller, { type: 'script', content: script.trim() });

        // Step 3: Generate video prompt for 火山引擎
        const videoPromptText = `你是一位专业的短视频导演，请根据以下商品信息生成适合火山引擎图生视频API的视频镜头描述。

商品名称：${productName}
核心卖点：${productSellingPoints}
口播文案：${script}
${productInfo ? `商品特征：${productInfo}` : ''}

请生成一个适合带货短视频的镜头描述，要求：
1. 镜头要生动展示商品特点和使用场景
2. 画面要专业、清晰、光线明亮
3. 背景简洁美观，突出商品主体
4. 镜头运动流畅自然
5. 时长约5-8秒

请直接输出镜头描述，不要包含任何其他说明文字。
示例格式："镜头从商品正面特写开始，慢慢旋转展示商品全貌，背景简洁明亮，突出商品的质感和设计细节，柔和的光线照射，展示商品在不同角度的美感"`;

        const videoPromptMessages = [{ role: 'user' as const, content: videoPromptText }];
        const videoPromptStream = await llmClient.stream(videoPromptMessages, {
          model: 'doubao-seed-1-8-251228',
          temperature: 0.8,
        });

        let videoPrompt = '';
        for await (const chunk of videoPromptStream) {
          if (chunk.content) {
            videoPrompt += chunk.content.toString();
          }
        }

        sendEvent(controller, { type: 'prompt', content: videoPrompt.trim() });

        // Done
        sendEvent(controller, { type: 'done', content: '文案生成完成' });
        controller.close();
      } catch (error) {
        console.error('文案生成失败:', error);
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
