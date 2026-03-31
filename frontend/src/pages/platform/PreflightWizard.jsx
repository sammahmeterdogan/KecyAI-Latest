import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertCircle, XCircle, RefreshCw, Loader2, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';

// ---------------------------------------------------------------------------
// Tauri IPC
// ---------------------------------------------------------------------------

function getTauriInvoke() {
  const internals = window.__TAURI_INTERNALS__;
  if (internals && typeof internals.invoke === 'function') {
    return internals.invoke;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  green: { color: '#22c55e', icon: CheckCircle2, label: 'Hazır' },
  amber: { color: '#f59e0b', icon: AlertCircle, label: 'Uyarı' },
  red:   { color: '#ef4444', icon: XCircle, label: 'Eksik' },
};

// ---------------------------------------------------------------------------
// Local storage key for "last passed" timestamp
// ---------------------------------------------------------------------------

const PREFLIGHT_PASSED_KEY = 'kecyai_preflight_passed';

function getLastPassed() {
  try {
    const ts = localStorage.getItem(PREFLIGHT_PASSED_KEY);
    return ts ? parseInt(ts, 10) : null;
  } catch { return null; }
}

function setLastPassed() {
  try { localStorage.setItem(PREFLIGHT_PASSED_KEY, Date.now().toString()); } catch {}
}

function clearLastPassed() {
  try { localStorage.removeItem(PREFLIGHT_PASSED_KEY); } catch {}
}

// ---------------------------------------------------------------------------
// Exported: should we show the wizard on launch?
// ---------------------------------------------------------------------------

export function shouldShowPreflight() {
  const last = getLastPassed();
  if (!last) return true;
  // Re-check if more than 7 days old
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  return (Date.now() - last) > SEVEN_DAYS;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function PreflightWizard({ onComplete, onSkip }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(true);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError('');
    setReport(null);

    const invoke = getTauriInvoke();
    if (!invoke) {
      // Not in Tauri — simulate a passing report for browser dev
      setReport({
        items: [
          { name: 'Java', status: 'green', version: 'dev mode', message: 'Tauri dışı — kontrol atlandı', download_url: '' },
          { name: 'Python', status: 'green', version: 'dev mode', message: 'Tauri dışı — kontrol atlandı', download_url: '' },
        ],
        all_green: true,
        can_start: true,
      });
      setLoading(false);
      return;
    }

    try {
      const result = await invoke('check_dependencies');
      setReport(result);
      if (result.all_green) {
        setLastPassed();
      } else {
        clearLastPassed();
      }
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const handleContinue = () => {
    if (report?.can_start) {
      onComplete?.();
    }
  };

  const redCount = report?.items?.filter(i => i.status === 'red').length || 0;
  const amberCount = report?.items?.filter(i => i.status === 'amber').length || 0;

  return (
    <div style={{ padding: '32px 24px', maxWidth: 640, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>
          Sistem Gereksinimleri
        </h2>
        <p style={{ fontSize: 13, color: '#9ca3af', margin: '4px 0 0' }}>
          KECY AI'nin çalışması için gereken bağımlılıklar kontrol ediliyor.
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '32px 0', color: '#9ca3af' }}>
          <Loader2 size={20} className="spin" />
          <span style={{ fontSize: 14 }}>Bağımlılıklar kontrol ediliyor...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: '#1c1017', border: '1px solid #ef4444', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>
          <AlertCircle size={14} style={{ display: 'inline', marginRight: 6 }} />
          {error}
        </div>
      )}

      {/* Report */}
      {report && !loading && (
        <>
          {/* Summary bar */}
          <div
            onClick={() => setExpanded(!expanded)}
            style={{
              background: report.all_green ? '#052e16' : report.can_start ? '#1c1a05' : '#1c1017',
              border: `1px solid ${report.all_green ? '#166534' : report.can_start ? '#854d0e' : '#991b1b'}`,
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 12,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {report.all_green ? (
                <CheckCircle2 size={18} style={{ color: '#22c55e' }} />
              ) : report.can_start ? (
                <AlertCircle size={18} style={{ color: '#f59e0b' }} />
              ) : (
                <XCircle size={18} style={{ color: '#ef4444' }} />
              )}
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                {report.all_green
                  ? 'Tüm gereksinimler karşılandı'
                  : report.can_start
                    ? `${amberCount} uyarı — başlatılabilir`
                    : `${redCount} eksik bağımlılık — başlatılamaz`}
              </span>
            </div>
            {expanded ? <ChevronUp size={16} style={{ color: '#6b7280' }} /> : <ChevronDown size={16} style={{ color: '#6b7280' }} />}
          </div>

          {/* Detail list */}
          {expanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
              {report.items.map((item, idx) => {
                const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.red;
                const Icon = cfg.icon;
                return (
                  <div
                    key={idx}
                    style={{
                      background: '#111827',
                      border: '1px solid #1f2937',
                      borderRadius: 8,
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <Icon size={16} style={{ color: cfg.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{item.name}</span>
                        {item.version && (
                          <span style={{ color: '#6b7280', fontSize: 11 }}>{item.version}</span>
                        )}
                      </div>
                      <div style={{ color: '#9ca3af', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.message}
                      </div>
                    </div>
                    {item.download_url && (
                      <a
                        href={item.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: '#3b82f6', flexShrink: 0 }}
                        title="İndir"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={handleContinue}
              disabled={!report.can_start}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 24px',
                background: report.can_start ? '#3b82f6' : '#374151',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: report.can_start ? 'pointer' : 'not-allowed',
                opacity: report.can_start ? 1 : 0.5,
              }}
            >
              Devam Et
            </button>
            <button
              onClick={runCheck}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 16px',
                background: 'transparent',
                color: '#9ca3af',
                border: '1px solid #374151',
                borderRadius: 8,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={14} />
              Tekrar Kontrol Et
            </button>
            {onSkip && report.can_start && (
              <button
                onClick={onSkip}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6b7280',
                  fontSize: 12,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Atla
              </button>
            )}
          </div>
        </>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
