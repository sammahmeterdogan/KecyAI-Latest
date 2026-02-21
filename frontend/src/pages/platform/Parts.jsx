import { useMemo, useState } from 'react';
import SubPage from './SubPage';

const STORAGE_KEY = 'kecyai_so101_parts_checklist_v1';

const PARTS = [
  { id: 'motors', label: '6x Feetech STS3215 servo motor (follower kol)' },
  { id: 'boards', label: 'Kontrol kartlari + USB kablolar' },
  { id: 'power', label: 'Guc kaynagi ve motor kablolari' },
  { id: 'prints', label: '3D baski parcalari (arm + handle setleri)' },
  { id: 'fasteners', label: 'Vida/somun/spacer gibi mekanik baglantilar' },
  { id: 'tools', label: 'Montaj aletleri (alyan, tornavida, pense)' },
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

export default function Parts() {
  const [checked, setChecked] = useState(loadChecklist);

  const completed = useMemo(
    () => PARTS.reduce((count, item) => count + (checked[item.id] ? 1 : 0), 0),
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
    PARTS.forEach((item) => { next[item.id] = true; });
    persist(next);
  };

  const resetAll = () => {
    persist({});
  };

  return (
    <SubPage
      title="Parca Listesi"
      description="SO-ARM101 kurulumundan once fiziksel BOM hazirligini bu kontrol listesiyle tamamlayin."
      sourceUrl="https://huggingface.co/docs/lerobot/so101#source-the-parts"
      sourceLabel="SO-101 Docs -> Source the Parts"
    >
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <strong style={styles.title}>Hazirlik Durumu</strong>
          <span style={styles.progress}>{completed}/{PARTS.length} tamamlandi</span>
        </div>

        <div style={styles.list}>
          {PARTS.map((item) => (
            <label key={item.id} style={styles.item}>
              <input
                type="checkbox"
                checked={Boolean(checked[item.id])}
                onChange={() => toggle(item.id)}
              />
              <span>{item.label}</span>
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
