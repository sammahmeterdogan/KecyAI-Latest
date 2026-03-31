import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ExternalLink, FolderOpen, Loader2, Play, Square } from 'lucide-react';
import {
  readCachedDesktopServiceSnapshot,
  syncDesktopServiceSnapshot,
  writeDesktopServiceSnapshot,
} from '../../lib/desktopService';

function getTauriInvoke() {
  const internals = window.__TAURI_INTERNALS__;
  if (internals && typeof internals.invoke === 'function') {
    return internals.invoke;
  }
  return null;
}

const CARD = {
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 24,
  background: 'linear-gradient(180deg, rgba(12,16,24,0.96) 0%, rgba(7,10,15,0.98) 100%)',
  boxShadow: '0 24px 60px rgba(0,0,0,0.32)',
};

const BUTTON = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  minWidth: 170,
  borderRadius: 16,
  padding: '14px 18px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)',
  color: '#f5f7fb',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
};

export default function DesktopLauncher() {
  const [status, setStatus] = useState(readCachedDesktopServiceSnapshot);
  const [busy, setBusy] = useState(false);
  const [pendingState, setPendingState] = useState(null);
  const invoke = useMemo(() => getTauriInvoke(), []);

  const refresh = useCallback(async () => {
    if (!invoke) return;
    try {
      const next = await syncDesktopServiceSnapshot();
      setStatus(next);
    } catch (error) {
      const message = String(error);
      const next = writeDesktopServiceSnapshot({
        ...status,
        state: 'ERROR',
        healthy: false,
        message,
        updatedAt: Date.now(),
      });
      setStatus(next);
    }
  }, [invoke, status]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runAction = useCallback(async (command) => {
    if (!invoke) return;
    setBusy(true);
    const nextPendingState = command === 'start' ? 'STARTING' : command === 'stop' ? 'STOPPING' : null;
    setPendingState(nextPendingState);
    if (nextPendingState) {
      const next = writeDesktopServiceSnapshot({
        ...status,
        state: nextPendingState,
        healthy: false,
        message: nextPendingState === 'STARTING'
          ? 'KECYAI local service is starting.'
          : 'KECYAI local service is stopping.',
        updatedAt: Date.now(),
      });
      setStatus(next);
    }
    try {
      if (command === 'start') {
        await invoke('start_local_service');
        const next = await syncDesktopServiceSnapshot();
        setStatus(next);
      } else if (command === 'stop') {
        await invoke('stop_local_service');
        const next = await syncDesktopServiceSnapshot();
        setStatus(next);
      } else if (command === 'open') {
        await invoke('open_dashboard');
      } else if (command === 'logs') {
        await invoke('open_logs');
      }
    } catch (error) {
      const message = String(error);
      const next = writeDesktopServiceSnapshot({
        ...status,
        state: 'ERROR',
        healthy: false,
        message,
        updatedAt: Date.now(),
      });
      setStatus(next);
    } finally {
      setBusy(false);
      setPendingState(null);
      if (command !== 'open' && command !== 'logs') {
        refresh();
      }
    }
  }, [invoke, refresh, status]);

  if (!invoke) {
    return (
      <div style={{ minHeight: '100vh', background: '#070b12', color: '#f4f6fb', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ ...CARD, maxWidth: 760, width: '100%', padding: 36 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>KECYAI Launcher</h1>
          <p style={{ marginTop: 12, color: 'rgba(255,255,255,0.68)', lineHeight: 1.6 }}>
            KECYAI masaüstü uygulamasından açın.
          </p>
        </div>
      </div>
    );
  }

  const effectiveState = pendingState || status.state;
  const stateTone =
    effectiveState === 'READY' || effectiveState === 'WORKING'
      ? '#34d399'
      : effectiveState === 'STARTING' || effectiveState === 'STOPPING'
        ? '#f59e0b'
        : effectiveState === 'ERROR'
          ? '#f87171'
          : '#94a3b8';
  const canStart = !busy && (effectiveState === 'STOPPED' || effectiveState === 'ERROR');
  const canStop = !busy && ['STARTING', 'READY', 'WORKING', 'ERROR'].includes(effectiveState) && Boolean(status.serviceUrl);
  const canOpen = !busy && ['READY', 'WORKING'].includes(effectiveState) && Boolean(status.serviceUrl);

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '32px 28px',
        background:
          'radial-gradient(circle at top left, rgba(31,110,235,0.18), transparent 34%), radial-gradient(circle at bottom right, rgba(8,145,178,0.14), transparent 32%), #070b12',
        color: '#f4f6fb',
      }}
    >
      <div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gap: 24 }}>
        <section style={{ ...CARD, padding: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.48)' }}>
                KECYAI Desktop
              </div>
              <h1 style={{ margin: '10px 0 8px', fontSize: 34, lineHeight: 1.1 }}>KECYAI Service</h1>
            </div>
            <div
              style={{
                minWidth: 220,
                borderRadius: 18,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                padding: 18,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: stateTone, fontWeight: 700 }}>
                {busy ? <Loader2 size={18} className="spin" /> : <Activity size={18} />}
                {effectiveState}
              </div>
              <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,0.62)', lineHeight: 1.5 }}>
                {status.message}
              </div>
              <div style={{ marginTop: 12, fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                {status.serviceUrl || 'http://127.0.0.1:8040'}
              </div>
            </div>
          </div>
        </section>

        <section style={{ ...CARD, padding: 28 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <button style={{ ...BUTTON, background: 'linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)' }} disabled={!canStart} onClick={() => runAction('start')}>
              {busy ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
              Start Service
            </button>
            <button style={BUTTON} disabled={!canOpen} onClick={() => runAction('open')}>
              <ExternalLink size={16} />
              Open In Browser
            </button>
            <button style={BUTTON} disabled={!canStop} onClick={() => runAction('stop')}>
              <Square size={16} />
              Stop Service
            </button>
            <button style={BUTTON} disabled={busy} onClick={() => runAction('logs')}>
              <FolderOpen size={16} />
              Open Logs
            </button>
          </div>
        </section>

        <section style={{ ...CARD, padding: 28 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'rgba(255,255,255,0.48)' }}>
              Logs
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.54)' }}>
              {status.logsPath || 'C:\\Users\\ASUS\\.kecyai\\logs'}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
