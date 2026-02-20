import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ExternalLink, Terminal, AlertCircle } from 'lucide-react';
import { LeRobotClient } from '../../lib/api/lerobotClient';
import SpotlightCard from '../../components/reactbits/SpotlightCard';
import Magnet from '../../components/reactbits/Magnet';

const CapabilityView = () => {
    const { capId } = useParams();
    const [capability, setCapability] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchCap = async () => {
            setLoading(true);
            setError(null);
            try {
                // In a real app, we might fetch specific capability details.
                // Here we fetch the list and find the matching one to keep it simple as per "Hybrid dynamic" routing.
                const data = await LeRobotClient.getCapabilities();
                const cap = data.capabilities.find(c => c.id === capId);

                if (cap) {
                    setCapability(cap);
                } else {
                    setError('Capability not found or not enabled on this runtime.');
                }
            } catch (err) {
                setError(err.message || 'Failed to load capability details.');
            } finally {
                setLoading(false);
            }
        };

        fetchCap();
    }, [capId]);

    if (loading) {
        return (
            <div style={{ padding: '0 0', maxWidth: 800 }}>
                {/* Header Skeleton */}
                <div style={{ marginBottom: 32 }} className="animate-pulse">
                    <div style={{ width: 120, height: 24, borderRadius: 12, background: 'rgba(255,255,255,0.05)', marginBottom: 16 }} />
                    <div style={{ width: 300, height: 40, borderRadius: 8, background: 'rgba(255,255,255,0.08)', marginBottom: 12 }} />
                    <div style={{ width: '100%', height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.03)', marginBottom: 8 }} />
                    <div style={{ width: '80%', height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.03)' }} />
                </div>
                {/* Content Skeleton */}
                <div style={{
                    height: 120,
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: 12
                }} className="animate-pulse" />
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ef4444' }}>
                <AlertCircle size={48} strokeWidth={1.5} style={{ marginBottom: 16, opacity: 0.8 }} />
                <h3 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Unable to Load</h3>
                <p style={{ opacity: 0.7 }}>{error}</p>
            </div>
        );
    }

    if (!capability) return null;

    return (
        <div style={{ padding: '0 0', maxWidth: 800 }}>
            <header style={{ marginBottom: 32 }}>
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '6px 12px', borderRadius: 99,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    marginBottom: 16, fontSize: 13, color: '#aaa'
                }}>
                    <Terminal size={14} />
                    <span>Runtime Verified</span>
                </div>
                <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 12 }}>
                    {capability.title}
                </h1>
                <p style={{ fontSize: 16, lineHeight: 1.6, color: '#aaa', maxWidth: 600 }}>
                    This capability is active and verified on the connected LeRobot runtime.
                </p>
            </header>

            <SpotlightCard
                spotlightColor="rgba(16, 185, 129, 0.15)"
                className="capability-card"
            >
                <div style={{ padding: 24 }}>
                    <h3 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#666', marginBottom: 16 }}>
                        Source Verification
                    </h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px rgba(16,185,129,0.4)' }} />
                                <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#ddd' }}>
                                    {capability.source}
                                </span>
                            </div>
                            <Magnet padding={10} magnetStrength={5}>
                                <a
                                    href={`https://github.com/huggingface/lerobot/blob/main/${capability.source}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#888', textDecoration: 'none', transition: 'color 0.2s', padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.05)' }}
                                    onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                                    onMouseLeave={e => e.currentTarget.style.color = '#888'}
                                >
                                    <span style={{ borderBottom: '1px dotted currentColor' }}>View Source</span>
                                    <ExternalLink size={12} />
                                </a>
                            </Magnet>
                        </div>
                    </div>
                </div>
            </SpotlightCard>

            <div style={{ marginTop: 24, fontSize: 13, color: '#555', fontStyle: 'italic' }}>
                Note: Interaction UI for this capability is under development.
            </div>
        </div>
    );
};

export default CapabilityView;
