import { motion } from 'framer-motion';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useUser } from '../lib/session';
import { Dialog } from '../ui/Dialog';
import { springSnappy } from '../ui/motion';
import { DOCK, NAV, matchNav } from './nav';

/** Floating bottom dock for phones (FlClash mobile navigation). */
export function Dock() {
  const loc = useLocation();
  const nav = useNavigate();
  const user = useUser();
  const [more, setMore] = useState(false);
  const active = matchNav(loc.pathname);
  const dockItems = DOCK.map((to) => NAV.find((n) => n.to === to)!).filter(Boolean);
  const inDock = active && DOCK.includes(active.to);
  const rest = NAV.filter((n) => !DOCK.includes(n.to) && (!n.admin || user.role === 'admin'));

  return (
    <>
      <nav className="dock" aria-label="主导航">
        {dockItems.map((n) => {
          const Icon = n.icon;
          const sel = active?.to === n.to;
          return (
            <NavLink key={n.to} to={n.to} end={n.end} className={`dock-item${sel ? ' selected' : ''}`}>
              {sel && <motion.span layoutId="dock-platter" className="dock-platter" transition={springSnappy} />}
              <Icon />
              <span>{n.label === '我的文件' ? '文件' : n.label === '分享管理' ? '分享' : n.label}</span>
            </NavLink>
          );
        })}
        <button className={`dock-item${!inDock ? ' selected' : ''}`} onClick={() => setMore(true)}>
          {!inDock && <motion.span layoutId="dock-platter" className="dock-platter" transition={springSnappy} />}
          <MoreHorizontal />
          <span>更多</span>
        </button>
      </nav>
      <Dialog open={more} onClose={() => setMore(false)} title="更多">
        <div className="more-grid">
          {rest.map((n) => {
            const Icon = n.icon;
            const sel = active?.to === n.to;
            return (
              <button
                key={n.to}
                className={`more-tile${sel ? ' selected' : ''}`}
                onClick={() => {
                  setMore(false);
                  nav(n.to);
                }}
              >
                <span className="glyph-well">
                  <Icon />
                </span>
                <span className="t-footnote w-600">{n.label}</span>
              </button>
            );
          })}
        </div>
      </Dialog>
    </>
  );
}
