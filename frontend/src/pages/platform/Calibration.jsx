import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { lerobotClient } from '../../lib/api/lerobotClient';

// ─── Durum renkleri ───
const STATE_COLORS = {
  idle: '#888',
  running: '#4ecdc4',
  completed: '#2ecc71',
  stopped: '#e67e22',
  offline: '#e74c3c',
};

const STATE_LABELS = {
  idle: 'HAZIR',
  running: 'DEVAM EDİYOR',
  completed: 'TAMAMLANDI',
  stopped: 'DURDURULDU',
  offline: 'CEVRİMDISI',
};

const STEP_STATUS_LABELS = {
  pending: 'bekliyor',
  current: 'aktif',
  completed: 'tamamlandi',
};

// ─── Sabit eklem listesi ───
const JOINT_IDS = [
  'shoulder_pan',
  'shoulder_lift',
  'elbow_flex',
  'wrist_flex',
  'wrist_roll',
  'gripper',
];

// ─── Deterministic dry-run fallback values ───
const DRY_RUN_DEFAULTS = {
  shoulder_pan: { min: -2.9845, pos: 0.0, max: 2.9845 },
  shoulder_lift: { min: -1.4923, pos: 0.0, max: 1.4923 },
  elbow_flex: { min: -2.0900, pos: 0.0, max: 2.0900 },
  wrist_flex: { min: -2.9845, pos: 0.0, max: 2.9845 },
  wrist_roll: { min: -2.9845, pos: 0.0, max: 2.9845 },
  gripper: { min: 0.0000, pos: 0.0, max: 0.9500 },
};

function formatNum(v) {
  if (v == null) return '\u2014';
  const n = Number(v);
  if (isNaN(n)) return '\u2014';
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

export default function Calibration() {
  // ─── State ───
  const [calStatus, setCalStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [robotType, setRobotType] = useState('so101_follower');
  const [terminalLines, setTerminalLines] = useState([]);
  const pollRef = useRef(null);
  const terminalRef = useRef(null);

  // ─── Terminal çıktısına satır ekle ───
  const addTerminalLine = useCallback((line) => {
    setTerminalLines(prev => [...prev, { text: line, ts: new Date().toLocaleTimeString('tr-TR') }]);
  }, []);

  // ─── Kalibrasyon durumu sorgulama ───
  const fetchStatus = useCallback(async () => {
    try {
      const status = await lerobotClient.calibrationStatus();
      setCalStatus(status);
      setError(null);
    } catch (err) {
      if (err?.status === 502 || err?.status === 503) {
        setCalStatus({ state: 'offline', message: 'Runtime erisilemez' });
      } else {
        setError(err?.body?.message || err?.message || 'Durum alinamadi');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Polling ───
  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => clearInterval(pollRef.current);
  }, [fetchStatus]);

  // ─── Terminal auto-scroll ───
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalLines]);

  // ─── Aksiyonlar ───
  const handleStart = async () => {
    setActionLoading(true);
    setError(null);
    try {
      setTerminalLines([]);
      addTerminalLine(`$ lerobot-calibrate --robot.type=${robotType} --robot.port=<PORT> --robot.id=kecy_follower`);
      addTerminalLine('Kalibrasyon oturumu baslatiliyor...');
      addTerminalLine('Robotu hareket araliginin orta konumuna getir ve Enter\'a bas.');

      await lerobotClient.calibrationStart({ robot_type: robotType });
      await fetchStatus();

      addTerminalLine('Kalibrasyon baslatildi. Siradaki adim: zero_position (onayla)');
      addTerminalLine('Tum eklemleri sirayla tam hareket araliginda gezdir.');
    } catch (err) {
      const msg = err?.body?.message || err?.message || 'Kalibrasyon baslatilamadi';
      setError(msg);
      addTerminalLine(`HATA: ${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStep = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const currentStep = calStatus?.current_step;
      addTerminalLine(`Adim isleniyor: ${currentStep?.id || '?'}...`);

      const result = await lerobotClient.calibrationStep();
      await fetchStatus();

      const completedId = result.step_completed;
      addTerminalLine(`Adim tamamlandi: ${completedId}`);

      if (result.step_result?.joint) {
        const sr = result.step_result;
        addTerminalLine(`  ${sr.joint}: min=${formatNum(sr.measured_min)} max=${formatNum(sr.measured_max)}${sr.simulated ? ' (simulasyon)' : ''}`);
      }

      if (result.next_step) {
        const ns = result.next_step;
        const actionLabel = ns.action === 'save' ? 'kaydet' : ns.action === 'confirm' ? 'onayla' : 'aralik taramasi';
        addTerminalLine(`Siradaki adim: ${ns.id} (${actionLabel})`);
      }

      if (result.state === 'completed') {
        addTerminalLine('Tum adimlar tamamlandi.');
        if (result.artifact_path) {
          addTerminalLine(`Kalibrasyon dosyasi: ${result.artifact_path}`);
        }
        addTerminalLine('Pozisyonlar kaydedildi.');
      }
    } catch (err) {
      const code = err?.body?.code;
      const msg = err?.body?.message || err?.message || 'Adim basarisiz';
      if (code === 'PRECONDITION_FAILED') {
        setError(`On kosul hatasi: ${msg}`);
        addTerminalLine(`ON KOSUL HATASI: ${msg}`);
      } else {
        setError(msg);
        addTerminalLine(`HATA: ${msg}`);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    setError(null);
    try {
      addTerminalLine('Kalibrasyon durduruluyor...');
      await lerobotClient.calibrationStop();
      await fetchStatus();
      addTerminalLine('Kalibrasyon durduruldu.');
    } catch (err) {
      setError(err?.body?.message || err?.message || 'Durdurma basarisiz');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReset = async () => {
    try {
      await lerobotClient.calibrationStop();
    } catch { }
    setTerminalLines([]);
    await fetchStatus();
  };

  const handleCopyTerminal = () => {
    const text = terminalLines.map(l => `[${l.ts}] ${l.text}`).join('\n');
    navigator.clipboard.writeText(text).catch(() => { });
  };

  // ─── Türetilmis degerler ───
  const state = calStatus?.state || 'idle';
  const steps = calStatus?.steps || [];
  const currentStepIndex = calStatus?.current_step_index ?? 0;
  const totalSteps = calStatus?.total_steps ?? 0;
  const isDryRun = calStatus?.dry_run ?? true;
  const currentStep = calStatus?.current_step;
  const artifactPath = calStatus?.artifact_path;
  const isRunning = state === 'running';
  const isCompleted = state === 'completed';
  const isStopped = state === 'stopped';
  const isOffline = state === 'offline';
  const progressPct = totalSteps > 0 ? Math.round((currentStepIndex / totalSteps) * 100) : 0;

  // ─── MIN / POS / MAX tablosu verileri ───
  const jointTableData = useMemo(() => {
    const zeroResult = steps.find(s => s.id === 'zero_position' && s.status === 'completed')?.result;
    const positions = zeroResult?.positions || {};

    return JOINT_IDS.map(jid => {
      const sweepResult = steps.find(s => s.id === `range_${jid}` && s.status === 'completed')?.result;
      const fallback = DRY_RUN_DEFAULTS[jid];

      let min = sweepResult?.measured_min;
      let max = sweepResult?.measured_max;
      let pos = positions[jid];

      // If no real data and calibration is completed, use deterministic fallback
      if (min == null && (isCompleted || (sweepResult != null))) {
        min = fallback.min;
      }
      if (max == null && (isCompleted || (sweepResult != null))) {
        max = fallback.max;
      }
      if (pos == null && (isCompleted || (zeroResult != null))) {
        pos = fallback.pos;
      }

      return { id: jid, min, pos, max };
    });
  }, [steps, isCompleted]);

  const hasTableData = jointTableData.some(j => j.min != null || j.pos != null || j.max != null);
  const showTerminal = terminalLines.length > 0 || isRunning || isCompleted;

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingSpinner}>Kalibrasyon durumu yukleniyor...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Baslik */}
      <div style={styles.header}>
        <h1 style={styles.title}>Kalibrasyon</h1>
        <p style={styles.subtitle}>
          SO-ARM101 eklem kalibrasyon sihirbazi. Her eklemi tam hareket araliginda hareket ettirerek min/max pozisyonlarini kaydedin.
        </p>
        <a
          href="https://huggingface.co/docs/lerobot/so101#calibrate"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.docsLink}
        >
          LeRobot SO-101 Kalibrasyon Dokumantasyonu
        </a>
      </div>

      {/* Durum cubugu */}
      <div style={{ ...styles.statusBar, borderColor: STATE_COLORS[state] || '#555' }}>
        <div style={styles.statusRow}>
          <span style={{ ...styles.statusBadge, background: STATE_COLORS[state] }}>
            {STATE_LABELS[state] || state.toUpperCase()}
          </span>
          {isDryRun && state !== 'idle' && state !== 'offline' && (
            <span style={styles.dryRunBadge}>SIMULASYON</span>
          )}
          {isRunning && (
            <span style={styles.progressText}>
              Adim {currentStepIndex + 1} / {totalSteps} ({progressPct}%)
            </span>
          )}
        </div>
        {isRunning && (
          <div style={styles.progressBarOuter}>
            <div style={{ ...styles.progressBarInner, width: `${progressPct}%` }} />
          </div>
        )}
      </div>

      {/* Hata bildirimi */}
      {error && (
        <div style={styles.errorBanner}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={styles.dismissBtn}>X</button>
        </div>
      )}

      {/* Cevrimdisi bildirimi */}
      {isOffline && (
        <div style={styles.offlineBanner}>
          Runtime cevrimdisi. Kalibrasyona baslamak icin Docker konteynerlerini baslatin.
        </div>
      )}

      {/* ─── Bosta / Baslat gorunumu ─── */}
      {(state === 'idle' || isStopped) && !isOffline && (
        <div style={styles.startCard}>
          <h2 style={styles.cardTitle}>Kalibrasyon Oturumu Baslat</h2>
          <p style={styles.cardDesc}>
            Bu sihirbaz, SO-ARM101'in her eklemini kalibre etmeniz icin size rehberlik edecektir.
            Donanim bagli degilken <strong>dry-run (simulasyon)</strong> modunda calisir.
          </p>

          <div style={styles.formRow}>
            <label style={styles.label}>Robot Tipi</label>
            <select
              value={robotType}
              onChange={(e) => setRobotType(e.target.value)}
              style={styles.select}
            >
              <option value="so101_follower">so101_follower</option>
              <option value="so_100">so_100</option>
              <option value="so_follower">so_follower</option>
              <option value="koch_follower">koch_follower</option>
            </select>
          </div>

          <div style={styles.hwNote}>
            <strong>Donanim bagli degil mi?</strong> Sorun degil -- kalibrasyon simule edilmis eklem araliklari ile dry-run modunda calisacaktir. Robotunuz geldiginde seri portu baglayip yeniden kalibre edin.
          </div>

          <button
            onClick={handleStart}
            disabled={actionLoading}
            style={{
              ...styles.primaryBtn,
              opacity: actionLoading ? 0.6 : 1,
            }}
          >
            {actionLoading ? 'Baslatiliyor...' : 'Kalibrasyonu Baslat'}
          </button>
        </div>
      )}

      {/* ─── Devam ediyor / Sihirbaz gorunumu ─── */}
      {isRunning && currentStep && (
        <div style={styles.wizardCard}>
          <div style={styles.currentStepHeader}>
            <div>
              <h3 style={styles.stepTitle}>{currentStep.title}</h3>
              <p style={styles.stepDesc}>{currentStep.description}</p>
            </div>
          </div>

          {currentStep.joint && (
            <div style={styles.jointInfo}>
              Eklem: <code style={styles.code}>{currentStep.joint}</code>
              {isDryRun && (
                <span style={styles.simNote}> -- simule edilmis aralik taramasi</span>
              )}
            </div>
          )}

          <div style={styles.buttonRow}>
            <button
              onClick={handleStep}
              disabled={actionLoading}
              style={{
                ...styles.primaryBtn,
                opacity: actionLoading ? 0.6 : 1,
              }}
            >
              {actionLoading ? 'Isleniyor...' :
                currentStep.action === 'save' ? 'Kaydet ve Tamamla' :
                  currentStep.action === 'confirm' ? 'Onayla ve Devam Et' :
                    'Kayit Al ve Ilerle'
              }
            </button>
            <button
              onClick={handleStop}
              disabled={actionLoading}
              style={styles.dangerBtn}
            >
              Durdur
            </button>
          </div>
        </div>
      )}

      {/* ─── Tamamlandi gorunumu ─── */}
      {isCompleted && (
        <div style={styles.completedCard}>
          <div style={styles.completedIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h2 style={styles.cardTitle}>Kalibrasyon Tamamlandi</h2>
          {artifactPath && (
            <p style={styles.artifactLine}>
              Kalibrasyon dosyasi: <code style={styles.code}>{artifactPath}</code>
            </p>
          )}
          {isDryRun && (
            <div style={styles.hwNote}>
              Bu simule edilmis verilerle yapilmis bir <strong>dry-run (simulasyon)</strong> kalibrasyonudur.
              Donanim baglandiginda gercek eklem araliklarini kaydetmek icin yeniden calistirin.
            </div>
          )}
          <button onClick={handleReset} style={styles.secondaryBtn}>
            Yeni Kalibrasyon
          </button>
        </div>
      )}

      {/* ─── Terminal Ciktisi ─── */}
      {showTerminal && (
        <div style={styles.terminalCard}>
          <div style={styles.terminalHeader}>
            <h3 style={styles.terminalTitle}>Terminal Ciktisi</h3>
            <button onClick={handleCopyTerminal} style={styles.copyBtn}>
              Kopyala
            </button>
          </div>
          <div ref={terminalRef} style={styles.terminalBody}>
            {terminalLines.length === 0 ? (
              <div style={styles.terminalEmpty}>Kalibrasyon basladiginda cikti burada gorunecektir.</div>
            ) : (
              terminalLines.map((line, i) => (
                <div key={i} style={styles.terminalLine}>
                  <span style={styles.terminalTs}>[{line.ts}]</span>
                  <span style={
                    line.text.startsWith('$') ? styles.terminalCmd :
                      line.text.startsWith('HATA') || line.text.startsWith('ON KOSUL') ? styles.terminalError :
                        line.text.startsWith('Adim tamamlandi') ? styles.terminalSuccess :
                          styles.terminalText
                  }>
                    {line.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ─── Kalibrasyon Degerleri Tablosu ─── */}
      {hasTableData && (
        <div style={styles.tableCard}>
          <h3 style={styles.tableTitle}>Kalibrasyon Degerleri</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>AD</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>MIN</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>ORTA (POS)</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>MAX</th>
                </tr>
              </thead>
              <tbody>
                {jointTableData.map(j => (
                  <tr key={j.id} style={styles.tr}>
                    <td style={styles.tdName}>{j.id}</td>
                    <td style={styles.tdNum}>{formatNum(j.min)}</td>
                    <td style={styles.tdNum}>{formatNum(j.pos)}</td>
                    <td style={styles.tdNum}>{formatNum(j.max)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isDryRun && (
            <div style={styles.tableNote}>
              Simulasyon verileri gosteriliyor. Donanim baglandiginda gercek degerler kullanilir.
            </div>
          )}
        </div>
      )}

      {/* ─── Adimlar ozeti ─── */}
      {steps.length > 0 && (
        <div style={styles.stepsCard}>
          <h3 style={styles.stepsTitle}>Adimlar Ozeti</h3>
          <div style={styles.stepsList}>
            {steps.map((step, i) => (
              <div
                key={step.id}
                style={{
                  ...styles.stepRow,
                  ...(step.status === 'current' ? styles.stepCurrent : {}),
                  ...(step.status === 'completed' ? styles.stepCompleted : {}),
                }}
              >
                <span style={styles.stepNumber}>
                  {step.status === 'completed' ? '/' : step.status === 'current' ? '>' : (i + 1)}
                </span>
                <span style={styles.stepLabel}>{step.title}</span>
                <span style={{
                  ...styles.stepStatus,
                  color: step.status === 'completed' ? '#2ecc71' :
                    step.status === 'current' ? '#4ecdc4' : '#666',
                }}>
                  {STEP_STATUS_LABELS[step.status] || step.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kaynak */}
      <div style={styles.sourceBox}>
        <span style={styles.sourceLabel}>Kaynak</span>
        <a
          href="https://huggingface.co/docs/lerobot/so101#calibrate"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.sourceLink}
        >
          HuggingFace LeRobot -- SO-101 Kalibrasyon
        </a>
      </div>
    </div>
  );
}

// ─── Stiller ───

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    maxWidth: 800,
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  title: {
    fontFamily: "'pptelegraf-regular', sans-serif",
    fontSize: 'clamp(24px, 4vw, 42px)',
    color: '#ffffff',
    letterSpacing: '-0.02em',
    lineHeight: 1.15,
    margin: 0,
  },
  subtitle: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 14,
    color: '#aaa',
    lineHeight: '1.6em',
    margin: 0,
    maxWidth: 680,
  },
  docsLink: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    color: '#cecafb',
    textDecoration: 'none',
  },
  loadingSpinner: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 14,
    color: '#888',
    padding: 40,
    textAlign: 'center',
  },

  // Durum cubugu
  statusBar: {
    padding: '14px 18px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(240,243,243,0.12)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  statusBadge: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 11,
    color: '#000',
    padding: '3px 10px',
    borderRadius: 4,
    fontWeight: 600,
    letterSpacing: '0.05em',
  },
  dryRunBadge: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 10,
    color: '#f39c12',
    border: '1px solid rgba(243,156,18,0.3)',
    padding: '2px 8px',
    borderRadius: 4,
  },
  progressText: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    color: '#999',
    marginLeft: 'auto',
  },
  progressBarOuter: {
    height: 4,
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    background: 'linear-gradient(90deg, #4ecdc4, #2ecc71)',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  },

  // Hata / cevrimdisi bildirimleri
  errorBanner: {
    padding: '12px 16px',
    background: 'rgba(231,76,60,0.12)',
    border: '1px solid rgba(231,76,60,0.3)',
    borderRadius: 8,
    color: '#e74c3c',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dismissBtn: {
    background: 'none',
    border: 'none',
    color: '#e74c3c',
    cursor: 'pointer',
    fontSize: 16,
    padding: '0 4px',
  },
  offlineBanner: {
    padding: '14px 18px',
    background: 'rgba(231,76,60,0.08)',
    border: '1px solid rgba(231,76,60,0.25)',
    borderRadius: 8,
    color: '#e74c3c',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
  },

  // Baslat karti
  startCard: {
    padding: '24px 22px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(240,243,243,0.1)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  cardTitle: {
    fontFamily: "'pptelegraf-regular', sans-serif",
    fontSize: 20,
    color: '#fff',
    margin: 0,
  },
  cardDesc: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    color: '#aaa',
    lineHeight: '1.7em',
    margin: 0,
  },
  formRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    color: '#999',
    minWidth: 90,
  },
  select: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6,
    color: '#fff',
    padding: '6px 10px',
    outline: 'none',
  },
  hwNote: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    color: '#888',
    background: 'rgba(78,205,196,0.06)',
    border: '1px solid rgba(78,205,196,0.15)',
    borderRadius: 8,
    padding: '10px 14px',
    lineHeight: '1.6em',
  },
  primaryBtn: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 14,
    background: 'linear-gradient(135deg, #4ecdc4, #44b09e)',
    border: 'none',
    borderRadius: 8,
    color: '#000',
    padding: '10px 20px',
    cursor: 'pointer',
    fontWeight: 600,
    transition: 'opacity 0.2s',
    alignSelf: 'flex-start',
  },
  secondaryBtn: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 8,
    color: '#ccc',
    padding: '8px 16px',
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  dangerBtn: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    background: 'rgba(231,76,60,0.15)',
    border: '1px solid rgba(231,76,60,0.3)',
    borderRadius: 8,
    color: '#e74c3c',
    padding: '8px 16px',
    cursor: 'pointer',
  },

  // Sihirbaz karti
  wizardCard: {
    padding: '24px 22px',
    background: 'rgba(78,205,196,0.04)',
    border: '1px solid rgba(78,205,196,0.2)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  currentStepHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
  },
  stepTitle: {
    fontFamily: "'pptelegraf-regular', sans-serif",
    fontSize: 18,
    color: '#fff',
    margin: 0,
  },
  stepDesc: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    color: '#aaa',
    margin: '4px 0 0 0',
    lineHeight: '1.6em',
  },
  jointInfo: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    color: '#999',
  },
  code: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    background: 'rgba(255,255,255,0.06)',
    padding: '2px 6px',
    borderRadius: 4,
    color: '#4ecdc4',
    fontSize: 12,
  },
  simNote: {
    color: '#f39c12',
    fontSize: 11,
  },
  buttonRow: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },

  // Tamamlandi karti
  completedCard: {
    padding: '30px 24px',
    background: 'rgba(46,204,113,0.06)',
    border: '1px solid rgba(46,204,113,0.25)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    alignItems: 'center',
    textAlign: 'center',
  },
  completedIcon: {
    fontSize: 48,
  },
  artifactLine: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    color: '#aaa',
    wordBreak: 'break-all',
  },

  // Terminal panel
  terminalCard: {
    background: '#0a0a0a',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  terminalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 16px',
    background: 'rgba(255,255,255,0.04)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  terminalTitle: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    color: '#aaa',
    margin: 0,
    fontWeight: 600,
  },
  copyBtn: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 11,
    color: '#888',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 4,
    padding: '3px 10px',
    cursor: 'pointer',
    transition: 'color 0.2s',
  },
  terminalBody: {
    padding: '12px 16px',
    maxHeight: 260,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  terminalEmpty: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    color: '#555',
    fontStyle: 'italic',
  },
  terminalLine: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    lineHeight: '1.6em',
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
  },
  terminalTs: {
    color: '#555',
    fontSize: 10,
    flexShrink: 0,
    minWidth: 70,
  },
  terminalCmd: {
    color: '#4ecdc4',
  },
  terminalError: {
    color: '#e74c3c',
  },
  terminalSuccess: {
    color: '#2ecc71',
  },
  terminalText: {
    color: '#ccc',
  },

  // Kalibrasyon degerleri tablosu
  tableCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(240,243,243,0.1)',
    borderRadius: 10,
    padding: '18px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  tableTitle: {
    fontFamily: "'pptelegraf-regular', sans-serif",
    fontSize: 15,
    color: '#ccc',
    margin: 0,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
  },
  th: {
    padding: '8px 12px',
    textAlign: 'left',
    color: '#888',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
  },
  tr: {
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  tdName: {
    padding: '8px 12px',
    color: '#ddd',
    fontWeight: 500,
  },
  tdNum: {
    padding: '8px 12px',
    textAlign: 'right',
    color: '#4ecdc4',
    fontVariantNumeric: 'tabular-nums',
  },
  tableNote: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 11,
    color: '#666',
    fontStyle: 'italic',
  },

  // Adimlar ozeti
  stepsCard: {
    padding: '18px 20px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(240,243,243,0.08)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  stepsTitle: {
    fontFamily: "'pptelegraf-regular', sans-serif",
    fontSize: 15,
    color: '#ccc',
    margin: 0,
  },
  stepsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  stepRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 10px',
    borderRadius: 6,
    transition: 'background 0.2s',
  },
  stepCurrent: {
    background: 'rgba(78,205,196,0.08)',
    border: '1px solid rgba(78,205,196,0.2)',
  },
  stepCompleted: {
    opacity: 0.7,
  },
  stepNumber: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    color: '#666',
    width: 20,
    textAlign: 'center',
    flexShrink: 0,
  },
  stepLabel: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    color: '#ddd',
    flex: 1,
  },
  stepStatus: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },

  // Kaynak
  sourceBox: {
    marginTop: 12,
    padding: '14px 18px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(240,243,243,0.08)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  sourceLabel: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 10,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  sourceLink: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    color: '#cecafb',
    textDecoration: 'none',
    wordBreak: 'break-all',
  },
};
