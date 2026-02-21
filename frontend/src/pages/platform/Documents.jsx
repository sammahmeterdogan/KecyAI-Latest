import SubPage from './SubPage';

export default function Documents() {
    return (
        <SubPage
            title="Documents"
            description="Kurulum, donanım, runtime ve API rehberleri tek yerde. Bu sayfa KECY Platform arayüzüyle aynı görsel tema ve yapıyı kullanır."
            sourceUrl="/documents"
            sourceLabel="KECY AI Documents"
        >
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
                marginTop: 4,
            }}>
                {[
                    { title: 'Kurulum', note: 'Docker, Windows, ilk çalıştırma' },
                    { title: 'Runtime', note: 'LeRobot + ROS2 servisleri' },
                    { title: 'API', note: 'Backend istekleri ve örnekler' },
                    { title: 'Robot Kit', note: 'SO-ARM101, kalibrasyon, sorun giderme' },
                ].map((item) => (
                    <div key={item.title} style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(240,243,243,0.08)',
                        borderRadius: 12,
                        padding: '16px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                    }}>
                        <span style={{
                            fontFamily: "'pptelegraf-regular', sans-serif",
                            fontSize: 16,
                            color: '#fff',
                        }}>
                            {item.title}
                        </span>
                        <span style={{
                            fontFamily: "'berkeleymonotrial-regular', monospace",
                            fontSize: 12,
                            color: '#a6a6a6',
                            lineHeight: 1.5,
                        }}>
                            {item.note}
                        </span>
                        <span style={{
                            fontFamily: "'berkeleymonotrial-regular', monospace",
                            fontSize: 11,
                            color: '#5f5f5f',
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                        }}>
                            Coming soon
                        </span>
                    </div>
                ))}
            </div>
        </SubPage>
    );
}
