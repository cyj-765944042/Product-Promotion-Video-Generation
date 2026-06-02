import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import type { Message } from 'coze-coding-dev-sdk';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageUrl } = body;

    if (!imageUrl) {
      return NextResponse.json({ error: '缺少图片URL' }, { status: 400 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    // 使用 LLM 分析图片
    const systemPrompt = `你是一个专业的电商商品分析专家。请分析用户上传的商品图片，识别出商品信息。

你需要返回以下信息（JSON格式）：
1. productName: 商品名称，简洁明了，不超过10个字
2. features: 商品特点数组，包含4-6个特点，每个特点不超过8个字

返回格式示例：
{
  "productName": "智能保温杯",
  "features": ["304不锈钢", "保温保冷", "便携轻便", "大容量", "防漏设计"]
}

只返回JSON，不要包含其他内容。`;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请分析这张商品图片，识别商品名称和特点。' },
          {
            type: 'image_url',
            image_url: {
              url: imageUrl,
              detail: 'high',
            },
          },
        ],
      },
    ];

    const response = await client.invoke(messages, {
      model: 'doubao-seed-2-0-lite-260215',
      temperature: 0.3,
    });

    const content = response.content || '';
    
    // 解析 JSON
    let analysisResult;
    try {
      // 尝试提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        analysisResult = JSON.parse(content);
      }
    } catch {
      // 如果解析失败，返回默认值
      analysisResult = {
        productName: '未识别商品',
        features: ['高品质', '实用设计', '性价比高', '值得拥有'],
      };
    }

    return NextResponse.json({
      success: true,
      productName: analysisResult.productName || '未识别商品',
      features: analysisResult.features || ['高品质', '实用设计', '性价比高', '值得拥有'],
    });
  } catch (error) {
    console.error('图片分析失败:', error);
    return NextResponse.json(
      { error: '图片分析失败，请重试' },
      { status: 500 }
    );
  }
}
