import { useMemo, useState } from 'react';
import SubPage from './SubPage';

const STORAGE_KEY = 'kecyai_so101_assembly_checklist_v1';

const STEPS = [
  { id: 'follower_base', label: 'Follower taban ve Joint-1 mekanik montaji tamamlandi' },
  { id: 'follower_arm', label: 'Follower Joint-2/3/4/5 + gripper montaji tamamlandi' },
  { id: 'leader_base', label: 'Leader taban ve handle mekanik montaji tamamlandi' },
  { id: 'leader_arm', label: 'Leader eklem montaji tamamlandi' },
  { id: 'cables', label: 'Kablo yonleri ve motor zincir sirasi dogrulandi' },
  { id: 'pre_motor_setup', label: 'Motor ID ayari oncesi tek-motor baglanti hazirligi yapildi' },
];

function loadChecklist() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export default function Assembly() {
  const [checked, setChecked] = useState(loadChecklist);

  const completed = useMemo(
    () => STEPS.reduce((count, step) => count + (checked[step.id] ? 1 : 0), 0),
    [checked]
  );

  const persist = (next) => {
    setChecked(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage write errors
    }
  };

  const toggle = (id) => {
    persist({ ...checked, [id]: !checked[id] });
  };

  const markAll = () => {
    const next = {};
    STEPS.forEach((step) => { next[step.id] = true; });
    persist(next);
  };

  const resetAll = () => {
    persist({});
  };

  return (
    <SubPage
      title="Montaj"
      description="SO-ARM101 follower ve leader montajini bu adim listesiyle takip edin. Tum adimlar tamamlandiginda motor ayarlarina gecin."
      sourceUrl="https://huggingface.co/docs/lerobot/so101#step-by-step-assembly-instructions"
      sourceLabel="SO-101 Docs -> Assembly Instructions"
    >
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <strong style={styles.title}>Montaj Kontrolu</strong>
          <span style={styles.progress}>{completed}/{STEPS.length} tamamlandi</span>
        </div>

        <div style={styles.list}>
          {STEPS.map((step, index) => (
            <label key={step.id} style={styles.item}>
              <input
                type="checkbox"
                checked={Boolean(checked[step.id])}
                onChange={() => toggle(step.id)}
              />
              <span>{index + 1}. {step.label}</span>
            </label>
          ))}
        </div>

        <div style={styles.actions}>
          <button style={styles.primaryBtn} onClick={markAll}>Hepsini Isaretle</button>
          <button style={styles.secondaryBtn} onClick={resetAll}>Sifirla</button>
        </div>
      </div>
    </SubPage>
  );
}

const styles = {
  card: {
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    color: '#f1f1f1',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontSize: 13,
  },
  title: {
    fontWeight: 700,
  },
  progress: {
    color: '#b3e8d9',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    fontFamily: "'berkeleymonotrial-regular', monospace",
    color: '#ddd',
    fontSize: 12,
  },
  item: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  actions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  primaryBtn: {
    border: 'none',
    borderRadius: 8,
    padding: '8px 12px',
    background: 'linear-gradient(135deg, #4ecdc4, #3bbcae)',
    color: '#001414',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
  },
  secondaryBtn: {
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 8,
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.04)',
    color: '#ddd',
    fontFamily: "'berkeleymonotrial-regular', monospace",
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
  },
};
