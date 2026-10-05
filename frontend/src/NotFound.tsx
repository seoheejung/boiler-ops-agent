import { useEffect } from 'react';

export function NotFound() {
  useEffect(() => { document.title = '페이지를 찾을 수 없습니다 · BoilerOps Agent'; }, []);
  return <div className="app-shell not-found"><a className="skip-link" href="#main">본문으로 건너뛰기</a><header><a className="brand" href="/">BoilerOps Agent</a></header><main id="main" tabIndex={-1}><p className="eyebrow">404 · PAGE NOT FOUND</p><h1>페이지를 찾을 수 없습니다</h1><p>주소를 확인하거나 운전 현황으로 돌아가세요.</p><a className="primary-button" href="/">운전 현황으로 이동</a></main><footer>© {new Date().getFullYear()} BoilerOps Agent</footer></div>;
}
