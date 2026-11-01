import { useQuery } from '@tanstack/react-query';
import { Calendar, FileDigit, Folder, HardDrive, Link2, MapPin, Tag, Files } from 'lucide-react';
import { get } from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/format';
import { iconFor, typeLabel } from '../lib/fileIcons';
import type { Crumb, FsItem } from '../lib/types';
import { SetRow } from '../ui/controls';
import { Dialog } from '../ui/Dialog';

interface FileDetail extends FsItem {
  hash?: string;
  breadcrumbs: Crumb[];
  shareCount?: number;
  files?: number;
  folders?: number;
  bytes?: number;
}

export function DetailsDialog({ item, onClose }: { item: FsItem | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['fs', 'detail', item?.kind, item?.id],
    queryFn: () => get<FileDetail>(`/api/fs/${item!.kind === 'folder' ? 'folders' : 'files'}/${item!.id}`),
    enabled: !!item,
  });
  const d = q.data;
  const Icon = item ? iconFor(item) : Folder;
  const path = d ? '/' + [...d.breadcrumbs.map((c) => c.name)].slice(0, item?.kind === 'folder' ? -1 : undefined).join('/') : '…';
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      width={460}
      icon={
        <span className="glyph-well" style={{ background: 'var(--float-block)', color: item?.kind === 'folder' ? 'var(--primary)' : undefined }}>
          <Icon />
        </span>
      }
      title="详细信息"
      subtitle={<span className="ellipsis" style={{ display: 'block' }}>{item?.name}</span>}
    >
      <div className="group" style={{ marginBottom: 8 }}>
        <SetRow icon={Tag} title="类型" value={item ? typeLabel(item) : ''} />
        <SetRow icon={HardDrive} title="大小" value={<span className="num">{item?.kind === 'folder' ? (d ? formatBytes(d.bytes ?? 0) : '…') : formatBytes(item?.size ?? 0)}</span>} />
        {item?.kind === 'folder' && <SetRow icon={Files} title="包含" value={d ? `${d.files} 个文件，${d.folders} 个文件夹` : '…'} />}
        <SetRow icon={MapPin} title="位置" value={<span className="ellipsis" style={{ display: 'block', maxWidth: 220 }} title={path}>{path}</span>} />
        <SetRow icon={Calendar} title="创建时间" value={item ? formatDateTime(item.createdAt) : ''} />
        <SetRow icon={Calendar} title="修改时间" value={item ? formatDateTime(item.updatedAt) : ''} />
        {item?.kind === 'file' && <SetRow icon={Link2} title="分享次数" value={d?.shareCount ?? '…'} />}
        {item?.kind === 'file' && (
          <SetRow icon={FileDigit} title="SHA-256" sub={<span className="mono" style={{ wordBreak: 'break-all', fontSize: 11 }}>{d?.hash ?? '…'}</span>} />
        )}
      </div>
    </Dialog>
  );
}
