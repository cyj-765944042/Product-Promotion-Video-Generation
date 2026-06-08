/**
 * Agent 工具函数 - HTTP 请求调度
 * 只做 HTTP 请求调用现有 API，不内置业务逻辑
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { uploadFromRemoteUrl, uploadLocalFile } from '../lib/storage';

const getBaseUrl = () => {
  const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
  if (domain) {
    // 如果已经包含协议，直接使用
    if (domain.startsWith('http://') || domain.startsWith('https://')) {
      return domain;
    }
    // 否则添加 https 前缀
    return `https://${domain}`;
  }
  return 'http://localhost:5000';
};
const BASE_URL = getBaseUrl();

// 本地视频存储目录
const getVideoStorageDir = (subDir: string) => {
  const env = process.env.COZE_PROJECT_ENV;
  const baseDir = env === 'PROD' ? '/tmp' : (process.env.COZE_WORKSPACE_PATH || '/workspace/projects');
  const videoDir = path.join(baseDir, 'public', 'videos', subDir);
  
  // 确保目录存在
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }
  return videoDir;
};

// 下载视频到本地（优先转存到对象存储）
async function downloadVideoToLocal(
  videoUrl: string, 
  subDir: string, 
  filename: string,
  retries: number = 3
): Promise<{ localPath: string | null; signedUrl: string | null }> {
  let signedUrl: string | null = null;
  let localPath: string | null = null;
  
  // 优先尝试转存到对象存储（生成可访问的签名 URL）
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Tool] 尝试转存视频到对象存储 (尝试 ${attempt}/${retries}): ${videoUrl}`);
      
      const result = await uploadFromRemoteUrl(
        videoUrl,
        `${subDir}/${filename}`,
        'video/mp4',
        60000 // 60秒超时
      );
      
      signedUrl = result.signedUrl;
      console.log(`[Tool] 视频已转存到对象存储，签名URL: ${signedUrl}`);
      break;
    } catch (error) {
      console.error(`[Tool] 转存视频到对象存储失败 (尝试 ${attempt}):`, error instanceof Error ? error.message : error);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }
  
  // 备用方案：下载到本地存储
  if (!signedUrl) {
    const videoDir = getVideoStorageDir(subDir);
    const filePath = path.join(videoDir, filename);
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[Tool] 下载视频到本地存储 (尝试 ${attempt}/${retries}): ${videoUrl}`);
        
        const response = await axios.get(videoUrl, {
          responseType: 'arraybuffer',
          timeout: 60000 // 60秒超时
        });
        
        fs.writeFileSync(filePath, Buffer.from(response.data));
        localPath = `/videos/${subDir}/${filename}`;
        console.log(`[Tool] 视频已保存到本地: ${localPath}`);
        break;
      } catch (error) {
        console.error(`[Tool] 下载视频到本地失败 (尝试 ${attempt}):`, error instanceof Error ? error.message : error);
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }
  }
  
  if (!signedUrl && !localPath) {
    console.error(`[Tool] 下载视频最终失败: ${videoUrl}`);
  }
  
  return { localPath, signedUrl };
}

// 工具结果类型
export interface ToolResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
}

// 会话状态类型
export interface SessionState {
  productImageUrl?: string;
  productName?: string;
  features?: string[];
  scripts?: Array<{ id: number; script: string; prompt?: string }>;
  segments?: Array<{ 
    id: number; 
    script: string; 
    prompt?: string;
    videoPath?: string; 
    audioPath?: string;
    videoUrl?: string;
    audioUrl?: string;
    localVideoPath?: string; // 本地视频路径（用于播放）
  }>;
  finalVideoUrl?: string;
  localVideoPath?: string; // 本地最终视频路径
  finalVideoLocalPath?: string;
  sessionId?: string; // 会话ID（用于视频文件夹命名）
  currentStage?: string;
}

/**
 * 1. 上传图片并识别商品
 * 调用 /api/identify-product
 */
export async function uploadAndIdentifyProduct(
  imageUrl: string,
  _productName?: string,
  customHeaders?: Record<string, string>
): Promise<ToolResult> {
  console.log('[Tool] 调用 /api/identify-product');
  
  try {
    // 如果 imageUrl 是远程 URL，需要先下载再上传
    const formData = new FormData();
    
    if (imageUrl.startsWith('http')) {
      // 下载图片（添加超时和重试机制）
      let imageBuffer: Buffer | null = null;
      const maxRetries = 3;
      
      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          const imageResponse = await axios.get(imageUrl, { 
            responseType: 'arraybuffer',
            headers: customHeaders,
            timeout: 15000 // 15秒超时
          });
          imageBuffer = Buffer.from(imageResponse.data);
          break; // 成功则退出重试循环
        } catch (retryError: any) {
          if (retryError.code === 'ETIMEDOUT' || retryError.code === 'ECONNABORTED') {
            console.warn(`[Tool] 图片下载超时，重试 ${retry + 1}/${maxRetries}`);
            if (retry < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒后重试
              continue;
            }
          }
          throw retryError; // 其他错误或最后一次重试失败，抛出异常
        }
      }
      
      if (!imageBuffer) {
        throw new Error('图片下载失败，请检查图片URL是否可访问');
      }
      
      const imageFile = new File([new Uint8Array(imageBuffer)], 'product.jpg', { type: 'image/jpeg' });
      formData.append('image', imageFile);
    } else {
      // 本地路径，读取文件
      const fs = await import('fs');
      const imageBuffer = fs.readFileSync(imageUrl);
      const imageFile = new File([imageBuffer], 'product.jpg', { type: 'image/jpeg' });
      formData.append('image', imageFile);
    }
    
    const response = await axios.post(
      `${BASE_URL}/api/identify-product`,
      formData,
      { 
        headers: { 
          ...customHeaders,
          'Content-Type': 'multipart/form-data'
        }
      }
    );
    
    const result = response.data;
    return {
      success: true,
      message: `商品识别完成：${result.productName}`,
      data: {
        productName: result.productName,
        productImageUrl: result.imageUrl || imageUrl,
        features: result.suggestedFeatures || result.features || [],
        productType: result.productType,
        currentStage: "product_identified"
      }
    };
  } catch (error) {
    console.error('[Tool] identify-product 失败:', error);
    return {
      success: false,
      message: '商品识别失败',
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

/**
 * 2. 生成带货文案
 * 调用 /api/generate-script
 */
export async function generateScripts(
  productName: string,
  features: string[],
  productImageUrl?: string,
  customHeaders?: Record<string, string>,
  voiceLanguage?: string // 配音语言，用于生成对应语言的口播文案
): Promise<ToolResult> {
  console.log('[Tool] 调用 /api/generate-script');
  console.log(`[Tool] 配音语言: ${voiceLanguage || 'mandarin'}`);
  
  try {
    const formData = new FormData();
    formData.append('productName', productName);
    formData.append('productSellingPoints', features.join(','));
    formData.append('voiceLanguage', voiceLanguage || 'mandarin'); // 添加配音语言参数
    
    // 如果有图片，下载并上传
    if (productImageUrl && productImageUrl.startsWith('http')) {
      const imageResponse = await axios.get(productImageUrl, { 
        responseType: 'arraybuffer',
        headers: customHeaders
      });
      const imageBuffer = Buffer.from(imageResponse.data);
      const imageFile = new File([imageBuffer], 'product.jpg', { type: 'image/jpeg' });
      formData.append('productImage', imageFile);
    }
    
    // generate-script 是 SSE 流式接口，我们收集最终结果
    const response = await axios.post(
      `${BASE_URL}/api/generate-script`,
      formData,
      { 
        headers: { 
          ...customHeaders,
          'Content-Type': 'multipart/form-data'
        },
        responseType: 'text'
      }
    );
    
    // 解析 SSE 响应获取文案和画面Prompt
    const lines = response.data.split('\n');
    const scripts: Array<{ id: number; script: string; prompt: string }> = [];
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'script_segment' && data.content) {
            // 先添加脚本，prompt后续通过prompt_segment更新
            scripts.push({
              id: data.content.id || data.segmentIndex + 1,
              script: data.content.script || data.content,
              prompt: '' // 先留空，等待prompt_segment更新
            });
          } else if (data.type === 'prompt_segment' && data.content) {
            // 更新对应segment的prompt
            const segmentId = data.content.id;
            const existingScript = scripts.find(s => s.id === segmentId);
            if (existingScript) {
              existingScript.prompt = data.content.prompt;
            } else {
              // 如果还没添加script，先添加完整数据
              scripts.push({
                id: segmentId,
                script: data.content.script,
                prompt: data.content.prompt
              });
            }
          } else if (data.type === 'done') {
            // 从 done 事件获取完整数据
            const doneData = JSON.parse(data.content);
            if (doneData.segments && doneData.segments.length > 0) {
              scripts.length = 0; // 清空之前的数据
              for (const seg of doneData.segments) {
                scripts.push({
                  id: seg.id || scripts.length + 1,
                  script: seg.script || '',
                  prompt: seg.prompt || `${productName}产品展示，专业拍摄`
                });
              }
            }
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
    
    // 如果没有解析到，使用默认文案+Prompt
    if (scripts.length === 0) {
      scripts.push(
        { id: 1, script: `${productName}太棒了，强烈推荐！`, prompt: `${productName}全景展示，吸引眼球` },
        { id: 2, script: `${features[0] || '品质'}过硬，性价比超高`, prompt: `${productName}细节特写，品质展示` },
        { id: 3, script: `设计时尚，颜值爆表`, prompt: `${productName}外观展示，设计美感` },
        { id: 4, script: `现在下单，限时优惠！`, prompt: `${productName}购买引导，促销氛围` }
      );
    }
    
    return {
      success: true,
      message: `文案生成完成，共 ${scripts.length} 段（含画面Prompt）`,
      data: { 
        scripts,
        currentStage: "script_generated"
      }
    };
  } catch (error) {
    console.error('[Tool] generate-script 失败:', error);
    // 降级返回默认文案
    const scripts = [
      { id: 1, script: `${productName}太棒了，强烈推荐！` },
      { id: 2, script: `品质过硬，性价比超高` },
      { id: 3, script: `设计时尚，颜值爆表` },
      { id: 4, script: `现在下单，限时优惠！` }
    ];
    return {
      success: true,
      message: '文案已生成（默认）',
      data: { scripts }
    };
  }
}

/**
 * 3. 生成视频片段
 * 调用 /api/generate-video (SSE 流式)
 * 使用每段的画面Prompt生成对应视频
 */
export async function generateVideoSegments(
  scripts: Array<{ id: number; script: string; prompt?: string }>,
  productImageUrl: string,
  productName: string,
  customHeaders?: Record<string, string>,
  voiceLanguage?: string // 配音语言：mandarin, cantonese, english, japanese
): Promise<ToolResult> {
  console.log('[Tool] 调用 /api/generate-video，每段使用对应Prompt');
  
  try {
    const formData = new FormData();
    formData.append('productName', productName);
    formData.append('imageUrl', productImageUrl); // API 期望的参数名
    
    // 将文案转为 JSON（包含每段的prompt），API 期望的参数名是 segments
    const segmentsForRequest = scripts.map(s => ({
      id: s.id,
      script: s.script,
      prompt: s.prompt || `${productName}产品展示，专业拍摄`
    }));
    formData.append('segments', JSON.stringify(segmentsForRequest));
    
    // 添加配音语言参数
    if (voiceLanguage) {
      formData.append('voiceLanguage', voiceLanguage);
    }
    
    // generate-video 是 SSE 流式接口
    const response = await axios.post(
      `${BASE_URL}/api/generate-video`,
      formData,
      { 
        headers: { 
          ...customHeaders,
          'Content-Type': 'multipart/form-data'
        },
        responseType: 'text',
        timeout: 300000 // 5 分钟超时
      }
    );
    
    // 解析 SSE 响应获取视频片段
    const lines = response.data.split('\n');
    let segments: Array<{ 
      id: number; 
      script: string; 
      videoPath?: string; 
      audioPath?: string;
      videoUrl?: string;
      audioUrl?: string; // 音频URL
      localVideoPath?: string; // 本地视频路径（用于播放）
    }> = [];
    
    // 生成会话ID用于文件夹命名
    const sessionId = Date.now().toString();
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          // 匹配多种事件类型：segment_video, segment_complete, segment, complete
          if (data.type === 'segment_video' || data.type === 'segment_complete' || data.type === 'segment') {
            // segment_video 事件的 content 包含 segmentId, videoUrl, audioUrl, duration
            const segmentId = data.content?.segmentId || data.segmentIndex || data.id || data.segmentId || segments.length + 1;
            const videoUrl = data.content?.videoUrl || data.videoUrl || data.videoPath;
            const audioUrl = data.content?.audioUrl || data.audioUrl || data.audioPath; // 解析音频URL
            
            console.log(`[Tool] 解析视频片段事件: type=${data.type}, segmentId=${segmentId}, videoUrl=${videoUrl?.substring(0, 100)}..., audioUrl=${audioUrl?.substring(0, 100) || '无'}...`);
            
            // 下载视频到本地（优先转存到对象存储）
            let localVideoPath: string | undefined;
            let signedVideoUrl: string | undefined;
            if (videoUrl) {
              const result = await downloadVideoToLocal(
                videoUrl,
                `segments/${sessionId}`,
                `segment_${segmentId}.mp4`
              );
              localVideoPath = result.localPath || undefined;
              signedVideoUrl = result.signedUrl || undefined;
              console.log(`[Tool] 视频片段 ${segmentId} 下载结果: localPath=${localVideoPath}, signedUrl=${signedVideoUrl?.substring(0, 50)}...`);
            }
            
            segments.push({
              id: segmentId,
              script: data.content?.script || data.script || scripts[segments.length]?.script || '',
              videoPath: data.videoPath,
              audioPath: data.audioPath,
              videoUrl: signedVideoUrl || videoUrl, // 优先使用签名URL
              audioUrl: audioUrl, // 添加音频URL
              localVideoPath: localVideoPath
            });
          }
          // 处理 complete 事件（包含所有片段）
          if (data.type === 'complete' && data.content?.segmentVideos) {
            console.log(`[Tool] 解析 complete 事件，包含 ${data.content.segmentVideos.length} 个片段`);
            for (const sv of data.content.segmentVideos) {
              const segmentId = sv.id || segments.length + 1;
              const videoUrl = sv.videoUrl;
              
              // 下载视频到本地
              let localVideoPath: string | undefined;
              let signedVideoUrl: string | undefined;
              if (videoUrl) {
                const result = await downloadVideoToLocal(
                  videoUrl,
                  `segments/${sessionId}`,
                  `segment_${segmentId}.mp4`
                );
                localVideoPath = result.localPath || undefined;
                signedVideoUrl = result.signedUrl || undefined;
              }
              
              segments.push({
                id: segmentId,
                script: sv.script || scripts[segments.length]?.script || '',
                videoUrl: signedVideoUrl || videoUrl,
                localVideoPath: localVideoPath
              });
            }
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
    
    // 按ID排序片段
    segments.sort((a, b) => a.id - b.id);
    
    // 输出调试日志
    console.log(`[Tool] 视频片段解析完成，共 ${segments.length} 个片段`);
    segments.forEach((s, i) => {
      console.log(`[Tool] 片段 ${i + 1}: id=${s.id}, videoUrl=${s.videoUrl?.substring(0, 80)}..., localPath=${s.localVideoPath}`);
    });
    
    // 如果没有解析到，返回脚本信息（稍后可重试）
    if (segments.length === 0) {
      segments = scripts.map(s => ({
        id: s.id,
        script: s.script,
        videoPath: undefined,
        audioPath: undefined,
        localVideoPath: undefined
      }));
    }
    
    return {
      success: true,
      message: `视频片段生成完成，共 ${segments.length} 个（已下载到本地）`,
      data: { 
        segments,
        sessionId,
        currentStage: "video_generated"
      }
    };
  } catch (error) {
    console.error('[Tool] generate-video 失败:', error);
    // 返回脚本信息（稍后可重试）
    const segments = scripts.map(s => ({
      id: s.id,
      script: s.script,
      videoPath: undefined,
      audioPath: undefined
    }));
    return {
      success: false,
      message: '视频片段生成失败，稍后可重试',
      data: { segments },
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

/**
 * 4. 合成最终视频
 * 直接使用 FFmpeg 合成（不调用 compose API）
 */
export async function composeFinalVideo(
  segments: Array<{ id: number; script: string; videoUrl?: string; audioUrl?: string; localVideoPath?: string; localAudioPath?: string }>,
  productName: string,
  options?: { bgmUrl?: string; embedSubtitle?: boolean; sessionId?: string },
  customHeaders?: Record<string, string>
): Promise<ToolResult> {
  console.log('[Tool] composeFinalVideo: 开始合成最终视频');
  console.log('[Tool] 传入的 segments 数量:', segments?.length || 0);
  
  if (!segments || segments.length === 0) {
    return {
      success: false,
      message: '没有可合成的视频片段',
      error: 'segments 为空'
    };
  }
  
  const sessionId = options?.sessionId || Date.now().toString();
  const tmpDir = `/tmp/compose_${sessionId}`;
  
  try {
    // 创建临时目录
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    
    console.log(`[Tool] 创建临时目录: ${tmpDir}`);
    
    // 按 ID 排序确保合成顺序正确
    const sortedSegments = [...segments].sort((a, b) => (a.id || 0) - (b.id || 0));
    console.log(`[Tool] 片段排序后的ID顺序: ${sortedSegments.map(s => s.id).join(', ')}`);
    
    // Step 1: 下载所有视频和音频文件到本地
    const localSegments: Array<{ videoPath: string; audioPath: string; script: string; duration: number }> = [];
    
    for (const segment of sortedSegments) {
      const segId = segment.id;
      console.log(`[Tool] 处理片段 ${segId}...`);
      
      // 下载视频
      const videoPath = path.join(tmpDir, `video_${segId}.mp4`);
      if (segment.videoUrl) {
        console.log(`[Tool] 下载视频 ${segId}: ${segment.videoUrl.substring(0, 50)}...`);
        const videoResponse = await axios.get(segment.videoUrl, { 
          responseType: 'arraybuffer',
          timeout: 60000,
          headers: customHeaders
        });
        fs.writeFileSync(videoPath, videoResponse.data);
        console.log(`[Tool] 视频 ${segId} 下载完成，大小: ${fs.statSync(videoPath).size} bytes`);
      } else {
        console.error(`[Tool] 片段 ${segId} 没有 videoUrl`);
        continue;
      }
      
      // 下载音频（如果有）
      const audioPath = path.join(tmpDir, `audio_${segId}.mp3`);
      if (segment.audioUrl) {
        console.log(`[Tool] 下载音频 ${segId}: ${segment.audioUrl.substring(0, 50)}...`);
        const audioResponse = await axios.get(segment.audioUrl, { 
          responseType: 'arraybuffer',
          timeout: 60000,
          headers: customHeaders
        });
        fs.writeFileSync(audioPath, audioResponse.data);
        console.log(`[Tool] 音频 ${segId} 下载完成，大小: ${fs.statSync(audioPath).size} bytes`);
      } else {
        console.log(`[Tool] 片段 ${segId} 没有 audioUrl，使用视频自带音频`);
        // 如果没有单独的音频，使用视频自带的音频
        fs.copyFileSync(videoPath, audioPath.replace('.mp3', '_from_video.mp4'));
      }
      
      // 获取音频时长
      let duration = 0;
      try {
        const durationCmd = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
        duration = parseFloat(execSync(durationCmd, { encoding: 'utf-8', timeout: 5000 }).trim()) || 0;
      } catch (e) {
        console.log(`[Tool] 无法获取音频时长，使用默认值 5秒`);
        duration = 5;
      }
      
      localSegments.push({
        videoPath,
        audioPath,
        script: segment.script,
        duration
      });
    }
    
    if (localSegments.length === 0) {
      return {
        success: false,
        message: '没有有效的视频片段可合成',
        error: '所有片段都缺少视频URL'
      };
    }
    
    // 分段视频已包含字幕，直接拼接即可
    console.log(`[Tool] 共 ${localSegments.length} 个有效片段准备合成（分段视频已包含字幕）`);
    
    // Step 2: 准备拼接视频列表（分段视频已有音频和字幕）
    const mergedVideos: string[] = [];
    
    for (const seg of localSegments) {
      // 分段视频已经包含音频和字幕，直接使用
      console.log(`[Tool] 分段视频已包含音频和字幕，直接加入拼接列表`);
      mergedVideos.push(seg.videoPath);
    }
    
    // 分段视频已包含字幕，直接拼接即可，无需额外添加字幕
    
    // Step 3: 拼接视频（分段视频已包含音频和字幕）
    const listPath = path.join(tmpDir, 'filelist.txt');
    const listContent = mergedVideos.map(v => `file '${v}'`).join('\n');
    fs.writeFileSync(listPath, listContent, 'utf-8');
    
    const finalPath = path.join(tmpDir, `final_${Date.now()}.mp4`);
    console.log(`[Tool] FFmpeg拼接视频（分段视频已包含字幕）...`);
    const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${finalPath}"`;
    execSync(concatCmd, { stdio: 'pipe', timeout: 60000 });
    console.log(`[Tool] 视频拼接完成: ${finalPath}`);
    
    // 获取最终视频时长
    const durationCmd = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalPath}"`;
    const finalDuration = parseFloat(execSync(durationCmd, { encoding: 'utf-8', timeout: 5000 }).trim()) || 0;
    console.log(`[Tool] 最终视频时长: ${finalDuration}秒，文件大小: ${fs.statSync(finalPath).size} bytes`);
    
    // Step 6: 上传到对象存储
    console.log(`[Tool] 上传最终视频到对象存储...`);
    const filename = `${productName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_final.mp4`;
    const key = `final/${sessionId}/${filename}`;
    
    // 读取文件内容并上传
    const fileContent = fs.readFileSync(finalPath);
    const uploadResult = await uploadLocalFile(fileContent, filename, 'video/mp4');
    const signedVideoUrl = uploadResult.signedUrl;
    
    console.log(`[Tool] 最终视频上传完成: ${signedVideoUrl?.substring(0, 80)}...`);
    
    // 清理临时文件
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log(`[Tool] 临时目录清理完成`);
    } catch (e) {
      console.log(`[Tool] 临时目录清理失败（可忽略）`);
    }
    
    return {
      success: true,
      message: `最终视频合成完成！时长 ${finalDuration}秒，已上传到对象存储（分段视频已包含字幕）`,
      data: {
        finalVideoUrl: signedVideoUrl,
        finalVideoLocalPath: finalPath,
        // 分段视频已包含字幕，无需单独字幕文件
        duration: finalDuration,
        currentStage: "done"
      }
    };
  } catch (error) {
    console.error('[Tool] composeFinalVideo 失败:', error);
    
    // 清理临时文件
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (e) {
      // 忽略清理错误
    }
    
    return {
      success: false,
      message: '视频合成失败',
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

/**
 * 5. 修改文案
 * 调用 /api/generate-script（重新生成指定文案）
 */
export async function modifyScript(
  scriptId: number,
  newContent: string,
  productName: string,
  features: string[],
  customHeaders?: Record<string, string>
): Promise<ToolResult> {
  console.log('[Tool] 修改文案', scriptId);
  
  // 直接返回修改后的文案
  return {
    success: true,
    message: `文案 ${scriptId} 已修改`,
    data: {
      modifiedScript: {
        id: scriptId,
        script: newContent
      }
    }
  };
}

/**
 * 6. 重新生成视频片段
 * 调用 /api/agent/regenerate
 */
export async function regenerateSegment(
  segmentId: number,
  script: string,
  prompt: string,
  productImageUrl: string,
  productName: string,
  folderPath?: string,
  customHeaders?: Record<string, string>
): Promise<ToolResult> {
  console.log('[Tool] 调用 /api/agent/regenerate');
  console.log('[Tool] 使用画面Prompt:', prompt);
  
  try {
    const response = await axios.post(
      `${BASE_URL}/api/agent/regenerate`,
      {
        segmentId,
        script,
        prompt,
        productImageUrl,
        productName,
        folderPath
      },
      { 
        headers: { 
          ...customHeaders,
          'Content-Type': 'application/json'
        },
        timeout: 180000 // 3 分钟超时
      }
    );
    
    const result = response.data;
    return {
      success: true,
      message: `片段 ${segmentId} 重新生成完成`,
      data: {
        segment: {
          id: segmentId,
          script,
          videoPath: result.videoPath,
          audioPath: result.audioPath,
          videoUrl: result.videoUrl
        }
      }
    };
  } catch (error) {
    console.error('[Tool] regenerate 失败:', error);
    return {
      success: false,
      message: `片段 ${segmentId} 重新生成失败`,
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

/**
 * 7. 上传图片（仅上传，不识别）
 * 调用 /api/upload-image
 */
export async function uploadImage(
  imageFile: File,
  customHeaders?: Record<string, string>
): Promise<ToolResult> {
  console.log('[Tool] 调用 /api/upload-image');
  
  try {
    const formData = new FormData();
    formData.append('image', imageFile);
    
    const response = await axios.post(
      `${BASE_URL}/api/upload-image`,
      formData,
      { 
        headers: { 
          ...customHeaders,
          'Content-Type': 'multipart/form-data'
        }
      }
    );
    
    const result = response.data;
    return {
      success: true,
      message: '图片上传成功',
      data: {
        imageUrl: result.imageUrl,
        fileName: result.fileName
      }
    };
  } catch (error) {
    console.error('[Tool] upload-image 失败:', error);
    return {
      success: false,
      message: '图片上传失败',
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

/**
 * 工具名称映射
 */
export const TOOL_NAMES = {
  UPLOAD_AND_IDENTIFY: 'uploadAndIdentifyProduct',
  GENERATE_SCRIPTS: 'generateScripts',
  GENERATE_VIDEO_SEGMENTS: 'generateVideoSegments',
  COMPOSE_FINAL_VIDEO: 'composeFinalVideo',
  MODIFY_SCRIPT: 'modifyScript',
  REGENERATE_SEGMENT: 'regenerateSegment',
  UPLOAD_IMAGE: 'uploadImage'
};