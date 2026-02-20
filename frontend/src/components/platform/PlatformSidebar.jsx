import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    List,
    Wrench,
    Settings,
    Target,
    Gamepad2,
    Camera,
    Database,
    GraduationCap,
    GitBranch,
    Box,
    ChevronRight,
    PanelLeftClose,
    PanelLeftOpen,
    Shield,
} from 'lucide-react';
import styles from './PlatformSidebar.module.css';

/**
 * Minimal tooltip (no deps). Only used in collapsed mode.
 */
function Tooltip({ text, anchorRect }) {
    if (!text || !anchorRect) return null;
    const top = anchorRect.top + anchorRect.height / 2;
    const left = anchorRect.right + 12;
    return (
        <div className={styles.tooltip} style={{ top, left }}>
            {text}
        </div>
    );
}

// Static fallback nav (used if capabilities not loaded or missing)
const FALLBACK_SECTIONS = [
    {
        id: 'main',
        items: [
            { id: 'genel', name: 'Genel Bakış', icon: LayoutDashboard, to: '/kecy/platform' },
            { id: 'parca', name: 'Parça Listesi', icon: List, to: '/kecy/platform/parca-listesi' },
            { id: 'montaj', name: 'Montaj', icon: Wrench, to: '/kecy/platform/montaj' },
            { id: 'motor', name: 'Motor Ayarları', icon: Settings, to: '/kecy/platform/motor-ayarlar' },
            { id: 'kalibrasyon', name: 'Kalibrasyon', icon: Target, to: '/kecy/platform/kalibrasyon' },
        ],
    },
    {
        id: 'kullanim',
        title: 'KULLANIM',
        items: [
            { id: 'teleop', name: 'Teleoperasyon', icon: Gamepad2, to: '/kecy/platform/teleop' },
            { id: 'cameras', name: 'Kameralar', icon: Camera, to: '/kecy/platform/cameras' },
            { id: 'record', name: 'Veri Toplama', icon: Database, to: '/kecy/platform/record' },
        ],
    },
    {
        id: 'egitim',
        title: 'EĞİTİM',
        items: [
            { id: 'policy', name: 'Politika Eğitimi', icon: GraduationCap, to: '/kecy/platform/policy' },
            { id: 'inference', name: 'Çıkarım & Test', icon: GitBranch, to: '/kecy/platform/inference' },
        ],
    },
    {
        id: 'modeller',
        title: 'MODELLER',
        items: [
            { id: 'act', name: 'ACT', icon: Box, to: '/kecy/platform/models/act' },
            { id: 'smolvla', name: 'SmolVLA', icon: Box, to: '/kecy/platform/models/smolvla' },
            { id: 'pi0', name: 'Pi0', icon: Box, to: '/kecy/platform/models/pi0' },
        ],
    },
    {
        id: 'admin',
        title: 'ADMIN',
        items: [
            { id: 'admin', name: 'Hardware Admin', icon: Shield, to: '/kecy/platform/admin' },
        ],
    },
];

function groupCapabilitiesIntoSections(capabilities) {
    // Keep it simple and safe: only map what we can recognize.
    // If your existing backend already returns categories, use them here.
    // Expected capability shape (example): { id, title, route, category }
    if (!Array.isArray(capabilities) || capabilities.length === 0) return null;

    // Deep clone safely (JSON.stringify destroys React components/icons)
    const base = FALLBACK_SECTIONS.map(section => ({
        ...section,
        items: section.items.map(item => ({ ...item }))
    }));

    const byCat = (cap) => {
        const c = (cap.category || cap.group || cap.type || '').toString().toLowerCase();
        const t = (cap.title || cap.name || '').toString().toLowerCase();
        if (c.includes('model') || t.includes('act') || t.includes('vla') || t.includes('pio')) return 'modeller';
        if (c.includes('train') || c.includes('policy') || t.includes('eğit') || t.includes('train')) return 'egitim';
        if (c.includes('use') || c.includes('teleop') || c.includes('record') || t.includes('teleop') || t.includes('kamera') || t.includes('veri')) return 'kullanim';
        return 'main';
    };

    // Replace fallback entries when capability provides a route
    for (const cap of capabilities) {
        if (!cap || !cap.route) continue;
        const sectionId = byCat(cap);
        const sec = base.find(s => s.id === sectionId);
        if (!sec) continue;

        // pick icon by keywords (safe fallback)
        const title = cap.title || cap.name || cap.id;
        const id = cap.id || title;
        const route = cap.route;

        let icon = Box;
        const key = (title || '').toLowerCase();
        if (key.includes('teleop')) icon = Gamepad2;
        else if (key.includes('kamera') || key.includes('camera')) icon = Camera;
        else if (key.includes('veri') || key.includes('record') || key.includes('data')) icon = Database;
        else if (key.includes('kalibr')) icon = Target;
        else if (key.includes('montaj') || key.includes('assembly')) icon = Wrench;
        else if (key.includes('parça') || key.includes('parts')) icon = List;
        else if (key.includes('motor') || key.includes('settings')) icon = Settings;
        else if (key.includes('genel') || key.includes('overview')) icon = LayoutDashboard;
        else if (key.includes('policy') || key.includes('train')) icon = GraduationCap;
        else if (key.includes('test') || key.includes('inference') || key.includes('evaluate')) icon = GitBranch;

        // If same route exists in fallback, update it; otherwise append.
        const existing = sec.items.find(x => x.to === route || x.id === id);
        if (existing) {
            existing.name = title;
            existing.to = route;
            existing.icon = icon;
            existing.id = id;
        } else {
            sec.items.push({ id, name: title, to: route, icon });
        }
    }

    return base;
}

export default function PlatformSidebar({
    capabilities,
    runtimeOnline,
    runtimeSha,
    appVersion = 'v2.1.0',
}) {
    const location = useLocation();

    const [collapsed, setCollapsed] = useState(() => {
        try {
            return localStorage.getItem('kecy.sidebar.collapsed') === '1';
        } catch {
            return false;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem('kecy.sidebar.collapsed', collapsed ? '1' : '0');
        } catch {
            // ignore
        }
    }, [collapsed]);

    const sections = useMemo(() => {
        const mapped = groupCapabilitiesIntoSections(capabilities);
        return mapped || FALLBACK_SECTIONS;
    }, [capabilities]);

    // Tooltip handling (collapsed)
    const [tip, setTip] = useState({ text: '', rect: null });
    const tipTimer = useRef(null);

    const showTip = (text, el) => {
        if (!collapsed) return;
        if (tipTimer.current) window.clearTimeout(tipTimer.current);
        const rect = el?.getBoundingClientRect?.();
        tipTimer.current = window.setTimeout(() => setTip({ text, rect }), 80);
    };
    const hideTip = () => {
        if (tipTimer.current) window.clearTimeout(tipTimer.current);
        setTip({ text: '', rect: null });
    };

    return (
        <aside
            className={[
                styles.root,
                styles.font,
                collapsed ? styles.collapsed : styles.expanded,
            ].join(' ')}
        >
            <div className={styles.overlay} />

            <div className={styles.header}>
                <div className={styles.logoGradient}>
                    {collapsed ? 'K' : <>KECY<span className={styles.logoSubtle}>AI</span></>}
                </div>
                <div className={styles.statusRow}>
                    <div
                        className={styles.statusDot}
                        style={{ background: runtimeOnline ? 'rgb(52, 211, 153)' : 'rgb(239, 68, 68)' }}
                        title={runtimeOnline ? 'Runtime online' : 'Runtime offline'}
                    />
                    <div className={styles.statusText}>
                        {runtimeOnline ? 'Platform Active' : 'Platform Offline'}
                    </div>
                </div>
            </div>

            <nav className={[styles.nav, styles.scrollbar].join(' ')}>
                {sections.map((section, sectionIndex) => {
                    const divider = sectionIndex > 0 ? styles.sectionDivider : '';
                    return (
                        <div key={section.id} className={divider}>
                            {section.title && (
                                <div className={styles.sectionTitleWrap}>
                                    <div className={styles.sectionTitle}>{section.title}</div>
                                </div>
                            )}

                            <ul style={{ display: 'grid', gap: 2, padding: 0, margin: 0, listStyle: 'none' }}>
                                {section.items.map((item, itemIndex) => {
                                    const Icon = item.icon;
                                    const delayMs = sectionIndex * 80 + itemIndex * 40;

                                    return (
                                        <li key={item.id} className={styles.item} style={{ animationDelay: `${delayMs}ms` }}>
                                            <NavLink
                                                to={item.to}
                                                end={item.to === '/kecy/platform'}
                                                className={({ isActive }) => [styles.navLink, isActive ? styles.active : ''].join(' ')}
                                                onMouseEnter={(e) => showTip(item.name, e.currentTarget)}
                                                onMouseLeave={hideTip}
                                            >
                                                <span className={styles.leftBar} />
                                                <Icon className={styles.icon} strokeWidth={2.2} />
                                                <span className={[styles.label, styles.labelMuted].join(' ')}>{item.name}</span>
                                                {!collapsed && <ChevronRight className={styles.chev} strokeWidth={2} />}
                                            </NavLink>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}
            </nav>

            <div className={styles.footer}>
                <div className={styles.glass}>
                    <div className={styles.footerRow}>
                        <div>
                            <div className={styles.footerLabel}>System</div>
                            <div className={styles.footerValue}>
                                {runtimeOnline ? (runtimeSha ? runtimeSha.slice(0, 7) : 'online') : 'offline'} • {appVersion}
                            </div>
                        </div>

                        <button
                            className={styles.collapseBtn}
                            onClick={() => setCollapsed(v => !v)}
                            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                            title={collapsed ? 'Expand' : 'Collapse'}
                            onMouseEnter={(e) => showTip(collapsed ? 'Expand' : 'Collapse', e.currentTarget)}
                            onMouseLeave={hideTip}
                        >
                            {collapsed ? <PanelLeftOpen size={18} strokeWidth={2} /> : <PanelLeftClose size={18} strokeWidth={2} />}
                        </button>
                    </div>
                </div>
            </div>

            {collapsed && <Tooltip text={tip.text} anchorRect={tip.rect} />}
        </aside>
    );
}
