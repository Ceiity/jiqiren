import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronRight,
  Copy,
  Download,
  FolderInput,
  FolderPlus,
  FolderUp,
  HardDrive,
  Info,
  LayoutGrid,
  Link2,
  List,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
  CheckSquare,
  Eye,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/format';
import { CATEGORY_LABEL, iconFor, previewKind, typeLabel } from '../../lib/fileIcons';
import { useDebounced, useElementWidth, useEvent, useIsMobile, useIsTouch } from '../../lib/hooks';
import { usePrefs } from '../../lib/session';
import type { Category, Crumb, FsItem, ListPage } from '../../lib/types';
import { pickUpload, setBrowsingFolder } from '../../lib/uploadTarget';
import { usePageScroll } from '../../layout/Page';
import { CheckCircle, Segmented } from '../../ui/controls';
import { Empty } from '../../ui/Empty';
import { Menu, type MenuAnchor, type MenuEntry } from '../../ui/Menu';
import { springSoft } from '../../ui/motion';
import { createFolderIn, downloadItems, moveOrCopy, renameItem, trashItems } from '../actions';
import { FolderPicker } from '../FolderPicker';
import { Preview } from '../Preview';
import { ShareDialog } from '../ShareDialog';
import { DetailsDialog } from '../DetailsDialog';
import { invalidateFs } from '../../lib/queryClient';

type SortKey = 'name' | 'size' | 'updated' | 'type';
const PAGE = 200;
const keyOf = (i: FsItem) => `${i.kind}:${i.id}`;
const DRAG_TYPE = 'application/x-nailong-items';

export interface FileBrowserProps {
  folderId?: string | null;
  category?: Category;
  onCrumbs?: (crumbs: Crumb[], folder: FsItem | null) => void;
}

export const thumbUrl = (id: string, s = 256) => `/api/fs/files/${id}/thumb?s=${s}`;
export const contentUrl = (id: string, download = false) => `/api/fs/files/${id}/content${download ? '?download=1' : ''}`;

export function FileBrowser({ folderId = null, category }: FileBrowserProps) {
  const nav = useNavigate();
  const [prefs, updatePrefs] = usePrefs();
  const mobile = useIsMobile();
  const touch = useIsTouch();
  const scrollRef = usePageScroll();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const [sort, setSort] = useState<{ key: SortKey; order: 'asc' | 'desc' }>(() => (category ? { key: 'updated', order: 'desc' } : { key: 'name', order: 'asc' }));
  const view = prefs.defaultView;
  const flat = !!category || !!q;

  useEffect(() => {
    if (!category) setBrowsingFolder(folderId);
    return () => setBrowsingFolder(null);
  }, [folderId, category]);

  const params = { folderId: flat ? undefined : folderId ?? undefined, category: category ?? undefined, q: q || undefined, sort: sort.key, order: sort.order };
  const list = useInfiniteQuery({
    queryKey: ['fs', 'list', params],
    queryFn: ({ pageParam, signal }) => get<ListPage>(`/api/fs/list${qs({ ...params, offset: pageParam, limit: PAGE })}`, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const crumbs = list.data?.pages[0]?.breadcrumbs ?? [];

  /* ---------- selection ---------- */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const selectedItems = useMemo(() => items.filter((i) => selected.has(keyOf(i))), [items, selected]);
  const selecting = selected.size > 0;
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
  }, [folderId, category, q]);

  const toggle = (i: FsItem, idx: number) => {
    setSelected((s) => {
      const n = new Set(s);
      const k = keyOf(i);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
    anchor.current = idx;
  };
  const selectRange = (idx: number, additive: boolean) => {
    const a = anchor.current ?? idx;
    const [lo, hi] = a < idx ? [a, idx] : [idx, a];
    setSelected((s) => {
      const n = additive ? new Set(s) : new Set<string>();
      for (let k = lo; k <= hi; k++) if (items[k]) n.add(keyOf(items[k]));
      return n;
    });
  };
  const selectOnly = (i: FsItem, idx: number) => {
    setSelected(new Set([keyOf(i)]));
    anchor.current = idx;
  };
  const clearSel = () => setSelected(new Set());

  /* ---------- open / actions ---------- */
  const [preview, setPreview] = useState<{ files: FsItem[]; index: number } | null>(null);
  const [share, setShare] = useState<FsItem | null>(null);
  const [details, setDetails] = useState<FsItem | null>(null);
  const [picker, setPicker] = useState<{ mode: 'move' | 'copy'; items: FsItem[] } | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuEntry[] } | null>(null);

  const open = (item: FsItem) => {
    if (item.kind === 'folder') {
      setQuery('');
      nav(`/files/${item.id}`);
      return;
    }
    if (prefs.downloadBehavior === 'direct' && previewKind(item) === 'none') return downloadItems([item]);
    const files = items.filter((i) => i.kind === 'file');
    setPreview({ files, index: Math.max(0, files.findIndex((f) => f.id === item.id)) });
  };

  const actionsFor = (sel: FsItem[]): MenuEntry[] => {
    const one = sel.length === 1 ? sel[0] : null;
    return [
      { label: '打开', icon: one?.kind === 'folder' ? FolderInput : Eye, onSelect: () => one && open(one), hidden: !one },
      { label: sel.length > 1 || one?.kind === 'folder' ? '打包下载' : '下载', icon: Download, onSelect: () => downloadItems(sel, prefs.zipMultiple) },
      { label: '分享', icon: Link2, onSelect: () => one && setShare(one), hidden: !one },
      { type: 'separator' },
      { label: '重命名', icon: Pencil, onSelect: () => one && renameItem(one), hidden: !one, shortcut: touch ? undefined : 'F2' },
      { label: '移动到…', icon: FolderInput, onSelect: () => setPicker({ mode: 'move', items: sel }) },
      { label: '复制到…', icon: Copy, onSelect: () => setPicker({ mode: 'copy', items: sel }) },
      { label: '详细信息', icon: Info, onSelect: () => one && setDetails(one), hidden: !one },
      { type: 'separator' },
      { label: '删除', icon: Trash2, danger: true, onSelect: () => trashItems(sel, clearSel).then((ok) => ok && clearSel()), shortcut: touch ? undefined : 'Del' },
    ];
  };

  const bgMenu = (): MenuEntry[] => [
    { label: '上传文件', icon: Upload, onSelect: () => pickUpload('files', folderId), hidden: !!category },
    { label: '上传文件夹', icon: FolderUp, onSelect: () => pickUpload('folder', folderId), hidden: !!category },
    { label: '新建文件夹', icon: FolderPlus, onSelect: () => createFolderIn(folderId), hidden: flat },
    { type: 'separator', hidden: !!category },
    { label: '全选', icon: CheckSquare, onSelect: () => setSelected(new Set(items.map(keyOf))) },
    { label: '刷新', icon: RefreshCw, onSelect: () => invalidateFs() },
  ];

  /* ---------- pointer handlers ---------- */
  const longPress = useRef<{ timer: number; fired: boolean } | null>(null);
  const handlers = (item: FsItem, idx: number) => ({
    onClick: (e: React.MouseEvent) => {
      if (longPress.current?.fired) {
        longPress.current = null;
        return;
      }
      if (e.shiftKey) return selectRange(idx, e.metaKey || e.ctrlKey);
      if (e.metaKey || e.ctrlKey) return toggle(item, idx);
      if (touch || mobile) {
        if (selecting) return toggle(item, idx);
        return open(item);
      }
      selectOnly(item, idx);
    },
    onDoubleClick: () => {
      if (!touch) open(item);
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      let sel = selectedItems;
      if (!selected.has(keyOf(item))) {
        selectOnly(item, idx);
        sel = [item];
      }
      setMenu({ anchor: { x: e.clientX, y: e.clientY }, items: actionsFor(sel) });
    },
    onTouchStart: () => {
      const timer = window.setTimeout(() => {
        if (longPress.current) longPress.current.fired = true;
        navigator.vibrate?.(12);
        toggle(item, idx);
      }, 450);
      longPress.current = { timer, fired: false };
    },
    onTouchEnd: () => {
      if (longPress.current) window.clearTimeout(longPress.current.timer);
    },
    onTouchMove: () => {
      if (longPress.current) window.clearTimeout(longPress.current.timer);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') open(item);
      if (e.key === ' ') {
        e.preventDefault();
        toggle(item, idx);
      }
    },
    // drag to move
    draggable: !touch && !flat,
    onDragStart: (e: React.DragEvent) => {
      let sel = selectedItems;
      if (!selected.has(keyOf(item))) {
        selectOnly(item, idx);
        sel = [item];
      }
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(sel.map(keyOf)));
      e.dataTransfer.effectAllowed = 'move';
      const ghost = document.createElement('div');
      ghost.className = 'chip chip-primary';
      ghost.style.cssText = 'position:fixed;top:-100px;left:-100px;height:30px;padding:0 14px;font-size:13px';
      ghost.textContent = sel.length > 1 ? `移动 ${sel.length} 项` : sel[0].name;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 16, 15);
      setTimeout(() => ghost.remove(), 0);
      setDragKeys(new Set(sel.map(keyOf)));
    },
    onDragEnd: () => setDragKeys(new Set()),
  });

  const [dragKeys, setDragKeys] = useState<Set<string>>(new Set());
  const [dropKey, setDropKey] = useState<string | null>(null);
  const dropHandlers = (targetId: string | null, key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (![...e.dataTransfer.types].includes(DRAG_TYPE)) return;
      if (dragKeys.has(key)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropKey(key);
    },
    onDragLeave: () => setDropKey((k) => (k === key ? null : k)),
    onDrop: (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      setDropKey(null);
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      const keys = new Set(JSON.parse(raw) as string[]);
      const moving = items.filter((i) => keys.has(keyOf(i)));
      if (moving.length) void moveOrCopy(moving, targetId, 'move').then(clearSel);
    },
  });

  /* ---------- keyboard ---------- */
  const onKey = useEvent((e: KeyboardEvent) => {
      if (preview) return;
      const t = e.target as HTMLElement;
      if (t.closest?.('input, textarea, [role="dialog"], .menu')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(items.map(keyOf)));
      } else if (e.key === 'Escape') clearSel();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedItems.length) {
        e.preventDefault();
        void trashItems(selectedItems).then((ok) => ok && clearSel());
      } else if (e.key === 'F2' && selectedItems.length === 1) {
        e.preventDefault();
        void renameItem(selectedItems[0]);
      }
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  /* ---------- layout / virtualisation ---------- */
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const gap = prefs.density === 'compact' ? 10 : 12;
  const minCard = mobile ? 148 : prefs.density === 'compact' ? 150 : 172;
  const cols = view === 'grid' ? Math.max(2, Math.floor((width + gap) / (minCard + gap))) : 1;
  const cardW = (width - gap * (cols - 1)) / cols;
  const rowH = view === 'grid' ? Math.round((cardW - 16) * 0.75 + 16 + 18 + 9 + 20 + 2) + gap : prefs.density === 'compact' ? 46 : 54;
  const rows = Math.ceil(items.length / cols);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const sc = scrollRef?.current;
    if (!el || !sc) return;
    setMargin(el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
  });
  const virt = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => rowH,
    overscan: 4,
    scrollMargin: margin,
  });
  useEffect(() => virt.measure(), [rowH, cols, virt]);
  const vItems = virt.getVirtualItems();
  const lastRow = vItems[vItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (lastRow >= rows - 3 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, [lastRow, rows, list]);

  const sortLabel: Record<SortKey, string> = { name: '名称', size: '大小', updated: '修改时间', type: '类型' };
  const setSortKey = (key: SortKey) => setSort((s) => (s.key === key ? { key, order: s.order === 'asc' ? 'desc' : 'asc' } : { key, order: key === 'name' || key === 'type' ? 'asc' : 'desc' }));
  const SortIcon = sort.order === 'asc' ? ArrowUp : ArrowDown;

  /* ---------- toolbar ---------- */
  const sortMenuItems: MenuEntry[] = (['name', 'updated', 'size', 'type'] as SortKey[]).map((k) => ({
    label: sortLabel[k],
    checked: sort.key === k,
    onSelect: () => setSortKey(k),
  }));
  sortMenuItems.push({ type: 'separator' }, { label: '升序', checked: sort.order === 'asc', onSelect: () => setSort((s) => ({ ...s, order: 'asc' })) }, { label: '降序', checked: sort.order === 'desc', onSelect: () => setSort((s) => ({ ...s, order: 'desc' })) });

  const toolbar = (
    <AnimatePresence mode="wait" initial={false}>
      {selecting ? (
        <motion.div key="sel" className="fb-selbar" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.18 }}>
          <button className="icon-btn" onClick={clearSel} aria-label="取消选择">
            <X />
          </button>
          <span className="count num">已选 {selected.size} 项</span>
          <span className="spacer" />
          <div className="actions">
            <button className="icon-btn" title="全选" aria-label="全选" onClick={() => setSelected(new Set(items.map(keyOf)))}>
              <CheckSquare />
            </button>
            <button className="icon-btn" title="下载" aria-label="下载" onClick={() => downloadItems(selectedItems, prefs.zipMultiple)}>
              <Download />
            </button>
            {selectedItems.length === 1 && (
              <button className="icon-btn" title="分享" aria-label="分享" onClick={() => setShare(selectedItems[0])}>
                <Link2 />
              </button>
            )}
            {!mobile && (
              <>
                <button className="icon-btn" title="移动到" aria-label="移动到" onClick={() => setPicker({ mode: 'move', items: selectedItems })}>
                  <FolderInput />
                </button>
                <button className="icon-btn" title="复制到" aria-label="复制到" onClick={() => setPicker({ mode: 'copy', items: selectedItems })}>
                  <Copy />
                </button>
              </>
            )}
            <button className="icon-btn" title="删除" aria-label="删除" onClick={() => trashItems(selectedItems).then((ok) => ok && clearSel())}>
              <Trash2 />
            </button>
            <button className="icon-btn" title="更多" aria-label="更多" onClick={(e) => setMenu({ anchor: anchorOf(e.currentTarget), items: actionsFor(selectedItems) })}>
              <MoreHorizontal />
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div key="bar" className="fb-toolbar" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18 }}>
          {!mobile && !category && !q ? (
            <Breadcrumbs crumbs={crumbs} onGo={(id) => nav(id ? `/files/${id}` : '/files')} dropHandlers={dropHandlers} dropKey={dropKey} />
          ) : !mobile ? (
            <div className="grow t-subhead w-600">{q ? `“${q}” 的搜索结果` : CATEGORY_LABEL[category!]}</div>
          ) : null}
          <label className="search-pill">
            <Search />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={category ? `搜索${CATEGORY_LABEL[category]}` : '搜索全部文件'} aria-label="搜索" />
            {query && (
              <button className="icon-btn sm" onClick={() => setQuery('')} aria-label="清除搜索">
                <X />
              </button>
            )}
          </label>
          <button className="icon-btn" title={`排序：${sortLabel[sort.key]}`} aria-label="排序" onClick={(e) => setMenu({ anchor: anchorOf(e.currentTarget), items: sortMenuItems })}>
            <ArrowUpDown />
          </button>
          {!mobile ? (
            <Segmented
              size="small"
              className="on-page"
              value={view}
              onChange={(v) => updatePrefs({ defaultView: v })}
              options={[
                { value: 'grid', label: '', icon: LayoutGrid, title: '网格视图' },
                { value: 'list', label: '', icon: List, title: '列表视图' },
              ]}
            />
          ) : (
            <button className="icon-btn" aria-label="切换视图" onClick={() => updatePrefs({ defaultView: view === 'grid' ? 'list' : 'grid' })}>
              {view === 'grid' ? <List /> : <LayoutGrid />}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  /* ---------- render ---------- */
  const loading = list.isLoading;
  const empty = !loading && items.length === 0;

  return (
    <div
      className={`fb${selecting ? ' selecting' : ''}`}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.fcard, .flist-row, input')) return;
        e.preventDefault();
        setMenu({ anchor: { x: e.clientX, y: e.clientY }, items: bgMenu() });
      }}
      onClick={(e) => {
        if (!touch && !(e.target as HTMLElement).closest('.fcard, .flist-row, .fb-selbar, .fb-toolbar, button')) clearSel();
      }}
    >
      <div className="page-toolbar-inner" style={{ position: 'sticky', top: 0, zIndex: 4, background: 'var(--page)', padding: '4px 0 10px', margin: '0 -2px', paddingInline: 2 }}>
        {toolbar}
        {mobile && !category && !q && crumbs.length > 0 && !selecting && (
          <div style={{ marginTop: 8 }}>
            <Breadcrumbs crumbs={crumbs} onGo={(id) => nav(id ? `/files/${id}` : '/files')} dropHandlers={dropHandlers} dropKey={dropKey} />
          </div>
        )}
      </div>

      {!loading && !empty && (
        <div className="fb-meta num">
          {total} 项{list.isFetching && !list.isFetchingNextPage ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> : null}
        </div>
      )}

      {view === 'list' && !empty && !loading && (
        <div className="flist-head">
          <span />
          <button onClick={() => setSortKey('name')}>
            名称 {sort.key === 'name' && <SortIcon />}
          </button>
          <button className="c-size" onClick={() => setSortKey('size')}>
            大小 {sort.key === 'size' && <SortIcon />}
          </button>
          <button className="c-type" onClick={() => setSortKey('type')}>
            类型 {sort.key === 'type' && <SortIcon />}
          </button>
          <button className="c-date" onClick={() => setSortKey('updated')}>
            修改时间 {sort.key === 'updated' && <SortIcon />}
          </button>
          <span />
        </div>
      )}

      <div ref={wrapRef} style={{ position: 'relative', height: loading || empty ? undefined : virt.getTotalSize() }}>
        {loading && <SkeletonGrid view={view} cols={cols || 4} />}
        {empty && (
          <Empty
            icon={q ? Search : category ? HardDrive : FolderUp}
            title={q ? '没有找到匹配的文件' : category ? `还没有${CATEGORY_LABEL[category]}` : '这里还是空的'}
            subtitle={q ? '试试其他关键词' : '拖拽文件到此处，或点击下方按钮上传'}
            action={
              !q && (
                <button className="btn btn-filled" onClick={() => pickUpload('files', category ? null : folderId)}>
                  <Upload /> 上传文件
                </button>
              )
            }
          />
        )}
        {!loading &&
          vItems.map((vr) => {
            const start = vr.index * cols;
            const rowItems = items.slice(start, start + cols);
            const style: CSSProperties = { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vr.start - margin}px)` };
            if (view === 'grid') {
              return (
                <div key={vr.key} className="fb-grid-row" style={{ ...style, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, height: rowH - gap }}>
                  {rowItems.map((item, j) => {
                    const idx = start + j;
                    const k = keyOf(item);
                    return (
                      <FileCard
                        key={k}
                        item={item}
                        selected={selected.has(k)}
                        dragging={dragKeys.has(k)}
                        dropTarget={dropKey === k}
                        showMeta={flat}
                        onCheck={(e) => {
                          e.stopPropagation();
                          if (e.shiftKey) selectRange(idx, true);
                          else toggle(item, idx);
                        }}
                        onMore={(e) => {
                          e.stopPropagation();
                          if (!selected.has(k)) selectOnly(item, idx);
                          setMenu({ anchor: anchorOf(e.currentTarget as Element), items: actionsFor(selected.has(k) ? selectedItems : [item]) });
                        }}
                        {...handlers(item, idx)}
                        {...(item.kind === 'folder' ? dropHandlers(item.id, k) : {})}
                      />
                    );
                  })}
                </div>
              );
            }
            const item = rowItems[0];
            if (!item) return null;
            const k = keyOf(item);
            return (
              <div key={vr.key} style={{ ...style, height: rowH }}>
                <FileRow
                  item={item}
                  odd={vr.index % 2 === 1}
                  height={rowH - 2}
                  selected={selected.has(k)}
                  dragging={dragKeys.has(k)}
                  dropTarget={dropKey === k}
                  showPath={flat}
                  onCheck={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey) selectRange(vr.index, true);
                    else toggle(item, vr.index);
                  }}
                  onMore={(e) => {
                    e.stopPropagation();
                    if (!selected.has(k)) selectOnly(item, vr.index);
                    setMenu({ anchor: anchorOf(e.currentTarget as Element), items: actionsFor(selected.has(k) ? selectedItems : [item]) });
                  }}
                  {...handlers(item, vr.index)}
                  {...(item.kind === 'folder' ? dropHandlers(item.id, k) : {})}
                />
              </div>
            );
          })}
      </div>
      {list.isFetchingNextPage && (
        <div className="row" style={{ justifyContent: 'center', padding: 16 }}>
          <span className="spinner c-variant" />
        </div>
      )}

      {mobile && !category && !selecting && (
        <motion.button className="fab" aria-label="上传" onClick={(e) => setMenu({ anchor: anchorOf(e.currentTarget), items: bgMenu().filter((m) => !('label' in m) || m.label !== '全选') })} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springSoft}>
          <Upload />
        </motion.button>
      )}

      <Menu anchor={menu?.anchor ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
      {preview && <Preview files={preview.files} index={preview.index} onClose={() => setPreview(null)} source={{ kind: 'owner' }} onShare={(f) => setShare(f)} />}
      <ShareDialog item={share} onClose={() => setShare(null)} />
      <DetailsDialog item={details} onClose={() => setDetails(null)} />
      <FolderPicker
        open={!!picker}
        title={picker ? `${picker.mode === 'move' ? '移动' : '复制'} ${picker.items.length} 个项目到…` : ''}
        confirmText={picker?.mode === 'move' ? '移动到此处' : '复制到此处'}
        disabledIds={picker?.items.filter((i) => i.kind === 'folder').map((i) => i.id) ?? []}
        initialFolderId={folderId}
        onClose={() => setPicker(null)}
        onPick={async (target) => {
          if (!picker) return;
          const ok = await moveOrCopy(picker.items, target, picker.mode);
          if (ok) {
            setPicker(null);
            clearSel();
          }
        }}
      />
    </div>
  );
}

const anchorOf = (el: Element): MenuAnchor => {
  const r = el.getBoundingClientRect();
  return { x: r.right, y: r.bottom, rect: r, align: 'end' };
};

/* ---------------- pieces ---------------- */

function Breadcrumbs({ crumbs, onGo, dropHandlers, dropKey }: { crumbs: Crumb[]; onGo: (id: string | null) => void; dropHandlers: (id: string | null, key: string) => object; dropKey: string | null }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ left: ref.current.scrollWidth, behavior: 'smooth' });
  }, [crumbs.length]);
  return (
    <nav className="crumbs" aria-label="路径" ref={ref}>
      <button className={`crumb${crumbs.length === 0 ? ' current' : ''}${dropKey === 'crumb:root' ? ' drop-target' : ''}`} onClick={() => onGo(null)} {...dropHandlers(null, 'crumb:root')}>
        <HardDrive />
        <span>我的文件</span>
      </button>
      {crumbs.map((c, i) => (
        <span key={c.id} className="row" style={{ gap: 2, flex: 'none' }}>
          <ChevronRight className="crumb-sep" />
          <button className={`crumb${i === crumbs.length - 1 ? ' current' : ''}${dropKey === 'crumb:' + c.id ? ' drop-target' : ''}`} onClick={() => onGo(c.id)} title={c.name} {...dropHandlers(c.id, 'crumb:' + c.id)}>
            <span>{c.name}</span>
          </button>
        </span>
      ))}
    </nav>
  );
}

export function Thumb({ item, size = 256, url }: { item: FsItem; size?: number; url?: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'fail'>('loading');
  const Icon = iconFor(item);
  const src = url ?? thumbUrl(item.id, size);
  if (!item.hasThumb || state === 'fail') return <Icon />;
  return (
    <>
      {state !== 'ok' && <Icon style={{ position: 'absolute' }} />}
      <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className={state === 'ok' ? 'loaded' : ''} onLoad={() => setState('ok')} onError={() => setState('fail')} />
    </>
  );
}

type ItemHandlers = Record<string, unknown>;

interface CardProps {
  item: FsItem;
  selected: boolean;
  dragging: boolean;
  dropTarget: boolean;
  showMeta?: boolean;
  showPath?: boolean;
  onCheck: (e: React.MouseEvent) => void;
  onMore: (e: React.MouseEvent) => void;
}

export function FileCard({ item, selected, dragging, dropTarget, onCheck, onMore, ...rest }: CardProps & ItemHandlers) {
  const Icon = iconFor(item);
  const { showMeta: _sm, showPath: _sp, ...dom } = rest as Record<string, unknown>;
  return (
    <div
      className={`fcard${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}${dropTarget ? ' drop-target' : ''}`}
      tabIndex={0}
      role="button"
      aria-selected={selected}
      aria-label={item.name}
      data-drop-folder={item.kind === 'folder' ? item.id : undefined}
      {...(dom as object)}
    >
      <div className={`fthumb${item.kind === 'folder' ? ' folder' : ''}`}>
        {item.kind === 'folder' ? <Icon /> : <Thumb item={item} />}
        {item.category === 'video' && (
          <span className="play-badge">
            <svg viewBox="0 0 24 24">
              <path d="M7 4.5v15l12-7.5z" />
            </svg>
          </span>
        )}
        {item.kind === 'file' && item.ext && !item.hasThumb && <span className="ext-badge">{item.ext.toUpperCase().slice(0, 5)}</span>}
      </div>
      <div className="fcard-name ellipsis" title={item.name}>
        {item.name}
      </div>
      <div className="fcard-meta ellipsis num">{item.kind === 'folder' ? formatDate(item.updatedAt) : `${formatBytes(item.size)} · ${formatDate(item.updatedAt)}`}</div>
      <span className="fcheck">
        <CheckCircle on={selected} onClick={onCheck} label="选择" />
      </span>
      <button className="icon-btn sm fmore" onClick={onMore} aria-label="更多操作" onDoubleClick={(e) => e.stopPropagation()}>
        <MoreHorizontal />
      </button>
      <AnimatePresence>
        {selected && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={springSoft} style={{ position: 'absolute', top: 14, left: 14, pointerEvents: 'none' }}>
            <span className="check-circle on">
              <Check />
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FileRow({ item, selected, dragging, dropTarget, odd, height, onCheck, onMore, ...rest }: CardProps & ItemHandlers & { odd: boolean; height: number }) {
  const Icon = iconFor(item);
  const { showMeta: _sm, showPath: _sp, ...dom } = rest as Record<string, unknown>;
  return (
    <div
      className={`flist-row${odd ? ' odd' : ''}${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}${dropTarget ? ' drop-target' : ''}`}
      style={{ height }}
      tabIndex={0}
      role="row"
      aria-selected={selected}
      data-drop-folder={item.kind === 'folder' ? item.id : undefined}
      {...(dom as object)}
    >
      <span className="flist-check">
        <CheckCircle on={selected} onClick={onCheck} label="选择" />
      </span>
      <span className="flist-name">
        <span className={`ficon${item.kind === 'folder' ? ' folder' : ''}`}>{item.kind === 'folder' ? <Icon /> : <Thumb item={item} size={128} />}</span>
        <span className="col" style={{ minWidth: 0 }}>
          <span className="ellipsis w-500" title={item.name}>
            {item.name}
          </span>
          <span className="t-caption c-variant ellipsis num mobile-meta">{item.kind === 'folder' ? formatDate(item.updatedAt, true) : `${formatBytes(item.size)} · ${formatDate(item.updatedAt, true)}`}</span>
        </span>
      </span>
      <span className="cell num c-size">{item.kind === 'folder' ? '—' : formatBytes(item.size)}</span>
      <span className="cell c-type">{typeLabel(item)}</span>
      <span className="cell num c-date">{formatDate(item.updatedAt, true)}</span>
      <button className="icon-btn sm fmore" onClick={onMore} aria-label="更多操作" onDoubleClick={(e) => e.stopPropagation()}>
        <MoreHorizontal />
      </button>
    </div>
  );
}

function SkeletonGrid({ view, cols }: { view: 'grid' | 'list'; cols: number }) {
  if (view === 'list') {
    return (
      <div className="col" style={{ gap: 6 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="row" style={{ height: 48, padding: '0 12px', gap: 12 }}>
            <div className="skeleton" style={{ width: 34, height: 34 }} />
            <div className="skeleton" style={{ height: 14, width: `${40 + ((i * 37) % 40)}%` }} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="fb-grid-row" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: 12 }}>
      {Array.from({ length: cols * 2 }).map((_, i) => (
        <div key={i} className="fcard" style={{ pointerEvents: 'none' }}>
          <div className="skeleton" style={{ aspectRatio: '4/3', borderRadius: 12 }} />
          <div className="skeleton" style={{ height: 12, margin: '12px 4px 0', width: '70%' }} />
          <div className="skeleton" style={{ height: 10, margin: '8px 4px 2px', width: '45%' }} />
        </div>
      ))}
    </div>
  );
}
