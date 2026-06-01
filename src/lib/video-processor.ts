import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Storage paths based on environment
const getStorageDir = () => {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';
  const baseDir = isDev 
    ? process.env.COZE_WORKSPACE_PATH || '/workspace/projects'
    : '/tmp';
  
  const storageDir = path.join(baseDir, 'public', 'videos');
  
  // Ensure directory exists
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  
  return storageDir;
};

/**
 * Download a file from URL to local storage
 */
export async function downloadFile(url: string, filename: string): Promise<string> {
  const storageDir = getStorageDir();
  const filePath = path.join(storageDir, filename);
  
  console.log(`Downloading: ${url} -> ${filePath}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  fs.writeFileSync(filePath, buffer);
  console.log(`Downloaded: ${filePath} (${buffer.length} bytes)`);
  
  return filePath;
}

/**
 * Generate SRT subtitle file
 */
export function generateSrtFile(
  subtitles: Array<{ start: number; end: number; text: string }>,
  filename: string
): string {
  const storageDir = getStorageDir();
  const srtPath = path.join(storageDir, filename);
  
  let srtContent = '';
  
  subtitles.forEach((sub, index) => {
    const startTime = formatSrtTime(sub.start);
    const endTime = formatSrtTime(sub.end);
    
    srtContent += `${index + 1}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${sub.text}\n\n`;
  });
  
  fs.writeFileSync(srtPath, srtContent, 'utf-8');
  console.log(`SRT file created: ${srtPath}`);
  
  return srtPath;
}

/**
 * Format time in SRT format (HH:MM:SS,mmm)
 */
function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * Merge video and audio using FFmpeg
 */
export async function mergeVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<string> {
  console.log(`Merging video and audio: ${videoPath} + ${audioPath} -> ${outputPath}`);
  
  const cmd = `ffmpeg -y -i "${videoPath}" -i "${audioPath}" \
    -c:v copy -c:a aac -strict experimental \
    -map 0:v:0 -map 1:a:0 \
    "${outputPath}"`;
  
  try {
    const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
    console.log('FFmpeg merge completed');
    if (stderr) console.log('FFmpeg stderr:', stderr.slice(0, 500));
  } catch (error) {
    console.error('FFmpeg merge error:', error);
    throw error;
  }
  
  return outputPath;
}

/**
 * Concatenate multiple videos using FFmpeg
 */
export async function concatenateVideos(
  videoPaths: string[],
  outputPath: string
): Promise<string> {
  console.log(`Concatenating ${videoPaths.length} videos -> ${outputPath}`);
  
  const storageDir = getStorageDir();
  const listFile = path.join(storageDir, 'concat_list.txt');
  
  // Create concat list file
  const listContent = videoPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(listFile, listContent);
  
  const cmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" \
    -c:v libx264 -preset fast -crf 23 \
    -c:a aac \
    "${outputPath}"`;
  
  try {
    const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 100 * 1024 * 1024 });
    console.log('FFmpeg concat completed');
    if (stderr) console.log('FFmpeg stderr:', stderr.slice(0, 500));
  } catch (error) {
    console.error('FFmpeg concat error:', error);
    throw error;
  } finally {
    // Cleanup list file
    if (fs.existsSync(listFile)) {
      fs.unlinkSync(listFile);
    }
  }
  
  return outputPath;
}

/**
 * Burn subtitles into video using FFmpeg (hard subs)
 */
export async function burnSubtitles(
  videoPath: string,
  srtPath: string,
  outputPath: string
): Promise<string> {
  console.log(`Burning subtitles: ${videoPath} + ${srtPath} -> ${outputPath}`);
  
  // Escape special characters in path for FFmpeg
  const escapedSrtPath = srtPath.replace(/'/g, "'\\''");
  const escapedVideoPath = videoPath.replace(/'/g, "'\\''");
  const escapedOutputPath = outputPath.replace(/'/g, "'\\''");
  
  // Use subtitles filter to burn in SRT
  // Font: Noto Sans CJK for Chinese support
  const cmd = `ffmpeg -y -i "${escapedVideoPath}" \
    -vf "subtitles='${escapedSrtPath}':force_style='FontName=Noto Sans CJK SC,FontSize=24,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,MarginV=30'" \
    -c:v libx264 -preset fast -crf 23 \
    -c:a copy \
    "${escapedOutputPath}"`;
  
  try {
    const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 100 * 1024 * 1024 });
    console.log('FFmpeg subtitle burn completed');
    if (stderr) console.log('FFmpeg stderr:', stderr.slice(0, 500));
  } catch (error) {
    console.error('FFmpeg subtitle burn error:', error);
    // Try alternative approach without font specification
    try {
      const fallbackCmd = `ffmpeg -y -i "${escapedVideoPath}" \
        -vf "subtitles='${escapedSrtPath}'" \
        -c:v libx264 -preset fast -crf 23 \
        -c:a copy \
        "${escapedOutputPath}"`;
      
      await execAsync(fallbackCmd, { maxBuffer: 100 * 1024 * 1024 });
      console.log('FFmpeg subtitle burn (fallback) completed');
    } catch (fallbackError) {
      console.error('FFmpeg fallback also failed:', fallbackError);
      // If subtitle burn fails, just copy the video
      fs.copyFileSync(videoPath, outputPath);
    }
  }
  
  return outputPath;
}

/**
 * Full video processing pipeline
 */
export async function processVideoPipeline(
  options: {
    videoUrls: string[];
    audioUrls: string[];
    subtitles: Array<{ start: number; end: number; text: string }>;
    outputFilename: string;
  }
): Promise<{ localPath: string; publicUrl: string }> {
  const { videoUrls, audioUrls, subtitles, outputFilename } = options;
  const storageDir = getStorageDir();
  const timestamp = Date.now();
  
  // Step 1: Download all videos and audios
  const localVideos: string[] = [];
  const localAudios: string[] = [];
  
  for (let i = 0; i < videoUrls.length; i++) {
    const videoPath = await downloadFile(
      videoUrls[i], 
      `segment_${timestamp}_${i}.mp4`
    );
    localVideos.push(videoPath);
    
    if (audioUrls[i]) {
      const audioPath = await downloadFile(
        audioUrls[i],
        `audio_${timestamp}_${i}.mp3`
      );
      localAudios.push(audioPath);
    }
  }
  
  // Step 2: Merge audio into each video segment
  const mergedVideos: string[] = [];
  
  for (let i = 0; i < localVideos.length; i++) {
    if (localAudios[i]) {
      const mergedPath = path.join(storageDir, `merged_${timestamp}_${i}.mp4`);
      await mergeVideoAudio(localVideos[i], localAudios[i], mergedPath);
      mergedVideos.push(mergedPath);
    } else {
      mergedVideos.push(localVideos[i]);
    }
  }
  
  // Step 3: Concatenate all videos
  let finalVideoPath: string;
  
  if (mergedVideos.length > 1) {
    finalVideoPath = path.join(storageDir, `concat_${timestamp}.mp4`);
    await concatenateVideos(mergedVideos, finalVideoPath);
  } else {
    finalVideoPath = mergedVideos[0];
  }
  
  // Step 4: Generate SRT and burn subtitles
  if (subtitles.length > 0) {
    const srtPath = generateSrtFile(subtitles, `subs_${timestamp}.srt`);
    const finalWithSubsPath = path.join(storageDir, outputFilename);
    
    await burnSubtitles(finalVideoPath, srtPath, finalWithSubsPath);
    finalVideoPath = finalWithSubsPath;
    
    // Cleanup SRT
    if (fs.existsSync(srtPath)) {
      fs.unlinkSync(srtPath);
    }
  }
  
  // Step 5: Generate public URL
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';
  const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
  
  // Extract filename from path
  const filename = path.basename(finalVideoPath);
  
  // Public URL path
  const publicUrl = isDev 
    ? `/videos/${filename}`  // In dev, files are in public/videos
    : `/api/download?file=${filename}`;  // In prod, serve via API
  
  console.log(`Final video: ${finalVideoPath}`);
  console.log(`Public URL: ${publicUrl}`);
  
  // Cleanup intermediate files
  try {
    for (const file of [...localVideos, ...localAudios, ...mergedVideos]) {
      if (fs.existsSync(file) && file !== finalVideoPath) {
        fs.unlinkSync(file);
      }
    }
  } catch (cleanupError) {
    console.warn('Cleanup warning:', cleanupError);
  }
  
  return {
    localPath: finalVideoPath,
    publicUrl
  };
}

/**
 * Get file stats
 */
export function getFileStats(filePath: string): { size: number; exists: boolean } {
  try {
    const stats = fs.statSync(filePath);
    return { size: stats.size, exists: true };
  } catch {
    return { size: 0, exists: false };
  }
}
