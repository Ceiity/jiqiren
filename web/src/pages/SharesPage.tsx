import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, Ban, CheckCircle2, Copy, ExternalLink, KeyRound, Link2, MoreHorizontal, Pencil, Search, Trash2, X, Download, Eye, Lock, Unlock, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { get, post, qs } from '../lib/api';
import { expiryText, formatCount, formatDateTime, formatRelative } from '../lib/format';
import { iconFor } from '../lib/fileIcons';
import { useDebounced } from '../lib/hooks';
import { queryClient } from '../lib/queryClient';
import type { Share } from '../lib/types';
import { Page } from '../layout/Page';
import { CheckCircle, Segmented } from '../ui/controls';
import { Dialog } from '../ui/Dialog';
import { confirmDialog } from '../ui/dialogs';
import { Empty } from '../ui/Empty';
import { Menu, anchorFrom, type MenuAnchor, type MenuEntry } from '../ui/Menu';
import { cardIn, listStagger } from '../ui/motion';
import { toast, toastError } from '../ui/Toast';
import { copyText, shareUrl } from '../features/actions';
import { ShareDialog } from '../features/ShareDialog';
import { lastNDays } from '../ui/Sparkline';

type Filter = 'all' | 'active' | 'disabled' | 'expired';

export const STATE_CHIP: Record<Share['state'], [string, string]> = {
  active: ['chip-success', '生效中'],
  disabled: ['chip-error', '已禁用'],
  expired: ['', '已过期'],
  exhausted: ['chip-warning', '次数用尽'],
  missing: ['chip-error', '文件已删除'],
};

export function SharesPage({ admin = false }: { admin?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<Share | null>(null);
  const [stats, setStats] = useState<Share | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuEntry[] } | null>(null);
  const base = admin ? '/api/admin/shares' : '/api/shares';

  const list = useInfiniteQuery({
    queryKey: ['shares', admin ? 'admin' : 'mine', filter, q],
    queryFn: ({ pageParam }) => get<{ items: Share[]; total: number; nextOffset: number | null }>(`${base}${qs({ state: filter === 'all' ? undefined : filter, q, offset: pageParam, limit: 50 })}`),
    initialPageParam: 0,
    getNextPageParam: (l) => l.nextOffset ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;

  const batch = async (ids: number[], action: 'enable' | 'disable' | 'delete') => {
    if (action === 'delete' && !(await confirmDialog({ title: ids.length > 1 ? `删除 ${ids.length} 个分享？` : '删除该分享？', message: '删除后链接将立即失效，且无法恢复。', confirmText: '删除', danger: true }))) return;
    try {
      await post(`${base}/batch`, { ids, action });
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ['shares'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast.success(action === 'delete' ? '已删除' : action === 'enable' ? '已重新启用' : '已禁用');
    } catch (e) {
      toastError(e);
    }
  };

  const actions = (s: Share): MenuEntry[] => [
    {
      label: '复制链接',
      icon: Copy,
      onSelect: async () => {
        if (await copyText(shareUrl(s.token))) toast.success('链接已复制');
      },
    },
    { label: '打开分享页', icon: ExternalLink, onSelect: () => window.open(`/s/${s.token}`, '_blank', 'noopener') },
    { label: '编辑设置', icon: Pencil, onSelect: () => setEdit(s), hidden: admin },
    { label: '访问统计', icon: BarChart3, onSelect: () => setStats(s), hidden: admin },
    { type: 'separator' },
    s.status === 'active' ? { label: '禁用分享', icon: Ban, onSelect: () => batch([s.id], 'disable') } : { label: '重新启用', icon: CheckCircle2, onSelect: () => batch([s.id], 'enable') },
    { label: '删除分享', icon: Trash2, danger: true, onSelect: () => batch([s.id], 'delete') },
  ];

  const toggle = (id: number) =>
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const body = (
    <>
      <div className="share-filters">
        <AnimatePresence mode="wait" initial={false}>
          {selected.size > 0 ? (
            <motion.div key="sel" className="fb-selbar" style={{ flex: 1 }} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
              <button className="icon-btn" onClick={() => setSelected(new Set())} aria-label="取消选择">
                <X />
              </button>
              <span className="count">已选 {selected.size} 个</span>
              <span className="spacer" />
              <button className="btn btn-sm btn-text" onClick={() => batch([...selected], 'enable')}>
                <CheckCircle2 /> 启用
              </button>
              <button className="btn btn-sm btn-text" onClick={() => batch([...selected], 'disable')}>
                <Ban /> 禁用
              </button>
              <button className="btn btn-sm btn-danger-text" onClick={() => batch([...selected], 'delete')}>
                <Trash2 /> 删除
              </button>
            </motion.div>
          ) : (
            <motion.div key="filters" className="row" style={{ flex: 1, flexWrap: 'wrap', gap: 8 }} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.16 }}>
              <Segmented
                size="small"
                className="on-page"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'active', label: '有效' },
                  { value: 'disabled', label: '已禁用' },
                  { value: 'expired', label: '已过期' },
                ]}
              />
              <label className="search-pill">
                <Search />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索分享名称、备注或链接标识" />
                {query && (
                  <button className="icon-btn sm" onClick={() => setQuery('')} aria-label="清除">
                    <X />
                  </button>
                )}
              </label>
              <span className="t-footnote c-variant num" style={{ marginLeft: 'auto' }}>
                共 {total} 个
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {list.isLoading && (
        <div className="share-list">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 72, borderRadius: 24 }} />
          ))}
        </div>
      )}
      {!list.isLoading && items.length === 0 && <Empty icon={Link2} title={q || filter !== 'all' ? '没有符合条件的分享' : '还没有分享链接'} subtitle="在「我的文件」中选择文件或文件夹，点击分享即可生成外链" />}

      <motion.div className={`share-list${selected.size ? ' selecting' : ''}`} variants={listStagger} initial="hidden" animate="show" key={`${filter}-${q}`}>
        <AnimatePresence initial={false}>
          {items.map((s) => {
            const Icon = iconFor({ kind: s.targetType, category: s.category, ext: s.name.split('.').pop() ?? '' });
            const [cls, label] = STATE_CHIP[s.state];
            const sel = selected.has(s.id);
            return (
              <motion.div
                layout
                key={s.id}
                variants={cardIn}
                exit={{ opacity: 0, x: -30, transition: { duration: 0.18 } }}
                className={`share-card${sel ? ' selected' : ''}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ anchor: { x: e.clientX, y: e.clientY }, items: actions(s) });
                }}
              >
                <span className="check-wrap">
                  <CheckCircle on={sel} onClick={() => toggle(s.id)} label="选择" />
                </span>
                <span className="glyph-well" style={s.targetType === 'folder' ? { color: 'var(--primary)' } : undefined}>
                  <Icon />
                </span>
                <div className="col" style={{ gap: 3, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="t-subhead w-600 ellipsis">{s.name}</span>
                    <span className={`chip ${cls}`}>
                      <span className="dot" />
                      {label}
                    </span>
                    {s.hasPassword && (
                      <span className="chip" title="需要访问密码">
                        <KeyRound />
                      </span>
                    )}
                  </div>
                  <button
                    className="share-link ellipsis"
                    title="点击复制链接"
                    onClick={async () => {
                      if (await copyText(shareUrl(s.token))) toast.success('链接已复制');
                    }}
                  >
                    <Link2 size={13} style={{ flex: 'none' }} />
                    <span className="ellipsis">{shareUrl(s.token).replace(/^https?:\/\//, '')}</span>
                  </button>
                  <div className="t-caption c-variant ellipsis num">
                    {admin && s.ownerName ? `@${s.ownerName} · ` : ''}创建于 {formatRelative(s.createdAt)} · {expiryText(s.expiresAt)}
                    {s.note ? ` · ${s.note}` : ''}
                  </div>
                </div>
                <div className="share-stats">
                  <div>
                    <div className="t-headline num">{formatCount(s.viewCount)}</div>
                    <div className="t-caption c-variant">访问{s.maxViews ? ` / ${s.maxViews}` : ''}</div>
                  </div>
                  <div>
                    <div className="t-headline num">{formatCount(s.downloadCount)}</div>
                    <div className="t-caption c-variant">下载{s.maxDownloads ? ` / ${s.maxDownloads}` : ''}</div>
                  </div>
                </div>
                <button className="icon-btn" aria-label="更多操作" onClick={(e) => setMenu({ anchor: anchorFrom(e.currentTarget, 'end'), items: actions(s) })}>
                  <MoreHorizontal />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
      {list.hasNextPage && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-tonal" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}
      <Menu anchor={menu?.anchor ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
      <ShareDialog share={edit} onClose={() => setEdit(null)} />
      <StatsDialog share={stats} onClose={() => setStats(null)} />
    </>
  );

  if (admin) return body;
  return <Page title="分享管理">{body}</Page>;
}

interface ShareDetail extends Share {
  stats: { daily: { day: string; action: string; c: number }[]; recent: { action: string; fileName: string | null; ip: string; userAgent: string; createdAt: number }[] };
}

const ACTION_TEXT: Record<string, [string, typeof Eye]> = {
  view: ['访问了分享页', Eye],
  download: ['下载', Download],
  unlock: ['输入密码解锁', Unlock],
  unlock_failed: ['密码错误', XCircle],
};

function StatsDialog({ share, onClose }: { share: Share | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['shares', 'detail', share?.id], queryFn: () => get<ShareDetail>(`/api/shares/${share!.id}`), enabled: !!share });
  const days = lastNDays(14);
  const views = days.map((d) => q.data?.stats.daily.find((x) => x.day === d && x.action === 'view')?.c ?? 0);
  const dls = days.map((d) => q.data?.stats.daily.find((x) => x.day === d && x.action === 'download')?.c ?? 0);
  const max = Math.max(1, ...views.map((v, i) => v + dls[i]));
  return (
    <Dialog open={!!share} onClose={onClose} width={560} title="访问统计" subtitle={share?.name}>
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <div className="well grow" style={{ padding: '12px 14px' }}>
          <div className="t-caption c-variant">总访问</div>
          <div className="t-title2 num">{formatCount(q.data?.viewCount ?? share?.viewCount ?? 0)}</div>
        </div>
        <div className="well grow" style={{ padding: '12px 14px' }}>
          <div className="t-caption c-variant">总下载</div>
          <div className="t-title2 num">{formatCount(q.data?.downloadCount ?? share?.downloadCount ?? 0)}</div>
        </div>
        <div className="well grow" style={{ padding: '12px 14px' }}>
          <div className="t-caption c-variant">最近访问</div>
          <div className="t-subhead w-600" style={{ marginTop: 6 }}>{q.data?.lastAccessAt ? formatRelative(q.data.lastAccessAt) : '暂无'}</div>
        </div>
      </div>
      <div className="well" style={{ padding: '8px 10px 10px', background: 'var(--float-block)' }}>
        <div className="row t-caption c-variant" style={{ gap: 12, padding: '4px 4px 0' }}>
          <span>近 14 天</span>
          <span className="spacer" />
          <span className="row" style={{ gap: 4 }}><span className="legend-dot" style={{ background: 'var(--primary)' }} />访问</span>
          <span className="row" style={{ gap: 4 }}><span className="legend-dot" style={{ background: 'color-mix(in srgb, var(--primary) 45%, var(--float-block))' }} />下载</span>
        </div>
        <div className="bars">
          {days.map((d, i) => (
            <div className="bar" key={d} title={`${d}：访问 ${views[i]}，下载 ${dls[i]}`}>
              <motion.i initial={{ height: 0 }} animate={{ height: `${(dls[i] / max) * 100}%` }} transition={{ delay: i * 0.02, duration: 0.5 }} style={{ background: 'color-mix(in srgb, var(--primary) 45%, var(--float-block))' }} />
              <motion.i initial={{ height: 0 }} animate={{ height: `${(views[i] / max) * 100}%` }} transition={{ delay: i * 0.02, duration: 0.5 }} style={{ background: 'var(--primary)' }} />
            </div>
          ))}
        </div>
        <div className="bars-x">
          {days.map((d, i) => (
            <span key={d}>{i % 2 === 0 ? d.slice(8) : ''}</span>
          ))}
        </div>
      </div>
      <div className="group-title">最近记录</div>
      <div className="col" style={{ gap: 2, paddingBottom: 8 }}>
        {q.data?.stats.recent.length === 0 && <div className="t-footnote c-variant" style={{ padding: 12 }}>暂无访问记录</div>}
        {q.data?.stats.recent.map((r, i) => {
          const [text, Icon] = ACTION_TEXT[r.action] ?? [r.action, Lock];
          return (
            <div key={i} className="log-row">
              <span className="glyph-well" style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--float-block)' }}>
                <Icon size={16} />
              </span>
              <div className="col" style={{ minWidth: 0 }}>
                <span className="t-footnote w-600 ellipsis">
                  {text}
                  {r.fileName ? `「${r.fileName}」` : ''}
                </span>
                <span className="t-caption c-variant ellipsis">{r.ip}</span>
              </div>
              <span className="t-caption c-variant num">{formatDateTime(r.createdAt)}</span>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
