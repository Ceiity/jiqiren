import { motion } from 'framer-motion';
import { KeyRound, Lock, LogIn, ShieldCheck, User, UserPlus } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../lib/api';
import { useSession } from '../lib/session';
import type { Preferences, User as UserT } from '../lib/types';
import { Logo } from '../ui/Logo';
import { springDialog } from '../ui/motion';
import { BootScreen } from '../ui/BootScreen';

function AuthCard({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  const { config } = useSession();
  return (
    <div className="auth-page">
      <motion.div className="auth-card" initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={springDialog}>
        <div className="auth-brand">
          <motion.div initial={{ rotate: -12, scale: 0.7 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', bounce: 0.55, duration: 0.7 }}>
            <Logo size={60} emoji={config?.siteIcon || undefined} />
          </motion.div>
          <div>
            <div className="t-title2">{title}</div>
            <div className="t-footnote c-variant" style={{ marginTop: 4 }}>
              {subtitle}
            </div>
          </div>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function Field({ icon: Icon, ...props }: { icon: typeof User } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="input-wrap">
      <Icon />
      <input className="input" {...props} />
    </label>
  );
}

type Resp = { user: UserT; preferences: Preferences; csrf: string };

function useAuthSubmit(url: string) {
  const { setSession } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const submit = async (body: Record<string, string>) => {
    setBusy(true);
    setErr('');
    try {
      const r = await post<Resp>(url, body);
      setSession(r);
      const next = params.get('next');
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setShake((s) => s + 1);
    } finally {
      setBusy(false);
    }
  };
  return { submit, err, busy, shake };
}

export function LoginPage() {
  const { user, loading, config } = useSession();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const { submit, err, busy, shake } = useAuthSubmit('/api/auth/login');
  if (loading) return <BootScreen />;
  if (config?.needsSetup) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to="/" replace />;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit({ username, password });
  };
  return (
    <AuthCard title={`登录${config?.siteName ?? '奶龙云盘'}`} subtitle="存储、管理与分享你的文件">
      <form className={`auth-form${shake ? ' shake' : ''}`} key={shake} onSubmit={onSubmit}>
        <Field icon={User} placeholder="用户名" autoComplete="username" value={username} onChange={(e) => setU(e.target.value)} autoFocus required />
        <Field icon={Lock} type="password" placeholder="密码" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} required />
        {err && <div className="field-error">{err}</div>}
        <button className="btn btn-filled btn-lg btn-block" disabled={busy}>
          {busy ? <span className="spinner" style={{ width: 18, height: 18 }} /> : <LogIn />} 登录
        </button>
        {config?.allowRegister && (
          <div className="t-footnote c-variant" style={{ textAlign: 'center' }}>
            还没有账号？<Link to="/register">注册</Link>
          </div>
        )}
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { config, user } = useSession();
  const [f, setF] = useState({ username: '', nickname: '', password: '', password2: '' });
  const [localErr, setLocalErr] = useState('');
  const { submit, err, busy, shake } = useAuthSubmit('/api/auth/register');
  if (user) return <Navigate to="/" replace />;
  if (config && !config.allowRegister) return <Navigate to="/login" replace />;
  return (
    <AuthCard title="注册账号" subtitle={`加入${config?.siteName ?? '奶龙云盘'}`}>
      <form
        className={`auth-form${shake ? ' shake' : ''}`}
        key={shake}
        onSubmit={(e) => {
          e.preventDefault();
          if (f.password !== f.password2) return setLocalErr('两次输入的密码不一致');
          setLocalErr('');
          void submit({ username: f.username, nickname: f.nickname, password: f.password });
        }}
      >
        <Field icon={User} placeholder="用户名（3-32 位字母数字）" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoFocus required />
        <Field icon={UserPlus} placeholder="昵称（可选）" value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} />
        <Field icon={Lock} type="password" placeholder="密码（至少 8 位）" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        <Field icon={Lock} type="password" placeholder="确认密码" autoComplete="new-password" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} required />
        {(localErr || err) && <div className="field-error">{localErr || err}</div>}
        <button className="btn btn-filled btn-lg btn-block" disabled={busy}>
          <UserPlus /> 注册
        </button>
        <div className="t-footnote c-variant" style={{ textAlign: 'center' }}>
          已有账号？<Link to="/login">登录</Link>
        </div>
      </form>
    </AuthCard>
  );
}

export function SetupPage() {
  const { config, loading } = useSession();
  const [f, setF] = useState({ token: '', username: 'admin', nickname: '', password: '', password2: '' });
  const [localErr, setLocalErr] = useState('');
  const { submit, err, busy, shake } = useAuthSubmit('/api/setup');
  if (loading) return <BootScreen />;
  if (config && !config.needsSetup) return <Navigate to="/" replace />;
  return (
    <AuthCard
      title="初始化奶龙云盘"
      subtitle={
        <>
          创建第一个管理员账号。初始化令牌已打印在服务端日志中
          <br />
          <span className="mono">docker compose logs api | grep "SETUP TOKEN"</span>
        </>
      }
    >
      <form
        className={`auth-form${shake ? ' shake' : ''}`}
        key={shake}
        onSubmit={(e) => {
          e.preventDefault();
          if (f.password !== f.password2) return setLocalErr('两次输入的密码不一致');
          setLocalErr('');
          void submit({ token: f.token.trim(), username: f.username, nickname: f.nickname, password: f.password });
        }}
      >
        <Field icon={KeyRound} placeholder="初始化令牌" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoFocus required />
        <Field icon={User} placeholder="管理员用户名" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
        <Field icon={UserPlus} placeholder="昵称（可选）" value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} />
        <Field icon={Lock} type="password" placeholder="密码（至少 8 位）" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        <Field icon={Lock} type="password" placeholder="确认密码" autoComplete="new-password" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} required />
        {(localErr || err) && <div className="field-error">{localErr || err}</div>}
        <button className="btn btn-filled btn-lg btn-block" disabled={busy}>
          <ShieldCheck /> 创建管理员
        </button>
      </form>
    </AuthCard>
  );
}
