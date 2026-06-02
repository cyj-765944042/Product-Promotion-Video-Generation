import { NextRequest } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 创建商品文件夹
 * POST /api/video-task/init
 * Body: { productName: string }
 * 返回: { folderPath: string, folderName: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { productName } = body;

    if (!productName) {
      return new Response(JSON.stringify({ error: '缺少商品名称' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 清理商品名称，移除特殊字符
    const sanitizedName = productName.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, '_');
    
    // 在 public 文件夹中创建商品文件夹
    const publicDir = path.join(process.cwd(), 'public');
    
    // 确保public目录存在
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    // 查找可用的文件夹名称
    let folderName = sanitizedName;
    let folderPath = path.join(publicDir, folderName);
    let suffix = 0;
    
    while (fs.existsSync(folderPath)) {
      suffix++;
      folderName = `${sanitizedName}_${suffix}`;
      folderPath = path.join(publicDir, folderName);
    }
    
    // 创建文件夹
    fs.mkdirSync(folderPath, { recursive: true });
    
    // 创建子文件夹
    const audioDir = path.join(folderPath, 'audio');
    const videoDir = path.join(folderPath, 'video');
    fs.mkdirSync(audioDir, { recursive: true });
    fs.mkdirSync(videoDir, { recursive: true });
    
    console.log(`创建商品文件夹: ${folderPath}`);

    return new Response(JSON.stringify({
      folderPath,
      folderName,
      audioDir,
      videoDir,
      relativePath: `/${folderName}`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('创建文件夹失败:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : '创建文件夹失败' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
