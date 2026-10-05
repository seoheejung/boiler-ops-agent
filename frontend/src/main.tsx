import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SessionGate } from './session';
import './styles.css';
import './accessibility.css';
import { NotFound } from './NotFound';

const isHome = location.pathname === '/' || location.pathname === '/index.html';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{isHome ? <SessionGate><App /></SessionGate> : <NotFound />}</React.StrictMode>);
