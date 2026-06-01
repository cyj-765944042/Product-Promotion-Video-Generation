import { NextRequest, NextResponse } from 'next/server';

/**
 * 图像抠图API - 使用火山引擎图像分割服务
 * 支持两种模式：
 * 1. auto - 自动分割（无需点击点）
 * 2. point - 点击分割（需要提供点击点坐标）
 */

interface SegmentRequest {
  imageUrl: string;
  mode?: 'auto' | 'point';
  points?: Array<{ x: number; y: number; label: number }>; // label: 1=前景, 0=背景
}

interface ApiErrorResponse {
  error?: string;
  message?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: SegmentRequest = await request.json();
    const { imageUrl, mode = 'auto', points } = body;

    if (!imageUrl) {
      return NextResponse.json({ error: '请提供图片URL' }, { status: 400 });
    }

    const apiKey = process.env.ARK_API_KEY;
    const baseUrl = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com';

    // 方案1: 使用火山引擎图像分割API
    try {
      const response = await fetch(`${baseUrl}/api/v3/contents/image/segment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_url: imageUrl,
          mode: mode,
          points: mode === 'point' ? points : undefined,
          return_mask: true,
          return_transparent_image: true,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.transparent_image_url) {
          return NextResponse.json({
            success: true,
            resultImage: data.transparent_image_url,
            maskImage: data.mask_url,
          });
        }
      }
    } catch (apiError) {
      console.log('火山引擎图像分割API调用失败，尝试备用方案...', apiError);
    }

    // 方案2: 使用clipdrop API (需要单独的API key)
    // 方案3: 使用remove.bg API (需要单独的API key)
    
    // 当前火山引擎API可能不支持直接抠图，返回提示信息
    return NextResponse.json({
      success: false,
      error: '火山引擎图像分割API暂不可用',
      suggestion: '可以使用以下替代方案：1. 上传已抠好背景的PNG图片 2. 使用第三方抠图工具处理后再上传',
    }, { status: 503 });

  } catch (error) {
    console.error('图像分割失败:', error);
    
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    
    // 检查是否是 fetch 相关错误
    if (error instanceof TypeError && errorMessage.includes('fetch')) {
      return NextResponse.json({
        error: `网络请求失败: ${errorMessage}`,
      }, { status: 502 });
    }
    
    return NextResponse.json({
      error: '图像分割失败，请稍后重试',
      details: errorMessage,
    }, { status: 500 });
  }
}
