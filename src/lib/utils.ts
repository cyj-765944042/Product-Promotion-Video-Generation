import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 将本地文件路径转换为可访问的 URL
 * 开发环境：/workspace/projects/public/xxx -> /xxx
 * 生产环境：/tmp/xxx -> /api/file?path=/tmp/xxx
 */
export function getAccessibleUrl(localPath: string): string {
  if (!localPath) return '';
  
  // 如果已经是 http(s) URL，直接返回
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
