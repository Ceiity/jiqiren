import { Clapperboard, FileText, FolderClosed, HardDrive, Image, LayoutGrid, Link2, Music2, Settings, ShieldCheck, Trash2, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: number;
  admin?: boolean;
  end?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', label: '首页', icon: LayoutGrid, group: 0, end: true },
  { to: '/files', label: '我的文件', icon: FolderClosed, group: 0 },
  { to: '/images', label: '图片', icon: Image, group: 1 },
  { to: '/videos', label: '视频', icon: Clapperboard, group: 1 },
  { to: '/audio', label: '音频', icon: Music2, group: 1 },
  { to: '/documents', label: '文档', icon: FileText, group: 1 },
  { to: '/shares', label: '分享管理', icon: Link2, group: 2 },
  { to: '/trash', label: '回收站', icon: Trash2, group: 2 },
  { to: '/storage', label: '存储空间', icon: HardDrive, group: 2 },
  { to: '/admin', label: '管理后台', icon: ShieldCheck, group: 3, admin: true },
  { to: '/settings', label: '设置', icon: Settings, group: 3 },
];

export const DOCK = ['/', '/files', '/shares', '/settings'];

export function matchNav(pathname: string): NavItem | undefined {
  return [...NAV].sort((a, b) => b.to.length - a.to.length).find((n) => (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + '/')));
}
