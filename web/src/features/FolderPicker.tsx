import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder, FolderPlus, HardDrive } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, qs } from '../lib/api';
import type { Crumb } from '../lib/types';
import { Dialog } from '../ui/Dialog';
import { Empty } from '../ui/Empty';
import { createFolderIn } from './actions';

interface Props {
  open: boolean;
  title: string;
  confirmText?: string;
  disabledIds?: string[];
  initialFolderId?: string | null;
  onClose: () => void;
  onPick: (folderId: string | null) => void;
}

export function FolderPicker({ open, title, confirmText = '选择', disabledIds = [], initialFolderId = null, onClose, onPick }: Props) {
  const [path, setPath] = useState<Crumb[]>([]);
  const current = path[path.length - 1]?.id ?? null;

  useEffect(() => {
    if (!open) return;
    if (!initialFolderId) return setPath([]);
    get<{ breadcrumbs: Crumb[] }>(`/api/fs/folders/${initialFolderId}`)
      .then((f) => setPath(f.breadcrumbs))
      .catch(() => setPath([]));
  }, [open, initialFolderId]);

  const sub = useQuery({
    queryKey: ['fs', 'tree', current],
    queryFn: () => get<{ id: string; name: string; hasChildren: boolean }[]>(`/api/fs/tree${qs({ parentId: current })}`),
    enabled: open,
  });

  const blocked = disabledIds.some((id) => path.some((p) => p.id === id));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={480}
      actions={
        <>
          <button
            className="btn btn-text"
            style={{ marginRight: 'auto' }}
            onClick={async () => {
              const f = await createFolderIn(current);
              if (f) setPath((p) => [...p, { id: f.id, name: f.name }]);
            }}
          >
            <FolderPlus /> 新建文件夹
          </button>
          <button className="btn btn-tonal" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-filled" disabled={blocked} onClick={() => onPick(current)}>
            {confirmText}
          </button>
        </>
      }
    >
      <nav className="crumbs" style={{ margin: 0 }}>
        <button className={`crumb${!path.length ? ' current' : ''}`} onClick={() => setPath([])}>
          <HardDrive />
          <span>我的文件</span>
        </button>
        {path.map((c, i) => (
          <span key={c.id} className="row" style={{ gap: 2, flex: 'none' }}>
            <ChevronRight className="crumb-sep" />
            <button className={`crumb${i === path.length - 1 ? ' current' : ''}`} onClick={() => setPath(path.slice(0, i + 1))}>
              <span>{c.name}</span>
            </button>
          </span>
        ))}
      </nav>
      <div className="picker-list">
        {sub.isLoading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 44, margin: '4px 0' }} />)}
        {sub.data?.length === 0 && <Empty compact icon={Folder} title="没有子文件夹" subtitle="可以选择当前位置，或新建文件夹" />}
        {sub.data?.map((f) => (
          <button key={f.id} className={`picker-item${disabledIds.includes(f.id) ? ' disabled' : ''}`} onClick={() => setPath((p) => [...p, { id: f.id, name: f.name }])}>
            <span className="ficon">
              <Folder />
            </span>
            <span className="grow ellipsis">{f.name}</span>
            {f.hasChildren && <ChevronRight size={18} className="c-variant" />}
          </button>
        ))}
      </div>
      {blocked && <div className="field-error">不能移动到所选文件夹自身或其子文件夹中</div>}
    </Dialog>
  );
}
