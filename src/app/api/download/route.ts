import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filename = searchParams.get('file');

  if (!filename) {
    return NextResponse.json({ error: '缺少文件名' }, { status: 400 });
  }

  // Security: prevent path traversal
  const safeFilename = path.basename(filename);
  
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';
  const baseDir = isDev 
    ? process.env.COZE_WORKSPACE_PATH || '/workspace/projects'
    : '/tmp';
  
  const filePath = path.join(baseDir, 'public', 'videos', safeFilename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size.toString(),
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('File read error:', error);
    return NextResponse.json({ error: '文件读取失败' }, { status: 500 });
  }
}
