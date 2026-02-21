import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
    const containerRef = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        let cleanupModal = () => {};
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

                // Hide broken logo assets to avoid broken image icons
                containerRef.current.querySelectorAll('.contact-hide-on-error').forEach((img) => {
                    img.onerror = () => {
                        img.style.display = 'none';
                    };
                });

                // Contact modal handlers
                const modal = containerRef.current.querySelector('#contact-modal');
                const openBtn = containerRef.current.querySelector('[data-contact-open]');
                const closeBtns = containerRef.current.querySelectorAll('[data-contact-close]');
                const statusEl = containerRef.current.querySelector('[data-contact-status]');
                const formEl = containerRef.current.querySelector('#contact-form');

                const openModal = () => {
                    if (!modal) return;
                    modal.classList.add('is-open');
                    modal.setAttribute('aria-hidden', 'false');
                };
                const closeModal = () => {
                    if (!modal) return;
                    modal.classList.remove('is-open');
                    modal.setAttribute('aria-hidden', 'true');
                };
                const escHandler = (e) => {
                    if (e.key === 'Escape') closeModal();
                };
                const submitHandler = (e) => {
                    e.preventDefault();
                    if (statusEl) {
                        statusEl.textContent = 'Mesajınız alındı. Teşekkürler!';
                    }
                    formEl?.reset();
                    setTimeout(() => {
                        if (statusEl) statusEl.textContent = '';
                        closeModal();
                    }, 1400);
                };

                if (openBtn) openBtn.addEventListener('click', openModal);
                closeBtns.forEach((btn) => btn.addEventListener('click', closeModal));
                if (modal) {
                    modal.addEventListener('click', (e) => {
                        const backdrop = modal.querySelector('.contact-modal__backdrop');
                        if (e.target === backdrop) closeModal();
                    });
                }
                if (formEl) formEl.addEventListener('submit', submitHandler);
                document.addEventListener('keydown', escHandler);

                // Load PeachWorlds runtime
                if (!document.querySelector('script[src="/script.js"]')) {
                    const pwScript = document.createElement('script');
                    pwScript.src = '/script.js';
                    pwScript.defer = true;
                    pwScript.fetchPriority = 'high';
                    document.head.appendChild(pwScript);
                }

                cleanupModal = () => {
                    if (openBtn) openBtn.removeEventListener('click', openModal);
                    closeBtns.forEach((btn) => btn.removeEventListener('click', closeModal));
                    if (formEl) formEl.removeEventListener('submit', submitHandler);
                    document.removeEventListener('keydown', escHandler);
                };
            });

        return () => {
            cleanupModal();
            // Cleanup: remove dynamically added scripts
            document.querySelectorAll('script[src="/script.js"]').forEach((s) => {
                if (s.parentNode === document.head) s.remove();
            });
        };
    }, [navigate]);

    return <div id="iedv" ref={containerRef} />;
}
