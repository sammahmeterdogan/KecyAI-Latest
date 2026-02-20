import SubPage from './SubPage';
import { Link } from 'react-router-dom';
import { NAV_CONFIG } from './navConfig';

export default function Overview() {
    const features = NAV_CONFIG.flatMap((s) => s.items).filter((i) => i.path !== '/kecy/platform');
    return (
        <SubPage
            title="KECY Platform"
            description="Tarayıcı tabanlı robotik stüdyosu. Simülasyon, hareket planlama ve fiziksel robot kontrolünü tek bir arayüzde birleştirir. SO-ARM101 (so101) robot kolu için LeRobot entegrasyonu sağlar."
            sourceUrl="https://huggingface.co/docs/lerobot/so101"
            sourceLabel="LeRobot SO-101 Docs"
        >
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 12, marginTop: 8,
            }}>
                {features.map((item) => (
                    <Link key={item.path} to={item.path} style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(240,243,243,0.08)',
                        borderRadius: 10, padding: '16px 14px',
                        textDecoration: 'none', color: '#cecafb',
                        fontFamily: "'berkeleymonotrial-regular', monospace", fontSize: 13,
                        transition: 'border-color 300ms, background 300ms',
                        display: 'flex', alignItems: 'center', gap: 8,
                    }} onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(206,202,251,0.35)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
                    }} onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(240,243,243,0.08)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                    }}>
                        {item.label}
                    </Link>
                ))}
            </div>
        </SubPage>
    );
}
