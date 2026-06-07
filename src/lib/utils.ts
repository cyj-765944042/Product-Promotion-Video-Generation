import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 将本地文件路径转换为可访问的 URL
 * 开发环境：/workspace/projects/public/xxx -> /xxx
 * 生产环境：/tmp/xxx -> /api/file?path=/tmp/xxx
 * 
 * 对于外部视频URL（火山引擎等），使用代理API绕过浏览器访问限制
 */
export function getAccessibleUrl(localPath: string, useProxy = true): string {
  if (!localPath) return '';
  
  // 如果是火山引擎等外部视频URL，使用代理API
  if (useProxy && isExternalVideoUrl(localPath)) {
    return `/api/video-proxy?url=${encodeURIComponent(localPath)}`;
  }
  
  // 如果已经是 http(s) URL 但不是视频，直接返回
  if (localPath.startsWith('http://') || localPath.startsWith('https://')) {
    return localPath;
  }
  
  // 检查是否是生产环境
  const isProduction = typeof window !== 'undefined' && 
    !window.location.hostname.includes('dev.coze.site');
  
  if (isProduction) {
    // 生产环境：通过 API 代理访问
    return `/api/file?path=${encodeURIComponent(localPath)}`;
  } else {
    // 开发环境：将绝对路径转换为相对路径
    // /workspace/projects/public/xxx -> /xxx
    const publicPrefix = '/workspace/projects/public';
    if (localPath.startsWith(publicPrefix)) {
      return localPath.replace(publicPrefix, '');
    }
    // 如果已经是相对路径，直接返回
    if (localPath.startsWith('/')) {
      return localPath;
    }
    return localPath;
  }
}

/**
 * 判断是否是需要代理的外部视频URL
 * 火山引擎的URL通常包含 tos-cn-beijing.volces.com 或 coze-dianbo
 */
function isExternalVideoUrl(url: string): boolean {
  const videoHosts = [
    'tos-cn-beijing.volces.com',
    'tos-cn-shanghai.volces.com',
    'coze-dianbo.tos',
    'coze-coding-project.tos',
  ];
  
  return videoHosts.some(host => url.includes(host));
}
