import {
  FileArchive,
  FileAudio2,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo2,
  File as FileIcon,
  Folder,
  Presentation,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';
import type { FsItem } from './types';

const CODE = new Set(['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'sh', 'sql', 'html', 'htm', 'css', 'json', 'xml', 'yaml', 'yml', 'toml']);
const SHEET = new Set(['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers']);
const SLIDES = new Set(['ppt', 'pptx', 'odp', 'key']);

export function iconFor(item: Pick<FsItem, 'kind' | 'category' | 'ext'>): LucideIcon {
  if (item.kind === 'folder') return Folder;
  const ext = item.ext ?? '';
  switch (item.category) {
    case 'image':
      return FileImage;
    case 'video':
      return FileVideo2;
    case 'audio':
      return FileAudio2;
    case 'archive':
      return FileArchive;
    case 'document':
      if (ext === 'pdf' || ext === 'epub') return BookOpen;
      if (SHEET.has(ext)) return FileSpreadsheet;
      if (SLIDES.has(ext)) return Presentation;
      if (CODE.has(ext)) return FileCode2;
      return FileText;
    default:
      return FileIcon;
  }
}

export const CATEGORY_LABEL: Record<string, string> = {
  folder: '文件夹',
  image: '图片',
  video: '视频',
  audio: '音频',
  document: '文档',
  archive: '压缩包',
  other: '其他',
};

export function typeLabel(item: Pick<FsItem, 'kind' | 'category' | 'ext'>): string {
  if (item.kind === 'folder') return '文件夹';
  const ext = item.ext ? item.ext.toUpperCase() : '';
  return ext ? `${ext} ${CATEGORY_LABEL[item.category] ?? '文件'}` : CATEGORY_LABEL[item.category] ?? '文件';
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'json', 'log', 'csv', 'tsv', 'yaml', 'yml', 'toml', 'ini', 'xml', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'sh', 'sql', 'css', 'html', 'htm', 'svg', 'conf', 'env']);
const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'flac', 'opus', 'weba']);

export function previewKind(item: Pick<FsItem, 'kind' | 'ext' | 'category'>): PreviewKind {
  if (item.kind !== 'file') return 'none';
  const ext = item.ext ?? '';
  if (IMG_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'none';
}
