import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, S3Storage, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;

    if (!imageFile || imageFile.size === 0) {
      return NextResponse.json({ error: '请上传图片' }, { status: 400 });
    }

    // Initialize clients
    const config = new Config();
    const llmClient = new LLMClient(config, customHeaders);
    const storage = new S3Storage();

    // Upload image to get URL
    const imageBuffer = await imageFile.arrayBuffer();
    const imageKey = await storage.uploadFile({
      fileContent: Buffer.from(imageBuffer),
      fileName: `identify/${Date.now()}.jpg`,
      contentType: imageFile.type || 'image/jpeg',
    });
    
    const imageUrl = await storage.generatePresignedUrl({
      key: imageKey,
      expireTime: 300, // 5 minutes for processing
    });

    // Use LLM vision to identify product
    const identifyPrompt = `请仔细分析这张商品图片，识别以下信息：

1. 商品名称：这是什么商品？请给出具体商品名称（例如：保温杯、手机壳、耳机等）
2. 商品类型：商品的品类分类
3. 材质判断：从外观判断可能的材质（如：不锈钢、塑料、玻璃、皮革等）
4. 特点分析：从外观能看出的产品特点（如：便携、时尚、防水等）
5. 建议卖点：根据图片中的商品特征，建议3-5个卖点

请以JSON格式返回，格式如下：
{
  "productName": "商品名称",
  "productType": "商品类型",
  "suggestedMaterials": ["材质1", "材质2"],
  "suggestedFeatures": ["特点1", "特点2"],
  "suggestedPoints": ["建议卖点1", "建议卖点2", "建议卖点3"]
}

只返回JSON，不要有其他文字。`;

    const messages = [
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

    const response = await llmClient.invoke(messages, {
      model: 'doubao-seed-2-0-pro-260215',
      temperature: 0.3,
    });

    // Parse JSON response
    let result;
    try {
      // Extract JSON from response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('无法解析识别结果');
      }
    } catch (e) {
      console.error('解析失败:', response.content);
      // Fallback result
      result = {
        productName: '商品',
        productType: '未知商品',
        suggestedMaterials: [],
        suggestedFeatures: [],
        suggestedPoints: [],
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('识别失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '识别失败' },
      { status: 500 }
    );
  }
}
