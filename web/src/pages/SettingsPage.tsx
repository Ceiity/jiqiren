import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Camera,
  Check,
  Download,
  FileArchive,
  Folder,
  Gauge,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  LayoutGrid,
  Link2,
  LogOut,
  Minus,
  Monitor,
  Moon,
  Palette,
  Plus,
  RefreshCcw,
  Rows3,
  Scissors,
  ShieldCheck,
  Sparkles,
  Sun,
  Timer,
  Trash2,
  UserPlus,
  UserRound,
  Smile,
  Lock,
  Info,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, get, patch, post, put } from '../lib/api';
import { formatBytes } from '../lib/format';
import { queryClient } from '../lib/queryClient';
import { usePrefs, useSession, useUser } from '../lib/session';
import type { Preferences } from '../lib/types';
import { Page } from '../layout/Page';
import { ACCENT_PRESETS, buildScheme } from '../theme/scheme';
import { useResolvedDark, withThemeTransition } from '../theme/ThemeProvider';
import { Avatar, Progress, Segmented, SetRow, Switch } from '../ui/controls';
import { Dialog } from '../ui/Dialog';
import { promptDialog } from '../ui/dialogs';
import { cardIn, listStagger } from '../ui/motion';
import { toast, toastError } from '../ui/Toast';
import { FolderPicker } from '../features/FolderPicker';

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Palette; children: ReactNode }) {
  return (
    <motion.section variants={cardIn}>
      <div className="group-title">
        {Icon && <Icon size={15} />}
        {title}
      </div>
      <div className="group">{children}</div>
    </motion.section>
  );
}

function Stepper({ value, min, max, onChange, suffix = '' }: { value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <span className="stepper">
      <button className="icon-btn" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="减少">
        <Minus />
      </button>
      <span>
        {value}
        {suffix}
      </span>
      <button className="icon-btn" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="增加">
        <Plus />
      </button>
    </span>
  );
}

function ThemePreview({ dark, accent }: { dark: boolean; accent: string }) {
  const s = buildScheme(accent, dark ? 'dark' : 'light', 'vivid');
  return (
    <div className="theme-mini" style={{ background: s['--page'] }}>
      <div className="tm-side" style={{ background: s['--chrome'] }} />
      <div className="tm-main">
        <i style={{ background: s['--card'] }} />
        <i style={{ background: s['--primary'] }} />
        <i style={{ background: s['--card'] }} />
        <i style={{ background: s['--card'] }} />
      </div>
    </div>
  );
}

export function SettingsPage() {
  const [prefs, update] = usePrefs();
  const { logout } = useSession();
  const user = useUser();
  const dark = useResolvedDark();
  const [pwOpen, setPwOpen] = useState(false);
  const [folderPick, setFolderPick] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const defaultFolder = useQuery({
    queryKey: ['fs', 'folder', prefs.defaultUploadFolderId],
    queryFn: () => get<{ name: string }>(`/api/fs/folders/${prefs.defaultUploadFolderId}`),
    enabled: !!prefs.defaultUploadFolderId,
    retry: false,
  });

  const themed = (patch: Partial<Preferences>, e?: React.MouseEvent) => {
    const r = (e?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect();
    withThemeTransition(() => update(patch), r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined);
  };

  const uploadAvatar = async (f: File) => {
    const fd = new FormData();
    fd.append('file', f);
    try {
      await api('/api/me/avatar', { method: 'POST', raw: fd });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.success('头像已更新');
    } catch (e) {
      toastError(e);
    }
  };

  const pct = user.quotaBytes ? user.usedBytes / user.quotaBytes : 0;

  return (
    <Page title="设置" className="narrow">
      <motion.div className="settings-wrap" variants={listStagger} initial="hidden" animate="show">
        {/* account */}
        <motion.section variants={cardIn} className="card account-card" style={{ marginTop: 4 }}>
          <button className="avatar-edit" onClick={() => avatarInput.current?.click()} aria-label="更换头像">
            <Avatar name={user.nickname} url={user.avatarUrl} size={64} />
            <span className="avatar-badge">
              <Camera />
            </span>
          </button>
          <input
            ref={avatarInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadAvatar(f);
              e.target.value = '';
            }}
          />
          <div className="col grow" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="t-title3 ellipsis">{user.nickname}</span>
              {user.role === 'admin' && (
                <span className="chip chip-primary">
                  <ShieldCheck /> 管理员
                </span>
              )}
            </div>
            <div className="t-footnote c-variant">@{user.username}</div>
            <div style={{ maxWidth: 320 }}>
              <Progress value={user.quotaBytes ? pct : 0.03} />
              <div className="t-caption c-variant num" style={{ marginTop: 4 }}>
                已用 {formatBytes(user.usedBytes)} / {user.quotaBytes ? formatBytes(user.quotaBytes) : '不限'}
              </div>
            </div>
          </div>
        </motion.section>

        <Section title="外观" icon={Palette}>
          <div className="set-row-block" style={{ paddingTop: 14 }}>
            <div className="theme-cards">
              {(
                [
                  ['system', '跟随系统', Monitor],
                  ['light', '浅色', Sun],
                  ['dark', '深色', Moon],
                ] as const
              ).map(([v, label, Icon]) => (
                <button key={v} className={`theme-card${prefs.themeMode === v ? ' on' : ''}`} onClick={(e) => themed({ themeMode: v }, e)}>
                  {v === 'system' ? (
                    <div className="theme-mini" style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', inset: 0, clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}>
                        <ThemePreview dark={false} accent={prefs.accentColor} />
                      </div>
                      <div style={{ position: 'absolute', inset: 0, clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}>
                        <ThemePreview dark accent={prefs.accentColor} />
                      </div>
                    </div>
                  ) : (
                    <ThemePreview dark={v === 'dark'} accent={prefs.accentColor} />
                  )}
                  <span className="row" style={{ justifyContent: 'center', gap: 6 }}>
                    <Icon size={15} />
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="set-row has-icon" style={{ flexWrap: 'wrap' }}>
            <span className="glyph-well">
              <Sparkles />
            </span>
            <span className="set-row-text">
              <span className="set-row-title">主题颜色</span>
              <span className="set-row-sub">应用于按钮、开关与选中状态</span>
            </span>
            <div className="swatches">
              {ACCENT_PRESETS.map((c) => (
                <button key={c} className={`swatch${prefs.accentColor.toUpperCase() === c ? ' on' : ''}`} style={{ background: c }} onClick={(e) => themed({ accentColor: c }, e)} aria-label={`主题色 ${c}`}>
                  {prefs.accentColor.toUpperCase() === c && <Check />}
                </button>
              ))}
              <label className={`swatch${!ACCENT_PRESETS.includes(prefs.accentColor.toUpperCase()) ? ' on' : ''}`} style={{ background: 'conic-gradient(#f44, #fd0, #4d4, #0cf, #44f, #c4f, #f44)' }} title="自定义颜色">
                <input type="color" value={prefs.accentColor} onChange={(e) => update({ accentColor: e.target.value.toUpperCase() })} aria-label="自定义颜色" />
              </label>
            </div>
          </div>
          <SetRow icon={Layers} title="配色风格" sub={{ vivid: '鲜明：主题色保持原样，背景接近中性灰', tinted: '着色：背景带有主题色调', soft: '柔和：降低主题色饱和度', monochrome: '单色：黑白灰' }[prefs.colorStyle]}>
            <select className="native-select" value={prefs.colorStyle} onChange={(e) => themed({ colorStyle: e.target.value as Preferences['colorStyle'] })}>
              <option value="vivid">鲜明</option>
              <option value="tinted">着色</option>
              <option value="soft">柔和</option>
              <option value="monochrome">单色</option>
            </select>
          </SetRow>
          <SetRow icon={Gauge} title="动画效果" sub="系统开启「减少动态效果」时会自动减弱">
            <Segmented
              size="small"
              value={prefs.motion}
              onChange={(v) => update({ motion: v })}
              options={[
                { value: 'full', label: '完整' },
                { value: 'reduced', label: '减弱' },
                { value: 'off', label: '关闭' },
              ]}
            />
          </SetRow>
          <SetRow icon={Rows3} title="列表密度">
            <Segmented
              size="small"
              value={prefs.density}
              onChange={(v) => update({ density: v })}
              options={[
                { value: 'comfortable', label: '舒适' },
                { value: 'compact', label: '紧凑' },
              ]}
            />
          </SetRow>
          <SetRow icon={LayoutGrid} title="默认文件视图">
            <Segmented
              size="small"
              value={prefs.defaultView}
              onChange={(v) => update({ defaultView: v })}
              options={[
                { value: 'grid', label: '网格' },
                { value: 'list', label: '列表' },
              ]}
            />
          </SetRow>
        </Section>

        <Section title="上传" icon={RefreshCcw}>
          <SetRow icon={Layers} title="同时上传数量" sub="同时进行的上传任务数">
            <Stepper value={prefs.uploadConcurrency} min={1} max={8} onChange={(v) => update({ uploadConcurrency: v })} />
          </SetRow>
          <SetRow icon={Scissors} title="分片大小" sub="网络不稳定时建议调小">
            <select className="native-select" value={prefs.chunkSizeMB} onChange={(e) => update({ chunkSizeMB: Number(e.target.value) })}>
              {[1, 2, 4, 8, 16, 32, 64].map((n) => (
                <option key={n} value={n}>
                  {n} MB
                </option>
              ))}
            </select>
          </SetRow>
          <SetRow icon={RefreshCcw} title="失败重试次数">
            <Stepper value={prefs.uploadRetries} min={0} max={10} onChange={(v) => update({ uploadRetries: v })} />
          </SetRow>
          <SetRow icon={Folder} title="默认上传目录" sub="在首页等非文件页面上传时使用" value={prefs.defaultUploadFolderId ? defaultFolder.data?.name ?? '…' : '我的文件'} chevron onClick={() => setFolderPick(true)} />
        </Section>

        <Section title="下载" icon={Download}>
          <SetRow icon={Download} title="点击文件时" sub="不支持预览的文件总是直接下载">
            <Segmented
              size="small"
              value={prefs.downloadBehavior}
              onChange={(v) => update({ downloadBehavior: v })}
              options={[
                { value: 'preview', label: '预览' },
                { value: 'direct', label: '下载' },
              ]}
            />
          </SetRow>
          <SetRow icon={FileArchive} title="多个文件打包为 ZIP" sub="选择多个文件下载时自动打包（流式生成，不占用服务器内存）">
            <Switch checked={prefs.zipMultiple} onChange={(v) => update({ zipMultiple: v })} label="打包下载" />
          </SetRow>
        </Section>

        <Section title="分享" icon={Link2}>
          <SetRow icon={Timer} title="默认有效期">
            <select className="native-select" value={prefs.shareDefaultExpire} onChange={(e) => update({ shareDefaultExpire: e.target.value as Preferences['shareDefaultExpire'] })}>
              <option value="never">永久有效</option>
              <option value="1h">1 小时</option>
              <option value="1d">1 天</option>
              <option value="7d">7 天</option>
              <option value="30d">30 天</option>
            </select>
          </SetRow>
          <SetRow icon={Download} title="默认允许下载">
            <Switch checked={prefs.shareDefaultAllowDownload} onChange={(v) => update({ shareDefaultAllowDownload: v })} label="默认允许下载" />
          </SetRow>
          <SetRow icon={KeyRound} title="默认访问密码" sub="创建分享时自动生成随机密码">
            <Switch checked={prefs.shareDefaultPassword === 'random'} onChange={(v) => update({ shareDefaultPassword: v ? 'random' : 'none' })} label="默认访问密码" />
          </SetRow>
        </Section>

        <Section title="账户" icon={UserRound}>
          <SetRow
            icon={UserRound}
            title="昵称"
            value={user.nickname}
            chevron
            onClick={async () => {
              const v = await promptDialog({ title: '修改昵称', initial: user.nickname, validate: (x) => (!x ? '请输入昵称' : x.length > 40 ? '最多 40 个字符' : null) });
              if (!v) return;
              try {
                await patch('/api/me', { nickname: v });
                void queryClient.invalidateQueries({ queryKey: ['me'] });
                toast.success('昵称已更新');
              } catch (e) {
                toastError(e);
              }
            }}
          />
          <SetRow icon={Camera} title="头像" sub="支持 JPG / PNG / WEBP，自动裁剪" chevron onClick={() => avatarInput.current?.click()} />
          {user.avatarUrl && (
            <SetRow
              icon={Trash2}
              title="移除头像"
              onClick={async () => {
                await api('/api/me/avatar', { method: 'DELETE' }).catch(toastError);
                void queryClient.invalidateQueries({ queryKey: ['me'] });
              }}
            />
          )}
          <SetRow icon={Lock} title="修改密码" chevron onClick={() => setPwOpen(true)} />
          <SetRow icon={LogOut} title="退出登录" danger onClick={() => void logout()} />
        </Section>

        {user.role === 'admin' && <SystemSettings />}

        <motion.div variants={cardIn} className="t-caption c-variant" style={{ textAlign: 'center', padding: '28px 0 8px' }}>
          奶龙云盘 · 界面设计语言参考 FlClash（GPL-3.0），代码为独立实现 · {dark ? '深色' : '浅色'}模式
        </motion.div>
      </motion.div>

      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      <FolderPicker
        open={folderPick}
        title="选择默认上传目录"
        confirmText="设为默认"
        initialFolderId={prefs.defaultUploadFolderId}
        onClose={() => setFolderPick(false)}
        onPick={(id) => {
          update({ defaultUploadFolderId: id });
          setFolderPick(false);
          toast.success('已设置默认上传目录');
        }}
      />
    </Page>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldPw, setOld] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setOld('');
      setPw('');
      setPw2('');
    }
  }, [open]);
  const submit = async () => {
    if (pw.length < 8) return toast.error('新密码至少 8 位');
    if (pw !== pw2) return toast.error('两次输入的新密码不一致');
    setBusy(true);
    try {
      await post('/api/me/password', { oldPassword: oldPw, newPassword: pw });
      toast.success('密码已修改，其他设备已退出登录');
      onClose();
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
      title="修改密码"
      width={420}
      actions={
        <>
          <button className="btn btn-tonal" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-filled" onClick={submit} disabled={busy || !oldPw || !pw}>
            保存
          </button>
        </>
      }
    >
      <form
        className="col"
        style={{ gap: 12, paddingBottom: 4 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input className="input" type="password" autoComplete="current-password" placeholder="当前密码" value={oldPw} onChange={(e) => setOld(e.target.value)} autoFocus />
        <input className="input" type="password" autoComplete="new-password" placeholder="新密码（至少 8 位）" value={pw} onChange={(e) => setPw(e.target.value)} />
        <input className="input" type="password" autoComplete="new-password" placeholder="再次输入新密码" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

interface SysSettings {
  siteName: string;
  siteIcon: string;
  publicUrl: string;
  allowRegister: boolean;
  defaultQuotaGB: number;
  maxFileSizeMB: number;
  trashRetentionDays: number;
  shareMaxExpireDays: number;
}

function SystemSettings() {
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => get<{ settings: SysSettings; env: { storageDriver: string; storagePath: string; dataDir: string; maxChunkMB: number } }>('/api/admin/settings') });
  const s = q.data?.settings;
  const save = async (patch: Partial<SysSettings>) => {
    try {
      const next = await put<SysSettings>('/api/admin/settings', patch);
      queryClient.setQueryData(['admin', 'settings'], (old: typeof q.data) => (old ? { ...old, settings: next } : old));
      void queryClient.invalidateQueries({ queryKey: ['public-config'] });
      toast.success('设置已保存，立即生效');
    } catch (e) {
      toastError(e);
    }
  };
  const edit = async (key: keyof SysSettings, title: string, opts: { number?: boolean; hint?: string; allowEmpty?: boolean } = {}) => {
    if (!s) return;
    const v = await promptDialog({
      title,
      message: opts.hint,
      initial: String(s[key]),
      validate: (x) => (opts.number ? (x === '' || isNaN(Number(x)) || Number(x) < 0 ? '请输入非负数字' : null) : !x && !opts.allowEmpty ? '不能为空' : null),
    });
    if (v === null) return;
    void save({ [key]: opts.number ? Number(v) : v } as Partial<SysSettings>);
  };
  return (
    <>
      <Section title="系统设置（管理员）" icon={ShieldCheck}>
        <SetRow icon={Globe} title="网站名称" value={s?.siteName} chevron onClick={() => edit('siteName', '网站名称')} />
        <SetRow icon={Smile} title="网站图标" sub="使用一个 Emoji 作为站点图标，留空使用默认图标" value={s?.siteIcon || '默认'} chevron onClick={() => edit('siteIcon', '网站图标（Emoji）', { allowEmpty: true })} />
        <SetRow icon={Link2} title="网站域名" sub="用于生成分享链接，例如 https://pan.example.com；留空使用当前访问地址" value={<span className="ellipsis" style={{ maxWidth: 200, display: 'block' }}>{s?.publicUrl || '自动'}</span>} chevron onClick={() => edit('publicUrl', '网站域名', { allowEmpty: true, hint: '以 http:// 或 https:// 开头，不要以 / 结尾' })} />
        <SetRow icon={UserPlus} title="开放注册" sub="允许访客自行注册普通账号">
          <Switch checked={!!s?.allowRegister} onChange={(v) => save({ allowRegister: v })} label="开放注册" />
        </SetRow>
        <SetRow icon={HardDrive} title="新用户默认配额" value={s ? (s.defaultQuotaGB ? `${s.defaultQuotaGB} GB` : '不限') : ''} chevron onClick={() => edit('defaultQuotaGB', '新用户默认配额 (GB，0 为不限)', { number: true })} />
        <SetRow icon={FileArchive} title="单文件大小限制" value={s ? (s.maxFileSizeMB ? `${s.maxFileSizeMB} MB` : '不限') : ''} chevron onClick={() => edit('maxFileSizeMB', '单文件大小限制 (MB，0 为不限)', { number: true })} />
        <SetRow icon={Trash2} title="回收站保留天数" value={s ? (s.trashRetentionDays ? `${s.trashRetentionDays} 天` : '永久') : ''} chevron onClick={() => edit('trashRetentionDays', '回收站保留天数（0 为永久保留）', { number: true })} />
        <SetRow icon={Timer} title="分享最长有效期" value={s ? (s.shareMaxExpireDays ? `${s.shareMaxExpireDays} 天` : '不限') : ''} chevron onClick={() => edit('shareMaxExpireDays', '分享最长有效期（天，0 为不限）', { number: true })} />
      </Section>
      <Section title="存储（只读，需修改环境变量并重启）" icon={HardDrive}>
        <SetRow icon={HardDrive} title="存储驱动" value={q.data?.env.storageDriver} />
        <SetRow icon={Folder} title="存储路径" sub={<span className="mono" style={{ wordBreak: 'break-all' }}>{q.data?.env.storagePath}</span>} />
        <SetRow icon={Info} title="HTTPS" sub="推荐在前置 Nginx / Caddy 反向代理上配置证书，详见 README 的「HTTPS 部署」。启用 HTTPS 后 Cookie 会自动带上 Secure 标记。" />
      </Section>
    </>
  );
}
