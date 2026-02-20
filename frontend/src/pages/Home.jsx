import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
    const containerRef = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        // Set PeachWorlds initial path
        window._pwInitialPath = '/';

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

                // Execute inline scripts that were injected as HTML
                containerRef.current.querySelectorAll('script').forEach((oldScript) => {
                    const newScript = document.createElement('script');
                    if (oldScript.src) {
                        newScript.src = oldScript.src;
                    } else {
                        newScript.textContent = oldScript.textContent;
                    }
                    oldScript.parentNode.replaceChild(newScript, oldScript);
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
