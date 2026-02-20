import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Global shim for third-party scripts that expect process/env in browser
if (!window.process) {
    window.process = { env: {} };
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
