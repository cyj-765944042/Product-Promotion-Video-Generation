import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Local storage paths
const LOCAL_STORAGE_DIR = process.env.COZE_PROJECT_ENV === 'PROD' 
  ? '/tmp/video-generation' 
  : path.join(process.cwd(), 'public', 'temp-videos');

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const file = searchParams.get('file');
    
    if (!file) {
      return new NextResponse('Missing file parameter', { status: 400 });
    }
    
    // Security: prevent directory traversal attacks
    const normalizedFile = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(LOCAL_STORAGE_DIR, normalizedFile);
    
    // Ensure the path is within the allowed directory
    if (!filePath.startsWith(LOCAL_STORAGE_DIR)) {
      return new NextResponse('Access denied', { status: 403 });
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return new NextResponse('File not found', { status: 404 });
    }
    
    // Read file
    const fileBuffer = fs.readFileSync(filePath);
    
    // Determine content type
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.webm': 'video/webm',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
    };
    
    const contentType = contentTypes[ext] || 'application/octet-stream';
    
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
    
  } catch (error) {
    console.error('Local file serve error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
