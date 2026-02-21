import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lerobotClient } from '../../lib/api/lerobotClient';

const MOTOR_STEPS = [
  { key: 'gripper', id: 6, instruction: 'Kontrol kartını yalnızca gripper motora bağlayın ve Enter basın.', expected: "'gripper' motor id set to 6", hasWiringTip: false },
  { key: 'wrist_roll', id: 5, instruction: 'Kontrol kartını yalnızca wrist_roll motora bağlayın ve Enter basın.', expected: "'wrist_roll' motor id set to 5", hasWiringTip: true },
  { key: 'wrist_flex', id: 4, instruction: 'Kontrol kartını yalnızca wrist_flex motora bağlayın ve Enter basın.', expected: "'wrist_flex' motor id set to 4", hasWiringTip: false },
  { key: 'elbow_flex', id: 3, instruction: 'Kontrol kartını yalnızca elbow_flex motora bağlayın ve Enter basın.', expected: "'elbow_flex' motor id set to 3", hasWiringTip: false },
  { key: 'shoulder_lift', id: 2, instruction: 'Kontrol kartını yalnızca shoulder_lift motora bağlayın ve Enter basın.', expected: "'shoulder_lift' motor id set to 2", hasWiringTip: false },
  { key: 'shoulder_pan', id: 1, instruction: 'Kontrol kartını yalnızca shoulder_pan motora bağlayın ve Enter basın.', expected: "'shoulder_pan' motor id set to 1", hasWiringTip: false },
];

function nowStamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

const RUNNING_SESSION_STATES = new Set(['running', 'stopping']);
const FINAL_SESSION_STATES = new Set(['completed', 'failed', 'stopped', 'idle']);
const TERMINAL_LIMIT = 800;

function clampMotorIndex(index) {
  if (typeof index !== 'number' || Number.isNaN(index)) return 0;
  return Math.min(Math.max(index, 0), MOTOR_STEPS.length - 1);
}

function buildFollowerCommand(port) {
  return `lerobot-setup-motors \\
  --robot.type=so101_follower \\
  --robot.port=${port}`;
}

function buildLeaderCommand(port) {
  return `lerobot-setup-motors \\
  --teleop.type=so101_leader \\
  --teleop.port=${port}`;
}

export default function Motors() {
  const navigate = useNavigate();

  const [serialPort, setSerialPort] = useState('/dev/tty.usbmodem585A0076841');
  const [leaderPort, setLeaderPort] = useState('/dev/tty.usbmodem575E0031751');
  const [scanResult, setScanResult] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [motorIndex, setMotorIndex] = useState(0);
  const [isLeaderFlow, setIsLeaderFlow] = useState(false);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const [terminalLines, setTerminalLines] = useState([]);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [sessionPolling, setSessionPolling] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const nextLogIndexRef = useRef(0);
  const sessionStateRef = useRef({ sessionId: '', state: '' });

  const currentMotor = MOTOR_STEPS[motorIndex];
  const followerCommand = useMemo(() => buildFollowerCommand(serialPort), [serialPort]);
  const leaderCommand = useMemo(() => buildLeaderCommand(leaderPort), [leaderPort]);

  const addLine = (line, ts = nowStamp()) => {
    setTerminalLines((prev) => {
      const next = [...prev, { ts, line }];
      return next.length > TERMINAL_LIMIT ? next.slice(-TERMINAL_LIMIT) : next;
    });
  };

  const appendRuntimeLogs = (entries) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    setTerminalLines((prev) => {
      const mapped = entries
        .filter((entry) => entry && entry.line)
        .map((entry) => ({
          ts: entry.ts || nowStamp(),
          line: entry.stream === 'stderr' ? `ERROR: ${entry.line}` : entry.line,
        }));
      const next = [...prev, ...mapped];
      return next.length > TERMINAL_LIMIT ? next.slice(-TERMINAL_LIMIT) : next;
    });
  };

  const syncWizardFromSession = (status) => {
    if (!status || typeof status !== 'object') return;

    const flow = status.flow === 'leader' ? 'leader' : 'follower';
    const sessionId = status.session_id || '';
    const state = status.state || 'idle';
    const previous = sessionStateRef.current;
    const stateChanged = previous.sessionId !== sessionId || previous.state !== state;
    sessionStateRef.current = { sessionId, state };

    setIsLeaderFlow(flow === 'leader');
    setMotorIndex(clampMotorIndex(status.current_step_index ?? 0));

    if (RUNNING_SESSION_STATES.has(state)) {
      setWizardStep(2);
      return;
    }

    if (state === 'completed') {
      setWizardStep(flow === 'leader' ? 5 : 3);
      if (stateChanged) {
        addLine(flow === 'leader' ? 'Leader kol kurulumu tamamlandi.' : 'Follower kol kurulumu tamamlandi.');
      }
      return;
    }

    if (state === 'failed') {
      setWizardStep(2);
      setShowTroubleshoot(true);
      if (stateChanged && status.last_error) {
        addLine(`HATA: ${status.last_error}`);
      }
      return;
    }

    if (state === 'stopped' && stateChanged) {
      addLine('Motor kurulum oturumu durduruldu.');
    }
  };

  const refreshSessionLogs = async (options = {}) => {
    const { forceTail = false } = options;
    const res = await lerobotClient.adminMotorSetupLogs(
      forceTail ? { tail: 160 } : { since: nextLogIndexRef.current }
    );
    appendRuntimeLogs(res?.logs || []);
    if (typeof res?.next_index === 'number') {
      nextLogIndexRef.current = res.next_index;
    }
  };

  const refreshSessionStatus = async (options = {}) => {
    const { silentError = true, withLogs = true } = options;
    try {
      const status = await lerobotClient.adminMotorSetupStatus();
      setSessionStatus(status);
      syncWizardFromSession(status);
      if (withLogs) {
        await refreshSessionLogs();
      }

      if (RUNNING_SESSION_STATES.has(status?.state)) {
        setSessionPolling(true);
      } else if (FINAL_SESSION_STATES.has(status?.state)) {
        setSessionPolling(false);
      }

      return status;
    } catch (error) {
      if (!silentError) {
        const msg = error?.body?.message || error?.message || 'Motor kurulum durumu alinamadi';
        addLine(`ERROR: ${msg}`);
      }
      throw error;
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const status = await lerobotClient.adminMotorSetupStatus();
        if (!mounted) return;
        setSessionStatus(status);
        syncWizardFromSession(status);
        await refreshSessionLogs({ forceTail: true });
        if (RUNNING_SESSION_STATES.has(status?.state)) {
          setSessionPolling(true);
        }
      } catch {
        // ignore initial read errors
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionPolling) return undefined;

    const id = setInterval(() => {
      refreshSessionStatus({ silentError: true, withLogs: true }).catch(() => {
        setSessionPolling(false);
      });
    }, 1200);

    return () => clearInterval(id);
  }, [sessionPolling]);

  const checkSerialPorts = async () => {
    setScanLoading(true);
    try {
      const res = await lerobotClient.adminScanMotorPorts();
      setScanResult(res);
      if (Array.isArray(res?.ports) && res.ports[0]) {
        if (!isLeaderFlow) setSerialPort(res.ports[0]);
        if (res.ports[1]) setLeaderPort(res.ports[1]);
      }
      addLine(`Port taramasi: ${res?.message || 'tamamlandi'}`);
    } catch (error) {
      const msg = error?.body?.message || error?.message || 'Port taramasi basarisiz';
      setScanResult({ status: 'error', ports: [], message: msg, stdout: [], stderr: [] });
      addLine(`ERROR: ${msg}`);
    } finally {
      setScanLoading(false);
    }
  };

  const resetWizard = async () => {
    if (RUNNING_SESSION_STATES.has(sessionStatus?.state)) {
      try {
        await lerobotClient.adminMotorSetupStop();
      } catch {
        // keep reset flow
      }
    }
    setSessionPolling(false);
    setSessionStatus(null);
    nextLogIndexRef.current = 0;
    sessionStateRef.current = { sessionId: '', state: '' };
    setWizardStep(0);
    setMotorIndex(0);
    setIsLeaderFlow(false);
    setShowTroubleshoot(false);
    setTerminalLines([]);
  };

  const startFollower = () => {
    setWizardStep(1);
    addLine('$ ' + followerCommand.replaceAll('\n', '\n  '));
  };

  const startMotorSequence = async () => {
    setActionLoading(true);
    try {
      const status = await lerobotClient.adminMotorSetupStart({
        flow: 'follower',
        port: serialPort,
      });
      setSessionStatus(status);
      syncWizardFromSession(status);
      setSessionPolling(true);
      await refreshSessionLogs({ forceTail: true });
      addLine('Follower kol kurulumu basladi. Her adimda yalnizca tek motor baglayin.');
    } catch (error) {
      const msg = error?.body?.message || error?.message || 'Follower kurulum baslatilamadi';
      addLine(`ERROR: ${msg}`);
      setShowTroubleshoot(true);
    } finally {
      setActionLoading(false);
    }
  };

  const continueMotorStep = async () => {
    setActionLoading(true);
    try {
      const status = await lerobotClient.adminMotorSetupEnter(1);
      setSessionStatus(status);
      syncWizardFromSession(status);
      await refreshSessionLogs();
    } catch (error) {
      const msg = error?.body?.message || error?.message || 'Enter gonderilemedi';
      addLine(`ERROR: ${msg}`);
      setShowTroubleshoot(true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMotorError = async () => {
    setShowTroubleshoot(true);
    addLine(`HATA: ${currentMotor.key} (ID=${currentMotor.id}) ayarlanamadi. Kablolari ve gucu kontrol edin.`);
    if (RUNNING_SESSION_STATES.has(sessionStatus?.state)) {
      try {
        const status = await lerobotClient.adminMotorSetupStop();
        setSessionStatus(status);
        syncWizardFromSession(status);
        setSessionPolling(false);
        await refreshSessionLogs();
      } catch {
        // keep troubleshooting visible even if stop fails
      }
    }
  };

  const startLeader = () => {
    setWizardStep(4);
    addLine('$ ' + leaderCommand.replaceAll('\n', '\n  '));
  };

  const startLeaderMotorSequence = async () => {
    setActionLoading(true);
    try {
      const status = await lerobotClient.adminMotorSetupStart({
        flow: 'leader',
        port: leaderPort,
      });
      setSessionStatus(status);
      syncWizardFromSession(status);
      setSessionPolling(true);
      await refreshSessionLogs({ forceTail: true });
      addLine('Leader kol kurulumu basladi. Ayni motor sirasini tekrar edin.');
    } catch (error) {
      const msg = error?.body?.message || error?.message || 'Leader kurulum baslatilamadi';
      addLine(`ERROR: ${msg}`);
      setShowTroubleshoot(true);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Motor Kurulum Sihirbazı (SO-ARM101)</h1>
        <p style={styles.subtitle}>
          <code style={styles.code}>lerobot-setup-motors</code> ile motor ID ve baudrate değerlerini tek tek atayın. Değerler EEPROM'a yazılır.
        </p>
      </div>

      <div style={styles.rulesCard}>
        <h2 style={styles.cardTitle}>Genel Kurallar</h2>
        <ul style={styles.ruleList}>
          <li>Her adımda kontrol kartına yalnızca bir motor bağlı olmalıdır.</li>
          <li>Motor, başka bir motora zincirleme bağlı olmamalıdır.</li>
          <li>Enter basmadan önce 3-pin servo kablosunu ve güç kablosunu mutlaka kontrol edin.</li>
          <li>Motorlar başka bir robottan tekrar kullanılıyorsa bu kurulum zorunludur.</li>
        </ul>
      </div>

      {wizardStep === 0 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Adım 0 - Hazırlık</h2>
          <p style={styles.text}>Amaç: tüm servolar için benzersiz ID ve ortak baudrate ayarlamak.</p>
          <div style={styles.checkGrid}>
            <span>Bilgisayar</span><span>USB kablo</span><span>Güç kaynağı</span>
            <span>Kontrol kartı</span><span>Servo motorlar</span><span>3-pin servo kablolar</span>
          </div>

          <label style={styles.label}>Follower seri port</label>
          <input style={styles.input} value={serialPort} onChange={(e) => setSerialPort(e.target.value)} />

          <label style={styles.label}>Leader seri port</label>
          <input style={styles.input} value={leaderPort} onChange={(e) => setLeaderPort(e.target.value)} />

          {scanResult && (
            <div style={styles.scanBox}>
              <div>{scanResult.message}</div>
              <div style={styles.portsWrap}>
                {(scanResult.ports || []).length === 0 ? (
                  <span style={styles.warn}>Port bulunamadı</span>
                ) : (
                  scanResult.ports.map((p) => <code style={styles.portChip} key={p}>{p}</code>)
                )}
              </div>
            </div>
          )}

          <div style={styles.buttonRow}>
            <button style={styles.primaryBtn} onClick={startFollower} disabled={actionLoading}>Başlat</button>
            <button style={styles.secondaryBtn} onClick={checkSerialPorts} disabled={scanLoading || actionLoading}>
              {scanLoading ? 'Kontrol ediliyor...' : 'Seri Portu Kontrol Et'}
            </button>
            <button style={styles.dangerBtn} onClick={() => setShowTroubleshoot(true)}>Sorun Giderme</button>
          </div>
        </div>
      )}

      {wizardStep === 1 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Adım 1 - Kurulum Komutunu Çalıştır (Follower Kol)</h2>
          <p style={styles.text}>Bu komutu çalıştırın (gerekirse portu değiştirin):</p>
          <pre style={styles.commandBox}>{followerCommand}</pre>
          <div style={styles.buttonRow}>
            <button style={styles.primaryBtn} onClick={startMotorSequence} disabled={actionLoading}>Komut çalışıyor</button>
            <button style={styles.dangerBtn} onClick={() => setShowTroubleshoot(true)}>Port sorunu</button>
            <button style={styles.secondaryBtn} onClick={() => setWizardStep(0)}>Geri</button>
          </div>
        </div>
      )}

      {wizardStep === 2 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>
            Adım 2.{motorIndex + 1} - {currentMotor.key.toUpperCase()} (ID = {currentMotor.id}) {isLeaderFlow ? '[Lider]' : '[Takipçi]'}
          </h2>
          <p style={styles.text}>{currentMotor.instruction}</p>
          <div style={styles.warnBox}>
            <div>Yalnızca bu motor bağlı olmalıdır.</div>
            <div>Motor başka hiçbir motora bağlı olmamalıdır.</div>
            <div>Güç ve 3-pin kabloyu kontrol edin.</div>
            <div>Hazır olduğunuzda Enter basın.</div>
          </div>

          {currentMotor.hasWiringTip && (
            <div style={styles.tipBox}>
              İpucu: Gripper motor tarafında bağlı kalabilir. Sadece kontrol kartı tarafını bir sonraki motora taşıyın.
            </div>
          )}

          <div style={styles.expectedBox}>
            Beklenen terminal çıktısı: <code style={styles.code}>{currentMotor.expected}</code>
          </div>

          <div style={styles.buttonRow}>
            <button style={styles.primaryBtn} onClick={continueMotorStep} disabled={actionLoading}>
              {motorIndex === MOTOR_STEPS.length - 1 ? 'Enter bastım / Bitir' : 'Enter bastım / Devam'}
            </button>
            <button style={styles.dangerBtn} onClick={handleMotorError}>Hata aldım</button>
            <button style={styles.secondaryBtn} onClick={() => setShowTroubleshoot(true)}>Kabloları kontrol et</button>
          </div>
        </div>
      )}

      {wizardStep === 3 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Adım 3 - Bitiş (Follower Kol)</h2>
          <p style={styles.text}>Motor kurulumu tamamlandı. Artık tüm motorları zincirleyebilirsiniz.</p>
          <div style={styles.warnBox}>
            <div>Motorları sırayla zincirleyin.</div>
            <div>İlk motoru (shoulder_pan, ID=1) kontrol kartına bağlayın.</div>
            <div>Kontrol kartını kolun tabanına monte edin.</div>
          </div>
          <div style={styles.buttonRow}>
            <button style={styles.primaryBtn} onClick={startLeader}>Follower kol tamam</button>
          </div>
        </div>
      )}

      {wizardStep === 4 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Adım 4 - Leader Kol için Tekrarla</h2>
          <p style={styles.text}>Bu komutu çalıştırın, sonra aynı motor adımlarını birebir tekrar edin:</p>
          <pre style={styles.commandBox}>{leaderCommand}</pre>
          <div style={styles.buttonRow}>
            <button style={styles.primaryBtn} onClick={startLeaderMotorSequence} disabled={actionLoading}>Komut çalışıyor</button>
            <button style={styles.dangerBtn} onClick={() => setShowTroubleshoot(true)}>Port sorunu</button>
            <button style={styles.secondaryBtn} onClick={() => setWizardStep(3)}>Geri</button>
          </div>
        </div>
      )}

      {wizardStep === 5 && (
        <div style={styles.successCard}>
          <h2 style={styles.cardTitle}>Son Durum - Başarılı</h2>
          <div style={styles.successLine}>Tüm motorların ID değerleri benzersiz</div>
          <div style={styles.successLine}>Kontrol kartı ve motorlar aynı baudrate değerini kullanıyor</div>
          <div style={styles.successLine}>Motorlar kalibrasyon ve teleoperasyon için hazır</div>
          <div style={styles.buttonRow}>
            <button style={styles.primaryBtn} onClick={() => navigate('/kecy/platform/kalibrasyon')}>Kalibrasyona Geç</button>
            <button style={styles.secondaryBtn} onClick={resetWizard} disabled={actionLoading}>Kurulumu Tekrarla</button>
            <button style={styles.dangerBtn} onClick={() => setShowTroubleshoot(true)}>Sorun Giderme</button>
          </div>
        </div>
      )}

      <div style={styles.terminalCard}>
        <div style={styles.terminalTitle}>Sihirbaz Terminali</div>
        <div style={styles.terminalBody}>
          {terminalLines.length === 0 ? (
            <div style={styles.terminalMuted}>Henüz çıktı yok.</div>
          ) : (
            terminalLines.map((l, i) => (
              <div style={styles.terminalLine} key={`${l.ts}-${i}`}>
                <span style={styles.terminalTs}>[{l.ts}]</span>
                <span>{l.line}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {showTroubleshoot && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Sorun Giderme</h2>
          <ul style={styles.ruleList}>
            <li>Her adımda yalnızca tek motor kullanın. ID yazarken tüm zincir bağlantılarını çıkarın.</li>
            <li>Kontrol kartı gücünün stabil olduğunu ve 3-pin kablonun yönünün doğru olduğunu doğrulayın.</li>
            <li>Komutu çalıştırmadan önce <code style={styles.code}>Seri Portu Kontrol Et</code> ile port yolunu doğrulayın.</li>
            <li>Motor daha önce yapılandırıldıysa ID/baudrate üzerine yazmak için kurulumu tekrar çalıştırın.</li>
          </ul>
          <div style={styles.buttonRow}>
            <button style={styles.secondaryBtn} onClick={() => setShowTroubleshoot(false)}>Kapat</button>
          </div>
        </div>
      )}

      <div style={styles.sourceBox}>
        <span style={styles.sourceLabel}>Kaynak</span>
        <a
          href="https://huggingface.co/docs/lerobot/so101#configure-the-motors"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.sourceLink}
        >
          HuggingFace LeRobot - SO-101 Configure Motors
        </a>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    maxWidth: 920,
  },
  header: { display: 'flex', flexDirection: 'column', gap: 8 },
  title: {
    fontFamily: "'pptelegraf-regular', sans-serif",
    fontSize: 'clamp(24px, 4vw, 42px)',
    color: '#fff',
    lineHeight: 1.15,
    margin: 0,
  },
  subtitle: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    color: '#aaa',
    margin: 0,
    fontSize: 14,
    lineHeight: '1.6em',
  },
  card: {
    padding: '20px 22px',
    borderRadius: 12,
    border: '1px solid rgba(240,243,243,0.12)',
    background: 'rgba(255,255,255,0.03)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  rulesCard: {
    padding: '18px 20px',
    borderRadius: 12,
    border: '1px solid rgba(243,156,18,0.28)',
    background: 'rgba(243,156,18,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  successCard: {
    padding: '22px 24px',
    borderRadius: 12,
    border: '1px solid rgba(46,204,113,0.3)',
    background: 'rgba(46,204,113,0.08)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  cardTitle: {
    margin: 0,
    color: '#fff',
    fontFamily: "'pptelegraf-regular', sans-serif",
    fontSize: 20,
  },
  text: {
    margin: 0,
    color: '#bbb',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    lineHeight: '1.6em',
  },
  ruleList: {
    margin: 0,
    paddingLeft: 18,
    color: '#ddd',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    lineHeight: '1.8em',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  checkGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
    fontFamily: "'berkeleymonotrial-regular', monospace",
    color: '#ddd',
    fontSize: 12,
  },
  label: {
    color: '#9aa',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
  },
  input: {
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 8,
    color: '#fff',
    padding: '8px 10px',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    outline: 'none',
  },
  scanBox: {
    background: 'rgba(78,205,196,0.06)',
    border: '1px solid rgba(78,205,196,0.2)',
    borderRadius: 8,
    padding: '10px 12px',
    color: '#9fe8e1',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  portsWrap: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  portChip: {
    padding: '2px 7px',
    border: '1px solid rgba(159,232,225,0.35)',
    borderRadius: 6,
    fontSize: 11,
    background: 'rgba(0,0,0,0.25)',
  },
  warn: { color: '#f4c27f' },
  commandBox: {
    margin: 0,
    background: '#090909',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: '12px 14px',
    color: '#4ecdc4',
    whiteSpace: 'pre-wrap',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 12,
    lineHeight: '1.6em',
  },
  warnBox: {
    background: 'rgba(255,193,7,0.08)',
    border: '1px solid rgba(255,193,7,0.24)',
    borderRadius: 8,
    padding: '10px 12px',
    color: '#ffcf7f',
    fontSize: 12,
    lineHeight: '1.7em',
    fontFamily: "'berkeleymonotrial-regular', monospace",
  },
  tipBox: {
    background: 'rgba(78,205,196,0.08)',
    border: '1px solid rgba(78,205,196,0.24)',
    borderRadius: 8,
    padding: '10px 12px',
    color: '#99e7df',
    fontSize: 12,
    lineHeight: '1.7em',
    fontFamily: "'berkeleymonotrial-regular', monospace",
  },
  expectedBox: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '10px 12px',
    color: '#ccd',
    fontSize: 12,
    lineHeight: '1.6em',
    fontFamily: "'berkeleymonotrial-regular', monospace",
  },
  buttonRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  primaryBtn: {
    border: 'none',
    borderRadius: 8,
    padding: '9px 14px',
    background: 'linear-gradient(135deg, #4ecdc4, #3bbcae)',
    color: '#001414',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
  },
  secondaryBtn: {
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 8,
    padding: '9px 14px',
    background: 'rgba(255,255,255,0.04)',
    color: '#ddd',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
  },
  dangerBtn: {
    border: '1px solid rgba(231,76,60,0.35)',
    borderRadius: 8,
    padding: '9px 14px',
    background: 'rgba(231,76,60,0.13)',
    color: '#ff8f87',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
  },
  terminalCard: {
    background: '#0a0a0a',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  terminalTitle: {
    padding: '10px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    color: '#9aa',
    fontSize: 12,
    fontFamily: "'berkeleymonotrial-regular', monospace",
  },
  terminalBody: {
    maxHeight: 220,
    overflowY: 'auto',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  terminalLine: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    color: '#d7d7d7',
    fontSize: 12,
    display: 'flex',
    gap: 8,
  },
  terminalTs: {
    color: '#666',
    minWidth: 66,
    flexShrink: 0,
  },
  terminalMuted: {
    color: '#666',
    fontSize: 12,
    fontFamily: "'berkeleymonotrial-regular', monospace",
  },
  successLine: {
    color: '#c7f6da',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
    lineHeight: '1.7em',
  },
  sourceBox: {
    marginTop: 8,
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
  code: {
    fontFamily: "'berkeleymonotrial-regular', monospace",
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '1px 5px',
    color: '#d5e5ff',
    fontSize: 11,
  },
};

