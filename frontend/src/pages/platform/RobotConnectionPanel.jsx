import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Usb, RefreshCw, Loader2, CheckCircle2, XCircle, AlertCircle, Plug, Radio } from 'lucide-react';
import { getBackendBaseUrl, getRuntimeBaseUrl } from '../../lib/api/lerobotClient';

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
// localStorage keys
// ---------------------------------------------------------------------------

const SAVED_PORT_KEY = 'kecyai_robot_port';

function getLocalPort() {
  try { return localStorage.getItem(SAVED_PORT_KEY) || ''; } catch { return ''; }
}
function setLocalPort(port) {
  try { localStorage.setItem(SAVED_PORT_KEY, port); } catch {}
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function RobotConnectionPanel({ onConnectionChange }) {
  const [ports, setPorts] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [selectedPort, setSelectedPort] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { success, message, port }
  const [savedPort, setSavedPort] = useState('');
  const onConnectionChangeRef = useRef(onConnectionChange);

  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange;
  }, [onConnectionChange]);

  const emitConnectionChange = useCallback((connected, port) => {
    onConnectionChangeRef.current?.(connected, port);
  }, []);

  // Load saved port on mount
  useEffect(() => {
    const loadSaved = async () => {
      const invoke = getTauriInvoke();
      if (invoke) {
        try {
          const port = await invoke('get_saved_robot_port');
          if (port) {
            setSavedPort(port);
            setSelectedPort(port);
            emitConnectionChange(true, port);
          }
        } catch {
          // Fallback to localStorage
          const local = getLocalPort();
          if (local) { setSavedPort(local); setSelectedPort(local); emitConnectionChange(true, local); }
        }
      } else {
        const local = getLocalPort();
        if (local) { setSavedPort(local); setSelectedPort(local); emitConnectionChange(true, local); }
      }
    };
    loadSaved();
  }, [emitConnectionChange]);

  // Auto-scan on mount
  useEffect(() => {
    handleScan();
  }, []);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setPorts([]);
    setTestResult(null);

    const invoke = getTauriInvoke();
    if (invoke) {
      try {
        const result = await invoke('scan_serial_ports');
        setPorts(result.ports || []);
        // Auto-select: prefer saved port if present, else first port
        const portNames = (result.ports || []).map(p => p.port);
        if (savedPort && portNames.includes(savedPort)) {
          setSelectedPort(savedPort);
        } else if (portNames.length === 1) {
          setSelectedPort(portNames[0]);
        }
      } catch (e) {
        console.error('Scan failed:', e);
      }
    } else {
      // Browser mode: try runtime API
      try {
        const resp = await fetch(`${getRuntimeBaseUrl()}/api/lerobot/admin/ports/scan`, { signal: AbortSignal.timeout(5000) });
        const data = await resp.json();
        const portList = (data.ports || []).map(p => ({
          port: p,
          description: p,
          vid_pid: '',
        }));
        setPorts(portList);
        if (portList.length === 1) setSelectedPort(portList[0].port);
      } catch {
        // No runtime available
      }
    }
    setScanning(false);
  }, [savedPort]);

  const handleTest = useCallback(async () => {
    if (!selectedPort) return;
    setTesting(true);
    setTestResult(null);

    const invoke = getTauriInvoke();
    if (invoke) {
      try {
        let result;
        try {
          result = await invoke('test_robot_connection_safe', { port: selectedPort });
        } catch {
          result = await invoke('test_robot_connection', { port: selectedPort });
        }
        setTestResult(result);
        if (result.success) {
          // Save the port
          try { await invoke('save_robot_port', { port: selectedPort }); } catch {}
          setLocalPort(selectedPort);
          setSavedPort(selectedPort);
          emitConnectionChange(true, selectedPort);
        } else {
          emitConnectionChange(false, selectedPort);
        }
      } catch (e) {
        setTestResult({ success: false, message: String(e), port: selectedPort });
        emitConnectionChange(false, selectedPort);
      }
    } else {
      // Browser mode: save to runtime config
      try {
        await fetch(`${getBackendBaseUrl()}/api/lerobot/admin/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial_port: selectedPort }),
          signal: AbortSignal.timeout(5000),
        });
        setTestResult({ success: true, message: `Port ${selectedPort} saved`, port: selectedPort });
        setLocalPort(selectedPort);
        setSavedPort(selectedPort);
        emitConnectionChange(true, selectedPort);
      } catch (e) {
        setTestResult({ success: false, message: `Config save failed: ${e}`, port: selectedPort });
      }
    }
    setTesting(false);
  }, [selectedPort, emitConnectionChange]);

  return (
    <div style={{
      background: '#111827',
      border: '1px solid #1f2937',
      borderRadius: 10,
      padding: '16px 20px',
      marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Usb size={16} style={{ color: '#9ca3af' }} />
          <span style={{ color: '#9ca3af', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            Robot Bağlantısı
          </span>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          style={{
            background: 'none',
            border: '1px solid #374151',
            borderRadius: 6,
            padding: '4px 10px',
            cursor: scanning ? 'not-allowed' : 'pointer',
            color: '#9ca3af',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
          }}
        >
          {scanning ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
          Tara
        </button>
      </div>

      {/* Port List */}
      {scanning && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13, padding: '8px 0' }}>
          <Loader2 size={14} className="spin" />
          Portlar taranıyor...
        </div>
      )}

      {!scanning && ports.length === 0 && (
        <div style={{ color: '#6b7280', fontSize: 13, padding: '8px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={14} style={{ color: '#f59e0b' }} />
          USB seri cihaz algılanmadı. Robotu bağlayıp "Tara" butonuna tıklayın.
        </div>
      )}

      {!scanning && ports.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {ports.map((p) => {
            const isSelected = selectedPort === p.port;
            const isSaved = savedPort === p.port;
            return (
              <div
                key={p.port}
                onClick={() => setSelectedPort(p.port)}
                style={{
                  background: isSelected ? '#1e293b' : '#0d1117',
                  border: `1px solid ${isSelected ? '#3b82f6' : '#1f2937'}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  transition: 'border-color 0.15s',
                }}
              >
                <Radio size={14} style={{ color: isSelected ? '#3b82f6' : '#4b5563', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{p.port}</span>
                    {isSaved && (
                      <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 500, background: '#052e16', padding: '1px 6px', borderRadius: 4 }}>
                        Kayıtlı
                      </span>
                    )}
                    {p.vid_pid && (
                      <span style={{ color: '#6b7280', fontSize: 11 }}>[{p.vid_pid}]</span>
                    )}
                  </div>
                  <div style={{ color: '#6b7280', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Connect button */}
      {!scanning && ports.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={handleTest}
            disabled={!selectedPort || testing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 18px',
              background: !selectedPort || testing ? '#374151' : '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: !selectedPort || testing ? 'not-allowed' : 'pointer',
              opacity: !selectedPort || testing ? 0.5 : 1,
            }}
          >
            {testing ? <Loader2 size={14} className="spin" /> : <Plug size={14} />}
            {testing ? 'Test Ediliyor...' : 'Bağlantıyı Test Et'}
          </button>
        </div>
      )}

      {/* Test Result */}
      {testResult && (
        <div style={{
          marginTop: 10,
          padding: '10px 14px',
          borderRadius: 8,
          background: testResult.success ? '#052e16' : '#1c1017',
          border: `1px solid ${testResult.success ? '#166534' : '#991b1b'}`,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}>
          {testResult.success
            ? <CheckCircle2 size={16} style={{ color: '#22c55e', flexShrink: 0, marginTop: 1 }} />
            : <XCircle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
          }
          <div style={{ fontSize: 12, color: testResult.success ? '#86efac' : '#fca5a5', lineHeight: 1.5 }}>
            {testResult.message}
          </div>
        </div>
      )}
    </div>
  );
}
