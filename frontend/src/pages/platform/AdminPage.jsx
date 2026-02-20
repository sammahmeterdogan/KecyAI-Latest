import { useState, useEffect, useCallback } from 'react';
import { lerobotClient } from '../../lib/api/lerobotClient';

/* ── inline styles ── */
const S = {
    page: { maxWidth: 960, margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif', color: '#e0e0e0' },
    h1: { fontSize: 22, fontWeight: 700, marginBottom: 24, color: '#f5f5f5', letterSpacing: '0.02em' },
    h2: { fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#ccc', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 },
    section: {
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12, padding: '20px 24px', marginBottom: 20,
    },
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
    label: { fontSize: 12, fontWeight: 500, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 },
    value: { fontSize: 14, color: '#e0e0e0', fontFamily: 'monospace' },
    input: {
        width: '100%', padding: '8px 12px', borderRadius: 8,
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
        color: '#e0e0e0', fontSize: 13, fontFamily: 'monospace', outline: 'none',
    },
    select: {
        width: '100%', padding: '8px 12px', borderRadius: 8,
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
        color: '#e0e0e0', fontSize: 13, outline: 'none',
    },
    btn: {
        padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
        fontWeight: 600, fontSize: 13, transition: 'all 0.15s ease',
    },
    btnPrimary: { background: '#3b82f6', color: '#fff' },
    btnSecondary: { background: 'rgba(255,255,255,0.08)', color: '#ccc' },
    chip: (status) => ({
        display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
        background: status === 'ok' ? 'rgba(52,211,153,0.15)' : status === 'failed' ? 'rgba(239,68,68,0.15)' :
            status === 'warning' ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.06)',
        color: status === 'ok' ? '#34d399' : status === 'failed' ? '#ef4444' :
            status === 'warning' ? '#fbbf24' : '#888',
    }),
    banner: (type) => ({
        padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13,
        background: type === 'error' ? 'rgba(239,68,68,0.1)' : type === 'success' ? 'rgba(52,211,153,0.1)' : 'rgba(59,130,246,0.1)',
        border: `1px solid ${type === 'error' ? 'rgba(239,68,68,0.3)' : type === 'success' ? 'rgba(52,211,153,0.3)' : 'rgba(59,130,246,0.3)'}`,
        color: type === 'error' ? '#fca5a5' : type === 'success' ? '#6ee7b7' : '#93c5fd',
    }),
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#888', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' },
    td: { padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', color: '#ccc' },
};

export default function AdminPage() {
    // ── state ──
    const [config, setConfig] = useState(null);
    const [preflight, setPreflight] = useState(null);
    const [artifacts, setArtifacts] = useState([]);
    const [form, setForm] = useState({ serial_port: '', robot_type: 'so101_follower', driver: 'feetech' });
    const [banner, setBanner] = useState(null);
    const [loading, setLoading] = useState({});

    const showBanner = (type, msg) => {
        setBanner({ type, msg });
        if (type !== 'error') setTimeout(() => setBanner(null), 4000);
    };

    // ── load data ──
    const loadConfig = useCallback(async () => {
        try {
            const c = await lerobotClient.adminGetConfig();
            setConfig(c);
            setForm({ serial_port: c.serial_port || '', robot_type: c.robot_type || 'so101_follower', driver: c.driver || 'feetech' });
        } catch (e) { showBanner('error', `Config load failed: ${e.message}`); }
    }, []);

    const loadPreflight = useCallback(async () => {
        setLoading(l => ({ ...l, preflight: true }));
        try {
            const p = await lerobotClient.adminPreflight();
            setPreflight(p);
        } catch (e) { showBanner('error', `Preflight failed: ${e.message}`); }
        finally { setLoading(l => ({ ...l, preflight: false })); }
    }, []);

    const loadArtifacts = useCallback(async () => {
        try {
            const res = await lerobotClient.adminCalibrationList();
            setArtifacts(res.artifacts || []);
        } catch (e) { showBanner('error', `Artifacts load failed: ${e.message}`); }
    }, []);

    useEffect(() => { loadConfig(); loadPreflight(); loadArtifacts(); }, []);

    // ── actions ──
    const saveConfig = async () => {
        setLoading(l => ({ ...l, config: true }));
        try {
            const updated = await lerobotClient.adminSetConfig(form);
            setConfig(updated);
            showBanner('success', 'Config updated');
            loadPreflight(); // re-run preflight with new config
        } catch (e) {
            const body = e.body;
            showBanner('error', body?.message || e.message);
        } finally { setLoading(l => ({ ...l, config: false })); }
    };

    const selectArtifact = async (id) => {
        try {
            await lerobotClient.adminCalibrationSelect(id);
            showBanner('success', `Selected: ${id}`);
        } catch (e) { showBanner('error', e.body?.message || e.message); }
    };

    return (
        <div style={S.page}>
            <h1 style={S.h1}>⚙ Hardware Admin</h1>

            {banner && (
                <div style={S.banner(banner.type)}>
                    {banner.msg}
                    {banner.type === 'error' && (
                        <span style={{ float: 'right', cursor: 'pointer', fontWeight: 700 }}
                            onClick={() => setBanner(null)}>✕</span>
                    )}
                </div>
            )}

            {/* ── CONFIG ── */}
            <div style={S.section}>
                <h2 style={S.h2}>Hardware Configuration</h2>
                {config && (
                    <div style={{ marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <div><span style={S.label}>Mode</span>
                            <div style={{ ...S.value, color: config.mode === 'hardware' ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
                                {config.mode?.toUpperCase()}
                            </div>
                        </div>
                        <div><span style={S.label}>Dry Run</span>
                            <div style={S.value}>{String(config.dry_run)}</div>
                        </div>
                    </div>
                )}
                <div style={S.grid2}>
                    <div>
                        <div style={S.label}>Serial Port</div>
                        <input style={S.input} placeholder="/dev/ttyUSB0"
                            value={form.serial_port}
                            onChange={e => setForm(f => ({ ...f, serial_port: e.target.value }))} />
                    </div>
                    <div>
                        <div style={S.label}>Robot Type</div>
                        <select style={S.select} value={form.robot_type}
                            onChange={e => setForm(f => ({ ...f, robot_type: e.target.value }))}>
                            <option value="so101_follower">so101_follower</option>
                            <option value="so101_leader">so101_leader</option>
                            <option value="koch">koch</option>
                            <option value="koch_bimanual">koch_bimanual</option>
                        </select>
                    </div>
                    <div>
                        <div style={S.label}>Driver</div>
                        <select style={S.select} value={form.driver}
                            onChange={e => setForm(f => ({ ...f, driver: e.target.value }))}>
                            <option value="feetech">feetech</option>
                            <option value="dynamixel">dynamixel</option>
                        </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={saveConfig}
                            disabled={loading.config}>
                            {loading.config ? 'Saving…' : 'Save Config'}
                        </button>
                    </div>
                </div>
            </div>

            {/* ── PREFLIGHT ── */}
            <div style={S.section}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ ...S.h2, marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>Preflight Checks</h2>
                    <button style={{ ...S.btn, ...S.btnSecondary }} onClick={loadPreflight}
                        disabled={loading.preflight}>
                        {loading.preflight ? 'Running…' : 'Re-run'}
                    </button>
                </div>
                {preflight && (
                    <>
                        <div style={{
                            margin: '12px 0', fontSize: 14, fontWeight: 600,
                            color: preflight.ready ? '#34d399' : '#fbbf24'
                        }}>
                            {preflight.ready ? '✓ READY' : '⚠ NOT READY'} — {preflight.mode?.toUpperCase()}
                        </div>
                        <table style={S.table}>
                            <thead>
                                <tr>
                                    <th style={S.th}>Check</th>
                                    <th style={S.th}>Status</th>
                                    <th style={S.th}>Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preflight.checks?.map((c, i) => (
                                    <tr key={i}>
                                        <td style={S.td}><code>{c.id}</code></td>
                                        <td style={S.td}><span style={S.chip(c.status)}>{c.status}</span></td>
                                        <td style={S.td}>{c.details}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {preflight.hints?.length > 0 && (
                            <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>
                                <strong>Hints:</strong>
                                <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                                    {preflight.hints.map((h, i) => <li key={i}>{h}</li>)}
                                </ul>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ── CALIBRATION ARTIFACTS ── */}
            <div style={S.section}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ ...S.h2, marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>Calibration Artifacts</h2>
                    <button style={{ ...S.btn, ...S.btnSecondary }} onClick={loadArtifacts}>Refresh</button>
                </div>
                {artifacts.length === 0 ? (
                    <p style={{ color: '#666', fontSize: 13, marginTop: 12 }}>
                        No calibration artifacts found. Run calibration first.
                    </p>
                ) : (
                    <table style={{ ...S.table, marginTop: 12 }}>
                        <thead>
                            <tr>
                                <th style={S.th}>ID</th>
                                <th style={S.th}>Robot</th>
                                <th style={S.th}>Joints</th>
                                <th style={S.th}>Mode</th>
                                <th style={S.th}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {artifacts.map(a => (
                                <tr key={a.id}>
                                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{a.id}</td>
                                    <td style={S.td}>{a.robot_type}</td>
                                    <td style={S.td}>{a.joint_count}</td>
                                    <td style={S.td}>
                                        <span style={S.chip(a.dry_run ? 'warning' : 'ok')}>
                                            {a.dry_run ? 'dry-run' : 'hardware'}
                                        </span>
                                    </td>
                                    <td style={S.td}>
                                        <button style={{ ...S.btn, ...S.btnPrimary, padding: '4px 14px', fontSize: 11 }}
                                            onClick={() => selectArtifact(a.id)}>
                                            Select
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
