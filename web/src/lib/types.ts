export type Category = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';

export interface User {
  id: number;
  username: string;
  nickname: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  quotaBytes: number;
  usedBytes: number;
  avatarUrl: string | null;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface Preferences {
  themeMode: 'system' | 'light' | 'dark';
  accentColor: string;
  colorStyle: 'vivid' | 'tinted' | 'soft' | 'monochrome';
  motion: 'full' | 'reduced' | 'off';
  density: 'comfortable' | 'compact';
  defaultView: 'grid' | 'list';
  sidebarExpanded: boolean;
  uploadConcurrency: number;
  chunkSizeMB: number;
  uploadRetries: number;
  defaultUploadFolderId: string | null;
  downloadBehavior: 'direct' | 'preview';
  zipMultiple: boolean;
  shareDefaultExpire: 'never' | '1h' | '1d' | '7d' | '30d';
  shareDefaultAllowDownload: boolean;
  shareDefaultPassword: 'none' | 'random';
}

export interface FsItem {
  kind: 'folder' | 'file';
  id: string;
  name: string;
  size: number;
  mime: string | null;
  ext: string | null;
  category: Category | 'folder';
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  hasThumb?: boolean;
}

export interface Crumb {
  id: string;
  name: string;
}

export interface ListPage {
  items: FsItem[];
  total: number;
  nextOffset: number | null;
  folder?: FsItem | null;
  breadcrumbs?: Crumb[];
}

export type ShareState = 'active' | 'disabled' | 'expired' | 'exhausted' | 'missing';

export interface Share {
  id: number;
  token: string;
  url: string;
  targetType: 'file' | 'folder';
  targetId: string;
  name: string;
  category: Category | 'folder';
  size: number | null;
  note: string;
  hasPassword: boolean;
  allowDownload: boolean;
  allowPreview: boolean;
  maxDownloads: number | null;
  maxViews: number | null;
  viewCount: number;
  downloadCount: number;
  expiresAt: number | null;
  status: 'active' | 'disabled';
  state: ShareState;
  createdAt: number;
  updatedAt: number;
  lastAccessAt: number | null;
  ownerName?: string;
}

export interface PublicConfig {
  siteName: string;
  siteIcon: string;
  publicUrl: string;
  allowRegister: boolean;
  needsSetup: boolean;
}

export interface Overview {
  usedBytes: number;
  quotaBytes: number;
  fileCount: number;
  folderCount: number;
  categories: Record<string, { count: number; bytes: number }>;
  trash: { count: number; bytes: number };
  recent: FsItem[];
  shares: { total: number; active: number; views: number; downloads: number };
  daily: { day: string; c: number; b: number }[];
  shareDaily: { day: string; views: number; downloads: number }[];
}
