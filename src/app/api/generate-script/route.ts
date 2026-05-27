import { NextRequest } from 'next/server';
import { LLMClient, S3Storage, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScriptSegment {
  id: number;
  script: string;
  prompt: string;
  duration: number; // 秒
}

interface StreamData {
  type: 'identify' | 'script_start' | 'script_segment' | 'prompt_segment' | 'done' | 'error';
  content: string | ScriptSegment;
  segmentIndex?: number;
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
            model: 'doubao-seed-2-0-pro-260215',
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

        // Step 2: Generate segmented sales script (分段式抖音带货口播文案)
        const scriptPrompt = `你是一位专业的抖音带货主播和短视频导演，请为以下商品生成一段吸引人的分段式口播文案。

商品名称：${productName}
核心卖点：${productSellingPoints}
${productInfo ? `商品特征：${productInfo}` : ''}

要求：
1. 生成3-5段口播文案，每段独立描述一个广告切片场景
2. 每段文案25-40字，生动有趣，符合抖音风格
3. 分段逻辑建议：
   - 第1段：吸引注意力的开场钩子
   - 第2-3段：展示核心卖点和使用场景
   - 最后一段：引导购买的号召性结尾
4. 每段要有明确的画面感，方便后续视频制作
5. 适当加入表情符号和网络流行语

请严格按照以下JSON格式输出，不要有任何其他说明文字：
{
  "segments": [
    {"id": 1, "script": "第1段文案内容"},
    {"id": 2, "script": "第2段文案内容"},
    ...
  ]
}`;

        const scriptMessages = [{ role: 'user' as const, content: scriptPrompt }];
        const scriptStream = await llmClient.stream(scriptMessages, {
          model: 'doubao-seed-1-8-251228',
          temperature: 0.9,
        });

        let scriptResult = '';
        for await (const chunk of scriptStream) {
          if (chunk.content) {
            scriptResult += chunk.content.toString();
          }
        }

        // Parse script segments
        let scriptSegments: Array<{ id: number; script: string }> = [];
        try {
          // Extract JSON from response
          const jsonMatch = scriptResult.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            scriptSegments = parsed.segments || [];
          }
        } catch {
          // Fallback: split by newlines or numbered list
          const lines = scriptResult.split(/\n+/).filter((line: string) => line.trim());
          scriptSegments = lines.slice(0, 6).map((line: string, index: number) => ({
            id: index + 1,
            script: line.replace(/^\d+[\.、\)]\s*/, '').trim(),
          }));
        }

        sendEvent(controller, { 
          type: 'script_start', 
          content: `将生成${scriptSegments.length}段口播文案`,
          segmentIndex: scriptSegments.length 
        });

        // Step 3: Generate video prompt for each segment
        const allSegments: ScriptSegment[] = [];
        
        for (let i = 0; i < scriptSegments.length; i++) {
          const segment = scriptSegments[i];
          
          // Send script segment
          sendEvent(controller, {
            type: 'script_segment',
            content: {
              id: segment.id,
              script: segment.script,
              prompt: '',
              duration: 0,
            },
            segmentIndex: i,
          });

          // Generate video prompt for this segment
          const videoPromptText = `你是一位专业的短视频导演，请为以下商品片段生成火山引擎图生视频API的镜头描述。

商品名称：${productName}
口播文案片段：${segment.script}
${productInfo ? `商品特征：${productInfo}` : ''}

要求：
1. 镜头描述要生动展示这段文案表达的场景和卖点
2. 画面专业、清晰、光线明亮
3. 背景简洁美观，突出商品主体
4. 镜头运动流畅自然
5. 时长3-6秒
6. 描述要具体，包含镜头角度、运动方式、商品展示重点

请直接输出镜头描述，不要包含任何其他说明文字。示例格式：
"镜头从商品正面特写开始，缓慢推进展示商品细节，背景虚化突出商品主体，柔和侧光照射展现质感"`;

          const videoPromptMessages = [{ role: 'user' as const, content: videoPromptText }];
          const videoPromptStream = await llmClient.stream(videoPromptMessages, {
            model: 'doubao-seed-2-0-pro-260215',
            temperature: 0.8,
          });

          let videoPrompt = '';
          for await (const chunk of videoPromptStream) {
            if (chunk.content) {
              videoPrompt += chunk.content.toString();
            }
          }

          const segmentData: ScriptSegment = {
            id: segment.id,
            script: segment.script,
            prompt: videoPrompt.trim(),
            duration: 3 + Math.floor(Math.random() * 3), // 3-5秒
          };

          allSegments.push(segmentData);

          sendEvent(controller, {
            type: 'prompt_segment',
            content: segmentData,
            segmentIndex: i,
          });
        }

        // Done
        sendEvent(controller, { 
          type: 'done', 
          content: JSON.stringify({ 
            segments: allSegments,
            imageUrl: imageUrl 
          })
        });
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
