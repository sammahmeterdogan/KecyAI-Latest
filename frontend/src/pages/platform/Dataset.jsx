import { useState, useEffect, useCallback, useRef } from 'react';
import { LeRobotClient } from '../../lib/api/lerobotClient';
import { Circle, StopCircle, RefreshCw, Database, Clock, Film, HardDrive, Trash2, Play } from 'lucide-react';

const STATUS_COLORS = { idle: '#6b7280', recording: '#ef4444' };

export default function Dataset() {
    const [status, setStatus] = useState({ state: 'idle' });
    const [datasets, setDatasets] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const pollRef = useRef(null);

    // Config
    const [robotType, setRobotType] = useState('so101_follower');
    const [numEpisodes, setNumEpisodes] = useState(3);
    const [episodeDuration, setEpisodeDuration] = useState(5);
    const [hz, setHz] = useState(30);

    const fetchStatus = useCallback(async () => {
        try {
            const s = await LeRobotClient.recordingStatus();
            setStatus(s);
        } catch { /* ignore */ }
    }, []);

    const fetchDatasets = useCallback(async () => {
        try {
            const r = await LeRobotClient.recordingDatasets();
            setDatasets(r.datasets || []);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        fetchStatus();
        fetchDatasets();
    }, [fetchStatus, fetchDatasets]);

    // Poll status when recording
    useEffect(() => {
        if (status.state === 'recording') {
            pollRef.current = setInterval(() => {
                fetchStatus();
            }, 1000);
        } else {
            if (pollRef.current) clearInterval(pollRef.current);
        }
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [status.state, fetchStatus]);

    const handleStart = async () => {
        setError(null);
        setLoading(true);
        try {
            const result = await LeRobotClient.recordingStart({
                robot_type: robotType,
                mode: 'dry_run',
                num_episodes: numEpisodes,
                episode_duration_sec: episodeDuration,
                hz: hz,
            });
            setStatus(result);
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
            const result = await LeRobotClient.recordingStop(true);
            setStatus(result);
            fetchDatasets();
        } catch (e) {
            setError(e.body || { message: e.message });
        } finally {
            setLoading(false);
        }
    };

    const handleDiscard = async () => {
        if (!window.confirm('Bu kaydı iptal etmek istediğinize emin misiniz? Veriler silinecek.')) return;
        setError(null);
        setLoading(true);
        try {
            const result = await LeRobotClient.recordingDiscard();
            setStatus(result);
            fetchDatasets();
        } catch (e) {
            setError(e.body || { message: e.message });
        } finally {
            setLoading(false);
        }
    };

    const handleReplay = async () => {
        setError(null);
        setLoading(true);
        try {
            await LeRobotClient.recordingReplay(-1);
        } catch (e) {
            setError(e.body || { message: e.message });
        } finally {
            setLoading(false);
        }
    };

    const isRecording = status.state === 'recording';

    return (
        <div style={{ padding: '2rem', color: '#e5e7eb', maxWidth: 900 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Database size={22} /> Veri Toplama
            </h1>
            <p style={{ color: '#9ca3af', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                LeRobotDataset formatında episode kayıt. Dry-run modunda sentetik veri üretilir.
            </p>

            {/* Error Banner */}
            {error && (
                <div style={{ background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                    <strong>{error.code || 'ERROR'}:</strong> {error.message}
                </div>
            )}

            {/* Status Indicator */}
            <div style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem',
                display: 'flex', alignItems: 'center', gap: 12,
            }}>
                <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: STATUS_COLORS[status.state] || '#6b7280',
                    animation: isRecording ? 'pulse 1.5s infinite' : 'none',
                    boxShadow: isRecording ? '0 0 8px #ef4444' : 'none',
                }} />
                <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.8rem', letterSpacing: '0.05em' }}>
                    {isRecording ? 'KAYIT DEVAM EDİYOR' : 'HAZIR'}
                </span>
                {isRecording && (
                    <span style={{ color: '#9ca3af', fontSize: '0.8rem', marginLeft: 'auto' }}>
                        Episode: {status.episode_count || 0} &nbsp;|&nbsp;
                        Frame: {status.frame_count || 0} &nbsp;|&nbsp;
                        Dataset: {status.dataset_id || ''}
                    </span>
                )}
            </div>

            {/* Config + Controls */}
            <div style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem',
            }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem' }}>Kayıt Ayarları</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                    <label style={{ fontSize: '0.8rem' }}>
                        <span style={{ color: '#9ca3af', display: 'block', marginBottom: 4 }}>Robot Type</span>
                        <select value={robotType} onChange={e => setRobotType(e.target.value)} disabled={isRecording}
                            style={{
                                width: '100%', padding: '0.5rem', borderRadius: 6,
                                background: '#1f2937', border: '1px solid rgba(255,255,255,0.15)',
                                color: '#e5e7eb', fontSize: '0.85rem',
                            }}>
                            <option value="so101_follower">so101_follower</option>
                            <option value="so101_leader">so101_leader</option>
                        </select>
                    </label>
                    <label style={{ fontSize: '0.8rem' }}>
                        <span style={{ color: '#9ca3af', display: 'block', marginBottom: 4 }}>Episode Sayısı</span>
                        <input type="number" min={1} max={50} value={numEpisodes}
                            onChange={e => setNumEpisodes(parseInt(e.target.value) || 1)}
                            disabled={isRecording}
                            style={{
                                width: '100%', padding: '0.5rem', borderRadius: 6,
                                background: '#1f2937', border: '1px solid rgba(255,255,255,0.15)',
                                color: '#e5e7eb', fontSize: '0.85rem',
                            }} />
                    </label>
                    <label style={{ fontSize: '0.8rem' }}>
                        <span style={{ color: '#9ca3af', display: 'block', marginBottom: 4 }}>Süre (sn/episode)</span>
                        <input type="number" min={1} max={60} value={episodeDuration}
                            onChange={e => setEpisodeDuration(parseInt(e.target.value) || 1)}
                            disabled={isRecording}
                            style={{
                                width: '100%', padding: '0.5rem', borderRadius: 6,
                                background: '#1f2937', border: '1px solid rgba(255,255,255,0.15)',
                                color: '#e5e7eb', fontSize: '0.85rem',
                            }} />
                    </label>
                    <label style={{ fontSize: '0.8rem' }}>
                        <span style={{ color: '#9ca3af', display: 'block', marginBottom: 4 }}>Hz (Frame Rate)</span>
                        <input type="number" min={1} max={100} value={hz}
                            onChange={e => setHz(parseInt(e.target.value) || 10)}
                            disabled={isRecording}
                            style={{
                                width: '100%', padding: '0.5rem', borderRadius: 6,
                                background: '#1f2937', border: '1px solid rgba(255,255,255,0.15)',
                                color: '#e5e7eb', fontSize: '0.85rem',
                            }} />
                    </label>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    {!isRecording ? (
                        <>
                            <button onClick={handleStart} disabled={loading}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '0.6rem 1.5rem', borderRadius: 8, border: 'none',
                                    background: '#dc2626', color: '#fff', fontWeight: 600,
                                    cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
                                    fontSize: '0.85rem',
                                }}>
                                <Circle size={14} /> Kayıt Başlat
                            </button>
                            {datasets.length > 0 && (
                                <button onClick={handleReplay} disabled={loading}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '0.6rem 1.25rem', borderRadius: 8, border: 'none',
                                        background: '#1e3a5f', color: '#60a5fa', fontWeight: 600,
                                        cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
                                        fontSize: '0.85rem',
                                    }}>
                                    <Play size={14} /> Tekrar Oynat
                                </button>
                            )}
                        </>
                    ) : (
                        <>
                            <button onClick={handleStop} disabled={loading}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '0.6rem 1.5rem', borderRadius: 8, border: 'none',
                                    background: '#374151', color: '#fff', fontWeight: 600,
                                    cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
                                    fontSize: '0.85rem',
                                }}>
                                <StopCircle size={14} /> Kaydet ve Durdur
                            </button>
                            <button onClick={handleDiscard} disabled={loading}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '0.6rem 1.25rem', borderRadius: 8,
                                    background: 'transparent', border: '1px solid #dc2626',
                                    color: '#ef4444', fontWeight: 600,
                                    cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
                                    fontSize: '0.85rem',
                                }}>
                                <Trash2 size={14} /> İptal Et
                            </button>
                        </>
                    )}
                    <button onClick={() => { fetchStatus(); fetchDatasets(); }}
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

            {/* Dataset List */}
            <div style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: '1.25rem',
            }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HardDrive size={16} /> Kaydedilmiş Datasetler ({datasets.length})
                </h3>
                {datasets.length === 0 ? (
                    <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>Henüz dataset yok. Kayıt başlatarak veri toplayın.</p>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af' }}>
                                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Dataset ID</th>
                                    <th style={{ textAlign: 'center', padding: '0.5rem' }}>Robot</th>
                                    <th style={{ textAlign: 'center', padding: '0.5rem' }}><Film size={12} style={{ verticalAlign: 'middle' }} /> Episodes</th>
                                    <th style={{ textAlign: 'center', padding: '0.5rem' }}>Frames</th>
                                    <th style={{ textAlign: 'center', padding: '0.5rem' }}>Mode</th>
                                    <th style={{ textAlign: 'center', padding: '0.5rem' }}><Clock size={12} style={{ verticalAlign: 'middle' }} /> Süre</th>
                                    <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem' }}>Oluşturulma</th>
                                </tr>
                            </thead>
                            <tbody>
                                {datasets.map(ds => (
                                    <tr key={ds.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{ds.id}</td>
                                        <td style={{ textAlign: 'center', padding: '0.5rem' }}>{ds.robot_type}</td>
                                        <td style={{ textAlign: 'center', padding: '0.5rem', fontWeight: 600 }}>{ds.episode_count}</td>
                                        <td style={{ textAlign: 'center', padding: '0.5rem' }}>{ds.total_frames}</td>
                                        <td style={{ textAlign: 'center', padding: '0.5rem' }}>
                                            <span style={{
                                                padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem',
                                                background: ds.mode === 'dry_run' ? '#1e3a5f' : '#1a4731',
                                                color: ds.mode === 'dry_run' ? '#60a5fa' : '#4ade80',
                                            }}>{ds.mode}</span>
                                        </td>
                                        <td style={{ textAlign: 'center', padding: '0.5rem' }}>{ds.duration_sec}s</td>
                                        <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#9ca3af', fontSize: '0.75rem' }}>{ds.created_at}</td>
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
