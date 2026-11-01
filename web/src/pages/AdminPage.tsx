import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Activity, Ban, CheckCircle2, Cpu, Database, FileStack, HardDrive, KeyRound, Link2, MemoryStick, MoreHorizontal, Plus, Search, Server, Trash2, UploadCloud, Users, DownloadCloud, ScrollText, UserCog, Gauge, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { del, get, patch, post, qs } from '../lib/api';
import { formatBytes, formatCount, formatDateTime, formatDuration, formatRelative } from '../lib/format';
import { iconFor } from '../lib/fileIcons';
import { useDebounced } from '../lib/hooks';
import { queryClient } from '../lib/queryClient';
import { useUser } from '../lib/session';
import type { FsItem, User } from '../lib/types';
import { Page } from '../layout/Page';
import { Avatar, Progress, Ring, Segmented, Switch } from '../ui/controls';
import { Dialog } from '../ui/Dialog';
import { confirmDialog, promptDialog } from '../ui/dialogs';
import { Empty } from '../ui/Empty';
import { Menu, anchorFrom, type MenuAnchor, type MenuEntry } from '../ui/Menu';
import { cardIn, listStagger } from '../ui/motion';
import { toast, toastError } from '../ui/Toast';
import { SharesPage } from './SharesPage';
import { Preview } from '../features/Preview';

type Tab = 'overview' | 'users' | 'files' | 'shares' | 'logs';

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <Page title="管理后台">
      <div className="admin-tabs">
        <Segmented
          className="on-page"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: '运行状态', icon: Gauge },
            { value: 'users', label: '用户', icon: Users },
            { value: 'files', label: '文件', icon: FileStack },
            { value: 'shares', label: '分享', icon: Link2 },
            { value: 'logs', label: '日志', icon: ScrollText },
          ]}
        />
      </div>
      <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
        {tab === 'overview' && <Overview />}
        {tab === 'users' && <UsersTab />}
        {tab === 'files' && <FilesTab />}
        {tab === 'shares' && <SharesPage admin />}
        {tab === 'logs' && <LogsTab />}
      </motion.div>
    </Page>
  );
}

interface Status {
  totals: Record<string, number>;
  disk: { total: number; free: number } | null;
  storageDriver: string;
  uploads: { active: number; sessions: number };
  downloads: { active: number };
  process: { uptime: number; rss: number; heapUsed: number; node: string };
  system: { platform: string; cpus: number; load: number[]; totalMem: number; freeMem: number };
  paths: { data: string; storage: string };
}

function Overview() {
  const q = useQuery({ queryKey: ['admin', 'status'], queryFn: () => get<Status>('/api/admin/status'), refetchInterval: 5000 });
  const s = q.data;
  const diskUsed = s?.disk ? s.disk.total - s.disk.free : 0;
  const tiles = [
    { label: '用户', icon: Users, value: s ? formatCount(s.totals.users) : '–', sub: s ? `${s.totals.activeUsers} 个启用` : '' },
    { label: '文件', icon: FileStack, value: s ? formatCount(s.totals.files) : '–', sub: s ? `${formatCount(s.totals.folders)} 个文件夹` : '' },
    { label: '有效分享', icon: Link2, value: s ? formatCount(s.totals.activeShares) : '–', sub: s ? `共 ${formatCount(s.totals.shares)} 个` : '' },
    { label: '实际占用', icon: Database, value: s ? formatBytes(s.totals.physicalBytes) : '–', sub: s ? `逻辑 ${formatBytes(s.totals.logicalBytes)}（去重）` : '' },
  ];
  return (
    <motion.div className="col" style={{ gap: 12 }} variants={listStagger} initial="hidden" animate="show">
      <div className="admin-grid">
        {tiles.map((t) => (
          <motion.section key={t.label} variants={cardIn} className="card">
            <div className="card-header">
              <t.icon />
              {t.label}
            </div>
            <div className="mid-num num" style={{ marginBottom: 4 }}>
              {t.value}
            </div>
            <div className="t-caption c-variant">{t.sub}</div>
          </motion.section>
        ))}
      </div>
      <div className="dash">
        <motion.section variants={cardIn} className="card span-6">
          <div className="card-header">
            <HardDrive /> 服务器磁盘
            <span className="chip">{s?.storageDriver === 's3' ? 'S3 对象存储' : '本地磁盘'}</span>
          </div>
          {s?.disk ? (
            <div className="row" style={{ gap: 24 }}>
              <Ring value={diskUsed / s.disk.total} size={112} stroke={12} color={s.disk.free / s.disk.total < 0.1 ? 'var(--error)' : 'var(--primary)'}>
                <div className="t-title3 num">{Math.round((diskUsed / s.disk.total) * 100)}%</div>
              </Ring>
              <div className="col" style={{ gap: 8 }}>
                <div>
                  <div className="t-caption c-variant">剩余空间</div>
                  <div className="t-title2 num">{formatBytes(s.disk.free)}</div>
                </div>
                <div className="t-footnote c-variant num">
                  已用 {formatBytes(diskUsed)} / 共 {formatBytes(s.disk.total)}
                </div>
              </div>
            </div>
          ) : (
            <div className="t-footnote c-variant">{s ? '对象存储不提供磁盘容量信息' : '加载中…'}</div>
          )}
          <div className="well t-caption c-variant mono" style={{ padding: '8px 12px', marginTop: 14, wordBreak: 'break-all' }}>
            {s?.paths.storage}
          </div>
        </motion.section>
        <motion.section variants={cardIn} className="card span-6">
          <div className="card-header">
            <Activity /> 运行状态
            <span className="chip chip-success">
              <span className="dot" /> 运行中
            </span>
          </div>
          <div className="admin-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
            <Mini icon={UploadCloud} label="上传中" value={s ? `${s.uploads.active} 个` : '–'} sub={s ? `${s.uploads.sessions} 个上传会话` : ''} />
            <Mini icon={DownloadCloud} label="下载中" value={s ? `${s.downloads.active} 个` : '–'} sub="当前传输连接" />
            <Mini icon={Server} label="已运行" value={s ? formatDuration(s.process.uptime) : '–'} sub={s?.process.node ?? ''} />
            <Mini icon={MemoryStick} label="服务内存" value={s ? formatBytes(s.process.rss) : '–'} sub={s ? `系统可用 ${formatBytes(s.system.freeMem)}` : ''} />
          </div>
          <div className="row t-caption c-variant" style={{ marginTop: 12, gap: 6 }}>
            <Cpu size={14} /> {s?.system.platform} · {s?.system.cpus} 核 · 负载 {s?.system.load.map((x) => x.toFixed(2)).join(' / ')}
          </div>
        </motion.section>
      </div>
    </motion.div>
  );
}

function Mini({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: string; sub: string }) {
  return (
    <div className="well" style={{ padding: '12px 14px' }}>
      <div className="row t-caption c-variant">
        <Icon size={14} />
        {label}
      </div>
      <div className="t-headline num" style={{ margin: '4px 0 2px' }}>
        {value}
      </div>
      <div className="t-caption c-variant ellipsis">{sub}</div>
    </div>
  );
}

/* ---------- users ---------- */

interface AdminUser extends User {
  fileCount: number;
}

function UsersTab() {
  const me = useUser();
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 300);
  const list = useQuery({ queryKey: ['admin', 'users', q], queryFn: () => get<{ items: AdminUser[]; total: number }>(`/api/admin/users${qs({ q })}`) });
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuEntry[] } | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin'] });
  const upd = async (u: AdminUser, body: Record<string, unknown>, msg: string) => {
    try {
      await patch(`/api/admin/users/${u.id}`, body);
      refresh();
      toast.success(msg);
    } catch (e) {
      toastError(e);
    }
  };
  const actions = (u: AdminUser): MenuEntry[] => [
    {
      label: '设置存储配额',
      icon: HardDrive,
      onSelect: async () => {
        const v = await promptDialog({ title: `设置「${u.nickname}」的存储配额`, message: '单位 GB，0 表示不限', initial: String(u.quotaBytes ? +(u.quotaBytes / 1024 ** 3).toFixed(2) : 0), validate: (x) => (isNaN(Number(x)) || Number(x) < 0 ? '请输入非负数字' : null) });
        if (v !== null) void upd(u, { quotaGB: Number(v) }, '配额已更新');
      },
    },
    {
      label: '重置密码',
      icon: KeyRound,
      onSelect: async () => {
        const v = await promptDialog({ title: `重置「${u.nickname}」的密码`, placeholder: '新密码（至少 8 位）', validate: (x) => (x.length < 8 ? '至少 8 位' : null) });
        if (v) void upd(u, { password: v }, '密码已重置，该用户需重新登录');
      },
    },
    { label: u.role === 'admin' ? '设为普通用户' : '设为管理员', icon: UserCog, onSelect: () => upd(u, { role: u.role === 'admin' ? 'user' : 'admin' }, '角色已更新'), disabled: u.id === me.id },
    u.status === 'active'
      ? { label: '禁用账号', icon: Ban, onSelect: () => upd(u, { status: 'disabled' }, '已禁用'), disabled: u.id === me.id }
      : { label: '启用账号', icon: CheckCircle2, onSelect: () => upd(u, { status: 'active' }, '已启用') },
    { type: 'separator' },
    {
      label: '删除用户',
      icon: Trash2,
      danger: true,
      disabled: u.id === me.id,
      onSelect: async () => {
        if (!(await confirmDialog({ title: `删除用户「${u.nickname}」？`, message: `将同时永久删除其 ${u.fileCount} 个文件和全部分享，无法恢复。`, confirmText: '删除', danger: true }))) return;
        try {
          await del(`/api/admin/users/${u.id}`);
          refresh();
          toast.success('用户已删除');
        } catch (e) {
          toastError(e);
        }
      },
    },
  ];
  return (
    <>
      <div className="share-filters">
        <label className="search-pill">
          <Search />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索用户名或昵称" />
        </label>
        <span className="spacer" />
        <button className="btn btn-filled" onClick={() => setCreating(true)}>
          <Plus /> 创建用户
        </button>
      </div>
      <div className="card flush" style={{ padding: 8 }}>
        <div className="admin-table" style={{ ['--cols' as string]: 'minmax(0,1.6fr) 90px minmax(0,1.3fr) 110px 40px', ['--cols-sm' as string]: 'minmax(0,1fr) 40px' }}>
          <div className="table-head">
            <span>用户</span>
            <span>状态</span>
            <span>存储</span>
            <span>最近登录</span>
            <span />
          </div>
          {list.data?.items.map((u) => {
            const pct = u.quotaBytes ? u.usedBytes / u.quotaBytes : 0;
            return (
              <div key={u.id} className="table-row" style={{ minHeight: 60 }}>
                <span className="row" style={{ gap: 10 }}>
                  <Avatar name={u.nickname} url={u.avatarUrl} size={34} />
                  <span className="col" style={{ minWidth: 0 }}>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="w-600 ellipsis">{u.nickname}</span>
                      {u.role === 'admin' && <span className="chip chip-primary">管理员</span>}
                    </span>
                    <span className="t-caption c-variant ellipsis">
                      @{u.username} · {u.fileCount} 个文件
                    </span>
                  </span>
                </span>
                <span className="hide-sm">
                  <span className={`chip ${u.status === 'active' ? 'chip-success' : 'chip-error'}`}>
                    <span className="dot" />
                    {u.status === 'active' ? '正常' : '已禁用'}
                  </span>
                </span>
                <span className="col hide-sm" style={{ gap: 4 }}>
                  <Progress value={u.quotaBytes ? pct : 0} state={pct > 0.9 ? 'error' : undefined} />
                  <span className="t-caption c-variant num">
                    {formatBytes(u.usedBytes)} / {u.quotaBytes ? formatBytes(u.quotaBytes) : '不限'}
                  </span>
                </span>
                <span className="t-caption c-variant hide-sm">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : '从未登录'}</span>
                <button className="icon-btn sm" aria-label="更多" onClick={(e) => setMenu({ anchor: anchorFrom(e.currentTarget, 'end'), items: actions(u) })}>
                  <MoreHorizontal />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <Menu anchor={menu?.anchor ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onDone={refresh} />
    </>
  );
}

function CreateUserDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ username: '', nickname: '', password: '', quotaGB: '10', admin: false });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await post('/api/admin/users', { username: f.username.trim(), nickname: f.nickname.trim() || undefined, password: f.password, quotaGB: Number(f.quotaGB) || 0, role: f.admin ? 'admin' : 'user' });
      toast.success('用户已创建');
      onDone();
      onClose();
      setF({ username: '', nickname: '', password: '', quotaGB: '10', admin: false });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="创建用户"
      width={440}
      actions={
        <>
          <button className="btn btn-tonal" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-filled" onClick={submit} disabled={busy || !f.username || f.password.length < 8}>
            创建
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12, paddingBottom: 4 }}>
        <input className="input" placeholder="用户名（3-32 位字母数字）" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoFocus />
        <input className="input" placeholder="昵称（可选）" value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} />
        <input className="input" type="password" autoComplete="new-password" placeholder="初始密码（至少 8 位）" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <div className="row">
          <input className="input num" type="number" min={0} style={{ width: 120 }} value={f.quotaGB} onChange={(e) => setF({ ...f, quotaGB: e.target.value })} />
          <span className="t-footnote c-variant">GB 存储配额（0 为不限）</span>
        </div>
        <div className="group">
          <div className="set-row">
            <span className="set-row-text">
              <span className="set-row-title">管理员权限</span>
            </span>
            <Switch checked={f.admin} onChange={(v) => setF({ ...f, admin: v })} label="管理员权限" />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------- files ---------- */

interface AdminFile extends FsItem {
  ownerId: number;
  ownerName: string;
}

function FilesTab() {
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 300);
  const [sort, setSort] = useState<'updated' | 'size'>('updated');
  const [preview, setPreview] = useState<number | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['admin', 'files', q, sort],
    queryFn: ({ pageParam }) => get<{ items: AdminFile[]; total: number; nextOffset: number | null }>(`/api/admin/files${qs({ q, sort, offset: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (l) => l.nextOffset ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const remove = async (f: AdminFile) => {
    if (!(await confirmDialog({ title: `永久删除「${f.name}」？`, message: `该文件属于 @${f.ownerName}，删除后无法恢复，相关分享也会失效。`, confirmText: '永久删除', danger: true }))) return;
    try {
      await post('/api/admin/files/delete', { fileIds: [f.id] });
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success('已删除');
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <>
      <div className="share-filters">
        <label className="search-pill">
          <Search />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索所有用户的文件" />
          {query && (
            <button className="icon-btn sm" onClick={() => setQuery('')} aria-label="清除">
              <X />
            </button>
          )}
        </label>
        <Segmented size="small" className="on-page" value={sort} onChange={setSort} options={[{ value: 'updated', label: '最近' }, { value: 'size', label: '最大' }]} />
        <span className="t-footnote c-variant num" style={{ marginLeft: 'auto' }}>
          共 {list.data?.pages[0]?.total ?? 0} 个文件
        </span>
      </div>
      {!list.isLoading && items.length === 0 && <Empty icon={FileStack} title="没有文件" />}
      <div className="card flush" style={{ padding: 8, display: items.length ? undefined : 'none' }}>
        <div className="admin-table" style={{ ['--cols' as string]: 'minmax(0,2fr) 120px 100px 130px 40px', ['--cols-sm' as string]: 'minmax(0,1fr) 40px' }}>
          <div className="table-head">
            <span>文件</span>
            <span>所有者</span>
            <span>大小</span>
            <span>修改时间</span>
            <span />
          </div>
          {items.map((f, i) => {
            const Icon = iconFor(f);
            return (
              <div key={f.id} className="table-row" style={{ minHeight: 52 }}>
                <button className="row" style={{ gap: 10, textAlign: 'left', minWidth: 0 }} onClick={() => setPreview(i)}>
                  <span className="recent-icon">
                    <Icon />
                  </span>
                  <span className="ellipsis w-500">{f.name}</span>
                </button>
                <span className="t-footnote c-variant ellipsis hide-sm">@{f.ownerName}</span>
                <span className="t-footnote num hide-sm">{formatBytes(f.size)}</span>
                <span className="t-caption c-variant hide-sm">{formatDateTime(f.updatedAt)}</span>
                <button className="icon-btn sm" aria-label="删除" title="永久删除" onClick={() => remove(f)}>
                  <Trash2 />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {list.hasNextPage && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-tonal" onClick={() => list.fetchNextPage()}>
            加载更多
          </button>
        </div>
      )}
      {preview !== null && <AdminPreview files={items} index={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

/** Admins can only stream their own files through the owner API; others are shown as info. */
function AdminPreview({ files, index, onClose }: { files: AdminFile[]; index: number; onClose: () => void }) {
  const me = useUser();
  const f = files[index];
  if (f.ownerId === me.id) return <Preview files={files} index={index} source={{ kind: 'owner' }} onClose={onClose} />;
  return (
    <Dialog open onClose={onClose} title={f.name} subtitle={`@${f.ownerName} · ${formatBytes(f.size)}`} width={420}>
      <div className="t-footnote c-variant" style={{ paddingBottom: 12 }}>
        出于隐私保护，管理员无法直接预览其他用户的文件内容，可进行删除等管理操作。
      </div>
    </Dialog>
  );
}

/* ---------- logs ---------- */

interface LogRow {
  id: number;
  username: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  created_at: number;
}

const LOG_TEXT: Record<string, string> = {
  'auth.login': '登录',
  'auth.login_failed': '登录失败',
  'auth.register': '注册账号',
  'system.setup': '初始化系统',
  'folder.create': '新建文件夹',
  'item.rename': '重命名',
  'item.move': '移动',
  'item.copy': '复制',
  'item.trash': '删除到回收站',
  'trash.restore': '从回收站恢复',
  'trash.delete': '彻底删除',
  'trash.empty': '清空回收站',
  'file.upload': '上传文件',
  'file.download_zip': '打包下载',
  'share.create': '创建分享',
  'share.update': '修改分享',
  'share.delete': '删除分享',
  'share.batch_enable': '批量启用分享',
  'share.batch_disable': '批量禁用分享',
  'share.batch_delete': '批量删除分享',
  'user.password_changed': '修改密码',
  'admin.user_create': '创建用户',
  'admin.user_update': '修改用户',
  'admin.user_delete': '删除用户',
  'admin.file_delete': '管理员删除文件',
  'admin.settings_update': '修改系统设置',
  'admin.share_enable': '管理员启用分享',
  'admin.share_disable': '管理员禁用分享',
  'admin.share_delete': '管理员删除分享',
};

function LogsTab() {
  const [filter, setFilter] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['admin', 'logs', filter],
    queryFn: ({ pageParam }) => get<{ items: LogRow[]; total: number; nextOffset: number | null }>(`/api/admin/logs${qs({ action: filter, offset: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (l) => l.nextOffset ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  return (
    <>
      <div className="share-filters">
        <Segmented
          size="small"
          className="on-page"
          value={filter}
          onChange={setFilter}
          options={[
            { value: '', label: '全部' },
            { value: 'auth', label: '登录' },
            { value: 'file', label: '文件' },
            { value: 'share', label: '分享' },
            { value: 'admin', label: '管理' },
          ]}
        />
      </div>
      <div className="card" style={{ padding: 8 }}>
        {items.length === 0 && !list.isLoading && <Empty compact icon={ScrollText} title="暂无日志" />}
        {items.map((l) => (
          <div key={l.id} className="log-row">
            <span className="letter-well">{(l.username ?? '?').slice(0, 1).toUpperCase()}</span>
            <div className="col" style={{ minWidth: 0 }}>
              <span className="t-footnote ellipsis">
                <b>{l.username ?? '系统'}</b> {LOG_TEXT[l.action] ?? l.action}
                {l.target ? <span className="c-variant">「{l.target}」</span> : null}
              </span>
              <span className="t-caption c-variant ellipsis">{[l.detail, l.ip].filter(Boolean).join(' · ')}</span>
            </div>
            <span className="t-caption c-variant num">{formatDateTime(l.created_at)}</span>
          </div>
        ))}
      </div>
      {list.hasNextPage && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-tonal" onClick={() => list.fetchNextPage()}>
            加载更多
          </button>
        </div>
      )}
    </>
  );
}
