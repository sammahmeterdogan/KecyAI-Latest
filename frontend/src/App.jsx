import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import PlatformLayout from './pages/platform/PlatformLayout';
import Overview from './pages/platform/Overview';
import Parts from './pages/platform/Parts';
import Assembly from './pages/platform/Assembly';
import Motors from './pages/platform/Motors';
import Calibration from './pages/platform/Calibration';
import Teleop from './pages/platform/TeleopPage';
import Cameras from './pages/platform/Cameras';
import Dataset from './pages/platform/Dataset';
import Training from './pages/platform/Training';
import Inference from './pages/platform/Inference';
import Act from './pages/platform/Act';
import SmolVLA from './pages/platform/SmolVLA';
import Pi0 from './pages/platform/Pi0';
import CapabilityView from './pages/platform/CapabilityView';
import AdminPage from './pages/platform/AdminPage';

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/kecy/platform" element={<PlatformLayout />}>
                    <Route index element={<Overview />} />
                    <Route path="parca-listesi" element={<Parts />} />
                    <Route path="montaj" element={<Assembly />} />
                    <Route path="motor-ayarlar" element={<Motors />} />
                    <Route path="kalibrasyon" element={<Calibration />} />
                    <Route path="teleop" element={<Teleop />} />
                    <Route path="cameras" element={<Cameras />} />
                    <Route path="record" element={<Dataset />} />
                    <Route path="policy" element={<Training />} />
                    <Route path="inference" element={<Inference />} />
                    <Route path="models/act" element={<Act />} />
                    <Route path="models/smolvla" element={<SmolVLA />} />
                    <Route path="models/pi0" element={<Pi0 />} />
                    <Route path="admin" element={<AdminPage />} />
                    {/* Dynamic Capability Route */}
                    <Route path=":capId" element={<CapabilityView />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
