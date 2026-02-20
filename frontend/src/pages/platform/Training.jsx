import { useState, useEffect, useCallback, useRef } from 'react';
import { LeRobotClient } from '../../lib/api/lerobotClient';
import { Play, StopCircle, RefreshCw, Brain, BarChart3, FileCode, Layers, Activity } from 'lucide-react';

const STATE_LABELS = {
    idle: 'HAZIR', training: 'EĞİTİM DEVAM EDİYOR',
    completed: 'TAMAMLANDI', stopped: 'DURDURULDU', failed: 'BAŞARISIZ',
};
const STATE_COLORS = {
    idle: '#6b7280', training: '#eab308', completed: '#22c55e',
    stopped: '#f97316', failed: '#ef4444',
};

export default function Training() {
    const [status, setStatus] = useState({ state: 'idle' });
    const [datasets, setDatasets] = useState([]);
    const [artifacts, setArtifacts] = useState([]);
    const [logs, setLogs] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const logRef = useRef(null);
    const esRef = useRef(null);
    const pollRef = useRef(null);

    // Config
    const [datasetId, setDatasetId] = useState('');
    const [policyType, setPolicyType] = useState('act');
    const [numSteps, setNumSteps] = useState(100);
    const [batchSize, setBatchSize] = useState(8);

    const fetchStatus = useCallback(async () => {
        try {
            const s = await LeRobotClient.trainingStatus();
            setStatus(s);
        } catch { /* ignore */ }
    }, []);

    const fetchDatasets = useCallback(async () => {
        try {
            const r = await LeRobotClient.recordingDatasets();
            const ds = r.datasets || [];
            setDatasets(ds);
            if (!datasetId && ds.length > 0) setDatasetId(ds[0].id);
        } catch { /* ignore */ }
    }, [datasetId]);

    const fetchArtifacts = useCallback(async () => {
        try {
            const r = await LeRobotClient.trainingArtifacts();
            setArtifacts(r.artifacts || []);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        fetchStatus();
        fetchDatasets();
        fetchArtifacts();
    }, [fetchStatus, fetchDatasets, fetchArtifacts]);

    // Poll status when training
    useEffect(() => {
        if (status.state === 'training') {
            pollRef.current = setInterval(fetchStatus, 2000);
        } else {
            if (pollRef.current) clearInterval(pollRef.current);
        }
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [status.state, fetchStatus]);

    // Auto-scroll logs
    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logs]);

    const connectLogStream = useCallback(() => {
        if (esRef.current) esRef.current.close();
        setLogs([]);

        esRef.current = LeRobotClient.connectTrainingLogStream(
            (data) => {
                if (data.logs && data.logs.length > 0) {
                    setLogs(prev => [...prev, ...data.logs]);
                }
                if (data.done) {
                    fetchStatus();
                    fetchArtifacts();
                }
            },
            () => { /* SSE error, will auto-reconnect or close */ }
        );
    }, [fetchStatus, fetchArtifacts]);

    // Cleanup SSE on unmount
    useEffect(() => {
        return () => {
            if (esRef.current) esRef.current.close();
        };
    }, []);

    const handleStart = async () => {
        if (!datasetId) {
            setError({ code: 'VALIDATION_ERROR', message: 'Lütfen bir dataset seçin.' });
            return;
        }
        setError(null);
        setLoading(true);
        setLogs([]);
        try {
            const result = await LeRobotClient.trainingStart({
                dataset_id: datasetId,
                policy_type: policyType,
                num_steps: numSteps,
                batch_size: batchSize,
            });
            setStatus(result);
            // Start log stream
            setTimeout(connectLogStream, 500);
        } catch (e) {
            setError(e.body || { message: e.message });
        } finally {
            setLoading(false);
        }
    };

    const handleStop = async () => {
        setError(null);
        setLoading(true);
        try {
            const result = await LeRobotClient.trainingStop();
            setStatus(result);
            if (esRef.current) esRef.current.close();
            fetchArtifacts();
        } catch (e) {
            setError(e.body || { message: e.message });
        } finally {
            setLoading(false);
        }
    };

    const isTraining = status.state === 'training';
    const progress = status.progress_pct || 0;

    return (
        <div style={{ padding: '2rem', color: '#e5e7eb', maxWidth: 960 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Brain size={22} /> Politika Eğitimi
            </h1>
            <p style={{ color: '#9ca3af', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                İmitasyon öğrenme ile politika eğitimi. Dry-run modunda simüle loss curve ile mock training çalışır.
            </p>

            {/* Error Banner */}
            {error && (
                <div style={{ background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                    <strong>{error.code || 'ERROR'}:</strong> {error.message}
                </div>
            )}

            {/* Status + Progress */}
            <div style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isTraining ? '0.75rem' : 0 }}>
                    <div style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: STATE_COLORS[status.state] || '#6b7280',
                        animation: isTraining ? 'pulse 1.5s infinite' : 'none',
                        boxShadow: isTraining ? '0 0 8px #eab308' : 'none',
                    }} />
                    <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.8rem', letterSpacing: '0.05em' }}>
                        {STATE_LABELS[status.state] || status.state}
                    </span>
                    {(status.state !== 'idle') && (
                        <span style={{ color: '#9ca3af', fontSize: '0.8rem', marginLeft: 'auto' }}>
                            {status.job_id} &nbsp;|&nbsp; Step: {status.current_step}/{status.total_steps}
                            {status.metrics?.loss != null && <> &nbsp;|&nbsp; Loss: {status.metrics.loss.toFixed(6)}</>}
                        </span>
                    )}
                </div>
                {isTraining && (
                    <div style={{ background: '#1f2937', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <div style={{
                            height: '100%', borderRadius: 4,
                            background: 'linear-gradient(90deg, #eab308, #f59e0b)',
                            width: `${progress}%`, transition: 'width 0.5s',
                        }} />
                    </div>
                )}
            </div>

            {/* Config + Controls */}
            <div style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem',
            }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Layers size={16} /> Eğitim Ayarları
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                    <label style={{ fontSize: '0.8rem' }}>
                        <span style={{ color: '#9ca3af', display: 'block', marginBottom: 4 }}>Dataset</span>
                        <select value={datasetId} onChange={e => setDatasetId(e.target.value)} disabled={isTraining}
                            style={{
                                width: '100%', padding: '0.5rem', borderRadius: 6,
                                background: '#1f2937', border: '1px solid rgba(255,255,255,0.15)',
                                color: '#e5e7eb', fontSize: '0.8rem',
                            }}>
                            {datasets.length === 0 && <option value="">-- Dataset yok --</option>}
                            {datasets.map(ds => (
                                <option key={ds.id} value={ds.id}>{ds.id} ({ds.episode_count} ep)</option>
                            ))}
                        </select>
                    </label>
                    <label style={{ fontSize: '0.8rem' }}>
                        <span style={{ color: '#9ca3af', display: 'block', marginBottom: 4 }}>Policy</span>
                        <select value={policyType} onChange={e => setPolicyType(e.target.value)} disabled={isTraining}
                            style={{
                                width: '100%', padding: '0.5rem', borderRadius: 6,
                                background: '#1f2937', border: '1px solid rgba(255,255,255,0.15)',
                                color: '#e5e7eb', fontSize: '0.8rem',
                            }}>
                            <option value="act">ACT</option>
                            <option value="diffusion">Diffusion</option>
                            <option value="tdmpc">TDMPC</option>
                            <option value="vqbet">VQ-BeT</option>
                        </select>
                    </label>
                    <label style={{ fontSize: '0.8rem' }}>
                        <span style={{ color: '#9ca3af', display: 'block', marginBottom: 4 }}>Steps</span>
                        <input type="number" min={10} max={100000} value={numSteps}
                            onChange={e => setNumSteps(parseInt(e.target.value) || 10)}
                            disabled={isTraining}
                            style={{
                                width: '100%', padding: '0.5rem', borderRadius: 6,
                                background: '#1f2937', border: '1px solid rgba(255,255,255,0.15)',
                                color: '#e5e7eb', fontSize: '0.8rem',
                            }} />
                    </label>
                    <label style={{ fontSize: '0.8rem' }}>
                        <span style={{ color: '#9ca3af', display: 'block', marginBottom: 4 }}>Batch Size</span>
                        <input type="number" min={1} max={512} value={batchSize}
                            onChange={e => setBatchSize(parseInt(e.target.value) || 1)}
                            disabled={isTraining}
                            style={{
                                width: '100%', padding: '0.5rem', borderRadius: 6,
                                background: '#1f2937', border: '1px solid rgba(255,255,255,0.15)',
                                color: '#e5e7eb', fontSize: '0.8rem',
                            }} />
                    </label>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    {!isTraining ? (
                        <button onClick={handleStart} disabled={loading || !datasetId}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '0.6rem 1.5rem', borderRadius: 8, border: 'none',
                                background: '#eab308', color: '#000', fontWeight: 700,
                                cursor: (loading || !datasetId) ? 'not-allowed' : 'pointer',
                                opacity: (loading || !datasetId) ? 0.5 : 1,
                                fontSize: '0.85rem',
                            }}>
                            <Play size={14} /> Eğitimi Başlat
                        </button>
                    ) : (
                        <button onClick={handleStop} disabled={loading}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '0.6rem 1.5rem', borderRadius: 8, border: 'none',
                                background: '#374151', color: '#fff', fontWeight: 600,
                                cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
                                fontSize: '0.85rem',
                            }}>
                            <StopCircle size={14} /> Eğitimi Durdur
                        </button>
                    )}
                    <button onClick={() => { fetchStatus(); fetchDatasets(); fetchArtifacts(); }}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '0.6rem 1rem', borderRadius: 8,
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                            color: '#9ca3af', cursor: 'pointer', fontSize: '0.85rem',
                        }}>
                        <RefreshCw size={14} /> Yenile
                    </button>
                </div>
            </div>

            {/* Training Logs */}
            {logs.length > 0 && (
                <div style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem',
                }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Activity size={16} /> Eğitim Logları
                    </h3>
                    <div ref={logRef} style={{
                        background: '#0d1117', borderRadius: 6, padding: '0.75rem',
                        maxHeight: 300, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.75rem',
                        lineHeight: 1.6, color: '#a5d6ff',
                    }}>
                        {logs.map((line, i) => (
                            <div key={i} style={{
                                color: line.includes('[ERROR]') ? '#f87171' :
                                    line.includes('[WARN]') ? '#fbbf24' :
                                        line.includes('[TRAIN]') ? '#34d399' : '#a5d6ff',
                            }}>{line || '\u00A0'}</div>
                        ))}
                    </div>
                </div>
            )}

            {/* Training Artifacts */}
            <div style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: '1.25rem',
            }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileCode size={16} /> Eğitim Artefaktları ({artifacts.length})
                </h3>
                {artifacts.length === 0 ? (
                    <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>Henüz eğitim artefaktı yok.</p>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af' }}>
                                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Job ID</th>
                                    <th style={{ textAlign: 'center', padding: '0.5rem' }}>Dataset</th>
                                    <th style={{ textAlign: 'center', padding: '0.5rem' }}>Policy</th>
                                    <th style={{ textAlign: 'center', padding: '0.5rem' }}>Steps</th>
                                    <th style={{ textAlign: 'center', padding: '0.5rem' }}><BarChart3 size={12} style={{ verticalAlign: 'middle' }} /> Final Loss</th>
                                    <th style={{ textAlign: 'center', padding: '0.5rem' }}>Durum</th>
                                    <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem' }}>Tarih</th>
                                </tr>
                            </thead>
                            <tbody>
                                {artifacts.map(a => (
                                    <tr key={a.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{a.id}</td>
                                        <td style={{ textAlign: 'center', padding: '0.5rem', fontSize: '0.75rem' }}>{a.dataset_id}</td>
                                        <td style={{ textAlign: 'center', padding: '0.5rem', textTransform: 'uppercase' }}>{a.policy_type}</td>
                                        <td style={{ textAlign: 'center', padding: '0.5rem' }}>{a.num_steps}</td>
                                        <td style={{ textAlign: 'center', padding: '0.5rem', fontFamily: 'monospace' }}>
                                            {a.final_loss != null ? a.final_loss.toFixed(6) : '—'}
                                        </td>
                                        <td style={{ textAlign: 'center', padding: '0.5rem' }}>
                                            <span style={{
                                                padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem',
                                                background: STATE_COLORS[a.status] ? `${STATE_COLORS[a.status]}20` : '#374151',
                                                color: STATE_COLORS[a.status] || '#9ca3af',
                                            }}>{a.status}</span>
                                        </td>
                                        <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#9ca3af', fontSize: '0.75rem' }}>{a.created_at}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.4; }
                }
            `}</style>
        </div>
    );
}
