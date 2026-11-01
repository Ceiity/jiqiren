import { FolderPlus, Upload } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileBrowser } from '../features/browser/FileBrowser';
import { createFolderIn } from '../features/actions';
import { Page } from '../layout/Page';
import { get } from '../lib/api';
import { pickUpload } from '../lib/uploadTarget';
import type { Category } from '../lib/types';
import { useIsMobile } from '../lib/hooks';

export function FilesPage() {
  const { folderId } = useParams();
  const mobile = useIsMobile();
  const folder = useQuery({ queryKey: ['fs', 'folder', folderId], queryFn: () => get<{ name: string }>(`/api/fs/folders/${folderId}`), enabled: !!folderId });
  return (
    <Page
      title={folderId ? folder.data?.name ?? '…' : '我的文件'}
      actions={
        !mobile && (
          <>
            <button className="btn btn-tonal" onClick={() => createFolderIn(folderId ?? null)}>
              <FolderPlus /> 新建文件夹
            </button>
            <button className="btn btn-filled" onClick={() => pickUpload('files', folderId ?? null)}>
              <Upload /> 上传
            </button>
          </>
        )
      }
    >
      <FileBrowser key={folderId ?? 'root'} folderId={folderId ?? null} />
    </Page>
  );
}

const TITLES: Record<string, string> = { image: '图片', video: '视频', audio: '音频', document: '文档' };

export function CategoryPage({ category }: { category: Category }) {
  return (
    <Page title={TITLES[category]}>
      <FileBrowser key={category} category={category} />
    </Page>
  );
}
