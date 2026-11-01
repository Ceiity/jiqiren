import { useInfiniteQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw, Trash2, X, MoreHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { get, post, qs } from '../lib/api';
import { formatBytes, formatRelative } from '../lib/format';
import { iconFor } from '../lib/fileIcons';
import { invalidateFs } from '../lib/queryClient';
import { useSession } from '../lib/session';
import type { FsItem, ListPage } from '../lib/types';
import { Page } from '../layout/Page';
import { CheckCircle } from '../ui/controls';
import { confirmDialog } from '../ui/dialogs';
import { Empty } from '../ui/Empty';
import { Menu, anchorFrom, type MenuAnchor, type MenuEntry } from '../ui/Menu';
import { toast, toastError } from '../ui/Toast';
import { selectionBody } from '../features/actions';
import { useIsMobile } from '../lib/hooks';

export function TrashPage() {
  const { config } = useSession();
  const mobile = useIsMobile();
  const list = useInfiniteQuery({
    queryKey: ['trash'],
    queryFn: ({ pageParam }) => get<ListPage>(`/api/trash${qs({ offset: pageParam, limit: 200 })}`),
    initialPageParam: 0,
    getNextPageParam: (l) => l.nextOffset ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuEntry[] } | null>(null);
  const k = (i: FsItem) => `${i.kind}:${i.id}`;
  const chosen = items.filter((i) => sel.has(k(i)));

  const restore = async (list: FsItem[]) => {
    try {
      await post('/api/trash/restore', selectionBody(list));
      setSel(new Set());
      invalidateFs();
      toast.success(`已恢复 ${list.length} 项`);
    } catch (e) {
      toastError(e);
    }
  };
  const purge = async (list: FsItem[]) => {
    if (!(await confirmDialog({ title: `彻底删除 ${list.length} 项？`, message: '彻底删除后无法恢复。', confirmText: '彻底删除', danger: true }))) return;
    try {
      await post('/api/trash/delete', selectionBody(list));
      setSel(new Set());
      invalidateFs();
      toast.success('已彻底删除');
    } catch (e) {
      toastError(e);
    }
  };
  const empty = async () => {
    if (!(await confirmDialog({ title: '清空回收站？', message: '回收站中的所有项目将被永久删除，无法恢复。', confirmText: '清空', danger: true }))) return;
    try {
      await post('/api/trash/empty');
      invalidateFs();
      toast.success('回收站已清空');
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Page
      title="回收站"
      subtitle={config ? `删除的项目将保留一段时间后自动清除` : undefined}
      actions={
        items.length > 0 && (
          <button className="btn btn-tonal" onClick={empty} style={{ ['--btn-fg' as string]: 'var(--destructive)' }}>
            <Trash2 /> {mobile ? '清空' : '清空回收站'}
          </button>
        )
      }
    >
      <AnimatePresence>
        {sel.size > 0 && (
          <motion.div className="fb-selbar" style={{ marginBottom: 12 }} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            <button className="icon-btn" onClick={() => setSel(new Set())} aria-label="取消选择">
              <X />
            </button>
            <span className="count">已选 {sel.size} 项</span>
            <span className="spacer" />
            <button className="btn btn-sm btn-text" onClick={() => restore(chosen)}>
              <RotateCcw /> 恢复
            </button>
            <button className="btn btn-sm btn-danger-text" onClick={() => purge(chosen)}>
              <Trash2 /> 彻底删除
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {list.isLoading && Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 54, margin: '6px 0' }} />)}
      {!list.isLoading && items.length === 0 && <Empty icon={Trash2} title="回收站是空的" subtitle="删除的文件会在这里保留，可随时恢复" />}
      <div className="col" style={{ gap: 2 }}>
        <AnimatePresence initial={false}>
          {items.map((i, n) => {
            const Icon = iconFor(i);
            const s = sel.has(k(i));
            return (
              <motion.div
                key={k(i)}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
                className={`flist-row${n % 2 ? ' odd' : ''}${s ? ' selected' : ''}`}
                style={{ height: 56, gridTemplateColumns: mobile ? '30px minmax(0,1fr) 40px' : '34px minmax(0,1fr) 110px 140px 40px' }}
                onClick={() =>
                  setSel((p) => {
                    const x = new Set(p);
                    x.has(k(i)) ? x.delete(k(i)) : x.add(k(i));
                    return x;
                  })
                }
              >
                <span className="flist-check" style={{ opacity: 1 }}>
                  <CheckCircle on={s} />
                </span>
                <span className="flist-name">
                  <span className={`ficon${i.kind === 'folder' ? ' folder' : ''}`}>
                    <Icon />
                  </span>
                  <span className="col" style={{ minWidth: 0 }}>
                    <span className="ellipsis w-500">{i.name}</span>
                    <span className="t-caption c-variant">删除于 {formatRelative(i.deletedAt ?? i.updatedAt)}</span>
                  </span>
                </span>
                {!mobile && <span className="cell num">{formatBytes(i.size)}</span>}
                {!mobile && <span className="cell">{i.kind === 'folder' ? '文件夹' : i.ext?.toUpperCase() || '文件'}</span>}
                <button
                  className="icon-btn sm"
                  aria-label="更多"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu({
                      anchor: anchorFrom(e.currentTarget, 'end'),
                      items: [
                        { label: '恢复', icon: RotateCcw, onSelect: () => restore([i]) },
                        { label: '彻底删除', icon: Trash2, danger: true, onSelect: () => purge([i]) },
                      ],
                    });
                  }}
                >
                  <MoreHorizontal />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {list.hasNextPage && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-tonal" onClick={() => list.fetchNextPage()}>
            加载更多
          </button>
        </div>
      )}
      <Menu anchor={menu?.anchor ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </Page>
  );
}
