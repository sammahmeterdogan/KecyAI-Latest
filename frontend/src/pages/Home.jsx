import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
    const containerRef = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        // Set PeachWorlds initial path
        window._pwInitialPath = '/';
        // Minimal cache helpers expected by PeachWorlds runtime
        if (!window._pwFileCache) {
            window._pwFileCache = new Map();
        }
        if (!window._pwSetFileCache) {
            window._pwSetFileCache = (key, value) => {
                window._pwFileCache.set(key, value);
            };
        }
        if (!window._pwLoadFileFromCache) {
            window._pwLoadFileFromCache = async (key) => {
                if (window._pwFileCache.has(key)) {
                    return window._pwFileCache.get(key);
                }
                return key;
            };
        }
        // Fetch the original PeachWorlds HTML body content
        fetch('/home-content.html')
            .then((res) => res.text())
            .then((html) => {
                if (!containerRef.current) return;
                containerRef.current.innerHTML = html;

                // Patch CTA buttons to use React Router navigation
                containerRef.current.querySelectorAll('[onclick]').forEach((el) => {
                    const onclick = el.getAttribute('onclick');
                    if (onclick && onclick.includes('/kecy/platform')) {
                        el.removeAttribute('onclick');
                        el.style.cursor = 'pointer';
                        el.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            navigate('/kecy/platform');
                        });
                    }
                });

                // Strip inline scripts from injected HTML (reduce XSS surface)
                containerRef.current.querySelectorAll('script').forEach((script) => {
                    script.remove();
                });

                // Load PeachWorlds runtime
                if (!document.querySelector('script[src="/script.js"]')) {
                    const pwScript = document.createElement('script');
                    pwScript.src = '/script.js';
                    pwScript.defer = true;
                    pwScript.fetchPriority = 'high';
                    document.head.appendChild(pwScript);
                }
            });

        return () => {
            // Cleanup: remove dynamically added scripts
            document.querySelectorAll('script[src="/script.js"]').forEach((s) => {
                if (s.parentNode === document.head) s.remove();
            });
        };
    }, [navigate]);

    return <div id="iedv" ref={containerRef} />;
}
