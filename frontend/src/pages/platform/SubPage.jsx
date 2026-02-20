/* Shared subpage template for all platform subpages */
export default function SubPage({ title, description, sourceUrl, sourceLabel, children }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h1 style={{
                fontFamily: "'pptelegraf-regular', sans-serif",
                fontSize: 'clamp(24px, 4vw, 42px)',
                color: '#ffffff', letterSpacing: '-0.02em', lineHeight: 1.15, margin: 0,
            }}>
                {title}
            </h1>

            <p style={{
                fontFamily: "'berkeleymonotrial-regular', monospace",
                fontSize: 15, color: '#ccc', lineHeight: '1.7em', margin: 0, maxWidth: 680,
            }}>
                {description}
            </p>

            {children}

            {/* Source attribution */}
            <div style={{
                marginTop: 12, padding: '14px 18px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(240,243,243,0.08)',
                borderRadius: 10,
                display: 'flex', flexDirection: 'column', gap: 6,
            }}>
                <span style={{
                    fontFamily: "'berkeleymonotrial-regular', monospace",
                    fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                    Kaynak
                </span>
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{
                    fontFamily: "'berkeleymonotrial-regular', monospace",
                    fontSize: 13, color: '#cecafb', textDecoration: 'none',
                    transition: 'color 200ms',
                    wordBreak: 'break-all',
                }} onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#cecafb'; }}>
                    {sourceLabel || sourceUrl} ↗
                </a>
            </div>

            {/* Placeholder notice */}
            <div style={{
                fontFamily: "'berkeleymonotrial-regular', monospace",
                fontSize: 12, color: '#555', fontStyle: 'italic', marginTop: 4,
            }}>
                İçerik upstream kaynaklardan aktarılacaktır.
            </div>
        </div>
    );
}
