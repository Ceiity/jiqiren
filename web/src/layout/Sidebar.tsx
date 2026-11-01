import { motion } from 'framer-motion';
import { LogOut, PanelLeft, Plus, Settings, Upload, FolderUp, FolderPlus } from 'lucide-react';
import { Fragment } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { formatBytes } from '../lib/format';
import { usePrefs, useSession, useUser } from '../lib/session';
import { pickUpload } from '../lib/uploadTarget';
import { Avatar, Progress } from '../ui/controls';
import { Logo } from '../ui/Logo';
import { Menu, useMenu } from '../ui/Menu';
import { springSnappy } from '../ui/motion';
import { NAV, matchNav } from './nav';
import { newFolderHere } from '../features/actions';

export function Sidebar() {
  const [prefs, update] = usePrefs();
  const { config, logout } = useSession();
  const user = useUser();
  const loc = useLocation();
  const nav = useNavigate();
  const expanded = prefs.sidebarExpanded;
  const active = matchNav(loc.pathname);
  const items = NAV.filter((n) => !n.admin || user.role === 'admin');
  const userMenu = useMenu();
  const newMenu = useMenu();
  const pct = user.quotaBytes ? user.usedBytes / user.quotaBytes : 0;

  return (
    <aside className={`sidebar${expanded ? ' expanded' : ''}`} aria-label="主导航">
      <div className="sidebar-top">
        <button className="icon-btn sidebar-toggle" onClick={() => update({ sidebarExpanded: !expanded })} aria-label={expanded ? '收起导航栏' : '展开导航栏'} title={expanded ? '收起' : '展开'}>
          <PanelLeft />
        </button>
        <div className="sidebar-brand">
          <Logo size={28} emoji={config?.siteIcon || undefined} />
          <span className="sidebar-label t-headline">{config?.siteName ?? '奶龙云盘'}</span>
        </div>
      </div>

      <div className="sidebar-new">
        <button className="btn btn-filled sidebar-new-btn" onClick={(e) => newMenu.open(e.currentTarget, 'start')} title="新建">
          <Plus />
          <span className="sidebar-label">新建</span>
        </button>
      </div>

      <nav className="sidebar-nav">
        {items.map((n, i) => {
          const Icon = n.icon;
          const sel = active?.to === n.to;
          return (
            <Fragment key={n.to}>
              {i > 0 && items[i - 1].group !== n.group && <div className="sidebar-gap" />}
              <NavLink to={n.to} end={n.end} className={`side-item${sel ? ' selected' : ''}`} title={expanded ? undefined : n.label} aria-current={sel ? 'page' : undefined}>
                {sel && (
                  <>
                    <motion.span layoutId="side-fill" className="side-fill" transition={springSnappy} />
                    <motion.span layoutId="side-bar" className="side-bar" transition={springSnappy} />
                  </>
                )}
                <Icon className="side-icon" />
                <span className="sidebar-label">{n.label}</span>
              </NavLink>
            </Fragment>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <button className="side-quota" onClick={() => nav('/storage')} title={`已用 ${formatBytes(user.usedBytes)}`}>
          <div className="row t-caption">
            <span className="c-variant">存储空间</span>
            <span className="spacer" />
            <span className="num c-variant">{user.quotaBytes ? `${Math.round(pct * 100)}%` : ''}</span>
          </div>
          <Progress value={user.quotaBytes ? pct : 0.04} state={pct > 0.9 ? 'error' : undefined} />
          <div className="t-caption num c-variant ellipsis">
            {formatBytes(user.usedBytes)} / {user.quotaBytes ? formatBytes(user.quotaBytes) : '不限'}
          </div>
        </button>
        <button className="side-user" onClick={(e) => userMenu.open(e.currentTarget, 'start')}>
          <Avatar name={user.nickname} url={user.avatarUrl} size={32} />
          <span className="sidebar-label col" style={{ textAlign: 'left' }}>
            <span className="t-footnote w-600 ellipsis">{user.nickname}</span>
            <span className="t-caption c-variant ellipsis">{user.role === 'admin' ? '管理员' : '@' + user.username}</span>
          </span>
        </button>
      </div>

      <Menu
        {...newMenu.props}
        items={[
          { label: '上传文件', icon: Upload, onSelect: () => pickUpload('files') },
          { label: '上传文件夹', icon: FolderUp, onSelect: () => pickUpload('folder') },
          { type: 'separator' },
          { label: '新建文件夹', icon: FolderPlus, onSelect: () => newFolderHere(nav, loc.pathname) },
        ]}
      />
      <Menu
        {...userMenu.props}
        items={[
          { type: 'label', label: `${user.nickname} · @${user.username}` },
          { label: '设置', icon: Settings, onSelect: () => nav('/settings') },
          { type: 'separator' },
          { label: '退出登录', icon: LogOut, danger: true, onSelect: () => void logout() },
        ]}
      />
    </aside>
  );
}
