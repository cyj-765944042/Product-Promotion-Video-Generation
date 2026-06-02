import { NextRequest } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StreamData {
  type: 'merge_start' | 'merge_progress' | 'concat_start' | 'complete' | 'error';
  content: string | object;
}

function sendEvent(controller: ReadableStreamDefaultController, data: StreamData) {
  const encoder = new TextEncoder();
  const message = `data: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(message));
}

/**
 * 合成最终视频
 * POST /api/video-task/compose
 * Body: { folderPath: string, segments: [{ audioPath, videoPath, script }] }
 */
export async function POST(request: NextRequest) {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body = await request.json();
        const { folderPath, segments } = body as {
          folderPath: string;
          segments: Array<{
            audioPath: string;
            videoPath: string;
            script: string;
          }>;
        };

        if (!folderPath || !segments || segments.length === 0) {
          sendEvent(controller, { type: 'error', content: '缺少必要参数' });
          controller.close();
          return;
        }

        const outputDir = folderPath;
        const mergedVideos: string[] = [];

        // Step 1: 合并每个视频的音频
        sendEvent(controller, { 
          type: 'merge_start', 
          content: `正在合并 ${segments.length} 个视频片段的音频...` 
        });

        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          const mergedVideoPath = path.join(outputDir, `merged_${i + 1}.mp4`);
          
          // 使用 FFmpeg 合并音频和视频
          const cmd = `ffmpeg -y -i "${segment.videoPath}" -i "${segment.audioPath}" -c:v copy -c:a aac -shortest "${mergedVideoPath}"`;
          execSync(cmd, { stdio: 'pipe' });
          
          mergedVideos.push(mergedVideoPath);
          
          sendEvent(controller, {
            type: 'merge_progress',
            content: `已完成 ${i + 1}/${segments.length} 个视频片段的音频合并`,
          });
        }

        // Step 2: 生成字幕文件
        const srtPath = path.join(outputDir, 'subtitles.srt');
        let srtContent = '';
        let currentTime = 0;

        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          // 获取音频时长
          const durationCmd = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${segment.audioPath}"`;
          const duration = parseFloat(execSync(durationCmd, { encoding: 'utf-8' }).trim());
          
          const startTime = currentTime;
          const endTime = currentTime + duration;
          
          // SRT 时间格式
          const formatTime = (seconds: number) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            const ms = Math.floor((seconds % 1) * 1000);
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
          };
          
          srtContent += `${i + 1}\n`;
          srtContent += `${formatTime(startTime)} --> ${formatTime(endTime)}\n`;
          srtContent += `${segment.script}\n\n`;
          
          currentTime = endTime;
        }

        fs.writeFileSync(srtPath, srtContent, 'utf-8');

        // Step 3: 拼接视频
        sendEvent(controller, { 
          type: 'concat_start', 
          content: '正在拼接视频片段...' 
        });

        // 创建文件列表
        const listPath = path.join(outputDir, 'filelist.txt');
        const listContent = mergedVideos.map(v => `file '${v}'`).join('\n');
        fs.writeFileSync(listPath, listContent, 'utf-8');

        // 拼接视频
        const concatenatedPath = path.join(outputDir, 'concatenated.mp4');
        const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${concatenatedPath}"`;
        execSync(concatCmd, { stdio: 'pipe' });

        // Step 4: 添加字幕
        const finalVideoPath = path.join(outputDir, `final_${Date.now()}.mp4`);
        const subtitleCmd = `ffmpeg -y -i "${concatenatedPath}" -vf "subtitles='${srtPath.replace(/'/g, "'\\''")}'" -c:a copy "${finalVideoPath}"`;
        execSync(subtitleCmd, { stdio: 'pipe' });

        // 获取最终视频时长
        const finalDurationCmd = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalVideoPath}"`;
        const finalDuration = parseFloat(execSync(finalDurationCmd, { encoding: 'utf-8' }).trim());

        sendEvent(controller, {
          type: 'complete',
          content: {
            videoUrl: `/${path.basename(folderPath)}/${path.basename(finalVideoPath)}`,
            videoLocalPath: finalVideoPath,
            duration: finalDuration,
          },
        });

        controller.close();
      } catch (error) {
        console.error('合成失败:', error);
        sendEvent(controller, {
          type: 'error',
          content: error instanceof Error ? error.message : '合成失败',
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
