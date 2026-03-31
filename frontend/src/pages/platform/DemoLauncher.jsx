import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LeRobotClient, getBackendBaseUrl } from '../../lib/api/lerobotClient';
import { Activity, Cpu, Usb, ArrowRight, RefreshCw, Settings } from 'lucide-react';

const CHECK_INTERVAL = 5000;

const STATUS_ICON = {
  ok: { color: '#22c55e', label: 'Online' },
  error: { color: '#ef4444', label: 'Offline' },
  checking: { color: '#eab308', label: 'Checking...' },
};

function StatusDot({ status }) {
  const s = STATUS_ICON[status] || STATUS_ICON.error;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 10, height: 10, borderRadius: '50%', background: s.color,
        boxShadow: status === 'ok' ? `0 0 8px ${s.color}` : 'none',
      }} />
      <span style={{ fontSize: '0.8rem', color: s.color, fontWeight: 600 }}>{s.label}</span>
    </div>
  );
}

export default function DemoLauncher() {
  const navigate = useNavigate();
  const [serviceStatus, setServiceStatus] = useState('checking');
  const [runtimeStatus, setRuntimeStatus] = useState('checking');
  const [robotInfo, setRobotInfo] = useState(null);
  const [hwConfig, setHwConfig] = useState(null);
  const [ports, setPorts] = useState([]);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);

  const runChecks = useCallback(async () => {
    setChecking(true);
    setError(null);

    // Service health
    try {
      const ok = await LeRobotClient.ping();
      setServiceStatus(ok ? 'ok' : 'error');
    } catch {
      setServiceStatus('error');
    }

    // Runtime health
    try {
      const health = await LeRobotClient.getReadiness();
      setRuntimeStatus(health?.status === 'ok' ? 'ok' : 'error');
    } catch {
      setRuntimeStatus('error');
    }

    // Hardware config
    try {
      const config = await LeRobotClient.adminGetConfig();
      setHwConfig(config);
    } catch {
      setHwConfig(null);
    }

    // Port scan
    try {
      const scan = await LeRobotClient.adminScanMotorPorts();
      setPorts(scan.ports || []);
      setRobotInfo(scan);
    } catch {
      setPorts([]);
      setRobotInfo(null);
    }

    setChecking(false);
  }, []);

  useEffect(() => {
    runChecks();
    const interval = setInterval(runChecks, CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [runChecks]);

  const allReady = serviceStatus === 'ok' && runtimeStatus === 'ok';
  const mode = hwConfig?.mode || (hwConfig?.dry_run ? 'dry_run' : 'unknown');
  const activeServiceUrl = getBackendBaseUrl();

  const cardStyle = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: '1.25rem',
    flex: 1,
    minWidth: 200,
  };

  const labelStyle = { color: '#9ca3af', fontSize: '0.75rem', marginBottom: 4, display: 'block' };
  const valueStyle = { color: '#e5e7eb', fontSize: '0.9rem', fontWeight: 600 };

  return (
    <div style={{ padding: '2rem', color: '#e5e7eb', maxWidth: 900 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Activity size={22} /> Demo Launcher
      </h1>
      <p style={{ color: '#9ca3af', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
        System status overview. Connect your SO-101 and start teleoperating.
      </p>

      {error && (
        <div style={{ background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {/* Status Cards */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {/* Service */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
            <Cpu size={16} color="#60a5fa" />
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Service</span>
            <div style={{ marginLeft: 'auto' }}><StatusDot status={serviceStatus} /></div>
          </div>
          <span style={labelStyle}>Python Runtime API</span>
          <span style={valueStyle}>{serviceStatus === 'ok' ? activeServiceUrl : 'Not reachable'}</span>
        </div>

        {/* Runtime */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
            <Activity size={16} color="#a78bfa" />
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Runtime</span>
            <div style={{ marginLeft: 'auto' }}><StatusDot status={runtimeStatus} /></div>
          </div>
          <span style={labelStyle}>Python LeRobot Runtime</span>
          <span style={valueStyle}>{runtimeStatus === 'ok' ? activeServiceUrl : 'Not reachable'}</span>
        </div>

        {/* Robot */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
            <Usb size={16} color="#34d399" />
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Robot</span>
            <div style={{ marginLeft: 'auto' }}>
              <StatusDot status={ports.length > 0 ? 'ok' : 'error'} />
            </div>
          </div>
          {ports.length > 0 ? (
            <>
              <span style={labelStyle}>Detected Port(s)</span>
              <span style={{ ...valueStyle, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                {ports.join(', ')}
              </span>
            </>
          ) : (
            <>
              <span style={labelStyle}>No USB devices detected</span>
              <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>
                Connect the SO-101 via USB and press Refresh.
              </span>
            </>
          )}
        </div>
      </div>

      {/* Config Info */}
      {hwConfig && (
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <div>
              <span style={labelStyle}>Robot Type</span>
              <span style={valueStyle}>{hwConfig.robot_type || 'N/A'}</span>
            </div>
            <div>
              <span style={labelStyle}>Serial Port</span>
              <span style={{ ...valueStyle, fontFamily: 'monospace' }}>{hwConfig.serial_port || 'Not set'}</span>
            </div>
            <div>
              <span style={labelStyle}>Driver</span>
              <span style={valueStyle}>{hwConfig.driver || 'N/A'}</span>
            </div>
            <div>
              <span style={labelStyle}>Mode</span>
              <span style={{
                padding: '2px 10px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                background: mode === 'hardware' ? '#064e3b' : '#1e3a5f',
                color: mode === 'hardware' ? '#34d399' : '#60a5fa',
              }}>
                {mode === 'hardware' ? 'HARDWARE' : 'DRY-RUN'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Hints */}
      {!allReady && (
        <div style={{
          background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.3)',
          borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#eab308',
        }}>
          {serviceStatus !== 'ok' && <div>Python runtime service is not reachable. Start the service with <code>docker compose up</code> or <code>scripts/start.ps1 -Target services</code>.</div>}
          {serviceStatus === 'ok' && runtimeStatus !== 'ok' && <div>Robotics runtime is not ready inside the Python service at {activeServiceUrl}.</div>}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button
          onClick={() => navigate('/kecy/platform/teleop')}
          disabled={!allReady}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0.75rem 2rem', borderRadius: 8, border: 'none',
            background: allReady ? '#2563eb' : '#374151',
            color: allReady ? '#fff' : '#6b7280',
            fontWeight: 700, fontSize: '1rem',
            cursor: allReady ? 'pointer' : 'not-allowed',
            opacity: allReady ? 1 : 0.6,
            transition: 'background 0.2s',
          }}
        >
          Enter Teleop <ArrowRight size={18} />
        </button>

        <button
          onClick={runChecks}
          disabled={checking}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0.75rem 1.25rem', borderRadius: 8,
            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            color: '#9ca3af', cursor: checking ? 'wait' : 'pointer', fontSize: '0.85rem',
          }}
        >
          <RefreshCw size={14} style={{ animation: checking ? 'spin 1s linear infinite' : 'none' }} /> Refresh
        </button>

        <button
          onClick={() => navigate('/kecy/platform/admin')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0.75rem 1.25rem', borderRadius: 8,
            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            color: '#9ca3af', cursor: 'pointer', fontSize: '0.85rem',
          }}
        >
          <Settings size={14} /> Configure Hardware
        </button>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
