import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type User = { user_id: string; role: 'viewer' | 'operator' };
const SessionContext = createContext<{ user: User; logout: () => void } | null>(null);
export function useSession() { return useContext(SessionContext)!; }
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
  return response;
}
export function SessionGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const expired = () => { setUser(null); setError('세션이 종료되었습니다. 다시 로그인하세요.'); };
    const check = async () => {
      try {
        const response = await fetch('/api/session');
        const data = response.ok ? await response.json() as User : null;
        if (active) { setUser(data); setReady(true); }
      } catch { if (active) { setError('서버에 연결할 수 없습니다. 실행 상태를 확인하세요.'); setReady(true); } }
    };
    void check();
    const interval = setInterval(() => void check(), 30000);
    window.addEventListener('session-expired', expired);
    return () => { active = false; clearInterval(interval); window.removeEventListener('session-expired', expired); };
  }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, access_key: key }) });
      setKey('');
      if (!response.ok) throw new Error(response.status === 429 ? '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' : response.status === 401 ? '사용자 ID 또는 접근 키가 올바르지 않습니다.' : `로그인 실패 (HTTP ${response.status})`);
      setUser(await response.json());
    } catch (error) { setError(String(error)); } finally { setKey(''); setBusy(false); }
  }
  async function logout() {
    try { const response = await apiFetch('/api/session', { method: 'DELETE' }); if (!response.ok && response.status !== 401) throw new Error('로그아웃 실패'); setError(''); setUser(null); }
    catch { setError('로그아웃에 실패했습니다. 연결을 확인하고 다시 시도하세요.'); }
  }
  if (!ready) return <main className="login-page"><p role="status">로그인 상태 확인 중…</p></main>;
  if (user) return <SessionContext.Provider value={{ user, logout }}>{error && <p role="alert">{error}</p>}{children}</SessionContext.Provider>;
  return <main className="login-page"><a className="brand" href="/">BoilerOps Agent</a><form className="panel login-form" onSubmit={login} aria-labelledby="login-title"><span className="eyebrow">OPERATIONS WORKSPACE</span><h1 id="login-title">운영 화면 로그인</h1><p>발급받은 개인 접근 키로 로그인하세요. 조회와 승인 권한은 계정별로 적용됩니다.</p><label htmlFor="login-user">사용자 ID</label><input id="login-user" autoComplete="username" required maxLength={40} value={userId} onChange={event => setUserId(event.target.value)} /><label htmlFor="login-key">개인 접근 키</label><input id="login-key" type="password" autoComplete="current-password" required minLength={32} maxLength={200} value={key} onChange={event => setKey(event.target.value)} /><button className="primary-button" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>{error && <p role="alert">{error}</p>}<p className="note">계정 발급과 실행 순서는 프로젝트 README를 참고하세요.</p></form></main>;
}
