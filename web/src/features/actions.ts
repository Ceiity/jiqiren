import type { NavigateFunction } from 'react-router-dom';
import { browserDownload, del, patch, post } from '../lib/api';
import { invalidateFs } from '../lib/queryClient';
import type { FsItem } from '../lib/types';
import { browsingFolder } from '../lib/uploadTarget';
import { confirmDialog, promptDialog } from '../ui/dialogs';
import { toast, toastError } from '../ui/Toast';

export const nameRule = (v: string) => (/[\\/]/.test(v) ? '名称不能包含 / 或 \\' : v === '.' || v === '..' ? '名称无效' : v.length > 255 ? '名称过长' : null);

export async function createFolderIn(parentId: string | null): Promise<FsItem | null> {
  const name = await promptDialog({ title: '新建文件夹', placeholder: '文件夹名称', initial: '新建文件夹', confirmText: '创建', validate: (v) => (v ? nameRule(v) : '请输入名称') });
  if (!name) return null;
  try {
    const f = await post<FsItem>('/api/fs/folders', { parentId, name });
    invalidateFs();
    toast.success(`已创建「${f.name}」`);
    return f;
  } catch (e) {
    toastError(e);
    return null;
  }
}

export async function newFolderHere(nav: NavigateFunction, pathname: string) {
  const inFiles = pathname.startsWith('/files');
  const f = await createFolderIn(inFiles ? browsingFolder() : null);
  if (f && !inFiles) nav('/files');
}

export async function renameItem(item: FsItem) {
  const name = await promptDialog({ title: item.kind === 'folder' ? '重命名文件夹' : '重命名文件', initial: item.name, confirmText: '保存', selectStem: item.kind === 'file', validate: (v) => (v ? nameRule(v) : '请输入名称') });
  if (!name || name === item.name) return;
  try {
    await patch(`/api/fs/${item.kind === 'folder' ? 'folders' : 'files'}/${item.id}`, { name });
    invalidateFs();
    toast.success('已重命名');
  } catch (e) {
    toastError(e);
  }
}

export const selectionBody = (items: FsItem[]) => ({
  fileIds: items.filter((i) => i.kind === 'file').map((i) => i.id),
  folderIds: items.filter((i) => i.kind === 'folder').map((i) => i.id),
});

export async function trashItems(items: FsItem[], onUndo?: () => void) {
  if (!items.length) return false;
  const ok = await confirmDialog({
    title: items.length === 1 ? `删除「${items[0].name}」？` : `删除 ${items.length} 个项目？`,
    message: '项目将移入回收站，可在回收站中恢复。',
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return false;
  try {
    const body = selectionBody(items);
    await post('/api/fs/trash', body);
    invalidateFs();
    toast(`已移入回收站`, 'success', {
      action: {
        label: '撤销',
        onClick: async () => {
          await post('/api/trash/restore', body).catch(toastError);
          invalidateFs();
          onUndo?.();
        },
      },
    });
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function moveOrCopy(items: FsItem[], targetFolderId: string | null, mode: 'move' | 'copy') {
  try {
    const r = await post<{ moved?: number; copied?: number }>(`/api/fs/${mode}`, { ...selectionBody(items), targetFolderId });
    invalidateFs();
    toast.success(mode === 'move' ? `已移动 ${r.moved ?? 0} 项` : `已复制 ${items.length} 项`);
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function downloadItems(items: FsItem[], zipMultiple = true) {
  if (!items.length) return;
  if (items.length === 1 && items[0].kind === 'file') {
    browserDownload(`/api/fs/files/${items[0].id}/content?download=1`);
    return;
  }
  if (!zipMultiple && items.every((i) => i.kind === 'file')) {
    items.forEach((it, n) => setTimeout(() => browserDownload(`/api/fs/files/${it.id}/content?download=1`), n * 450));
    toast(`正在下载 ${items.length} 个文件`);
    return;
  }
  try {
    const r = await post<{ url: string }>('/api/download/zip', selectionBody(items));
    browserDownload(r.url);
    toast('正在打包下载…');
  } catch (e) {
    toastError(e);
  }
}

export async function deleteShare(id: number) {
  await del(`/api/shares/${id}`);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

let shareBase = '';
export const setShareBase = (base: string) => {
  shareBase = base.replace(/\/+$/, '');
};
export const shareUrl = (token: string) => `${shareBase || window.location.origin}/s/${token}`;
