
import React from 'react';
import { RotateCcw, Activity, GripHorizontal } from 'lucide-react';
import { INITIAL_JOINTS } from '../../teleop3d/teleopConstants';

const JointSlider = ({ label, value, min, max, onChange, unit = '°' }) => (
    <div className="group">
        <div className="flex justify-between text-[11px] font-mono text-white/50 mb-1.5 group-hover:text-white/70 transition-colors">
            <span>{label}</span>
            <span className="text-lime-400/80 group-hover:text-lime-400">{value.toFixed(1)}{unit}</span>
        </div>
        <div className="relative h-5 flex items-center">
            <div className="absolute w-full h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                    className="h-full bg-lime-500/30 group-hover:bg-lime-500/50 transition-colors"
                    style={{ width: `${((value - min) / (max - min)) * 100}%` }}
                />
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={0.1}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="absolute w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div
                className="absolute w-3 h-3 bg-lime-500 rounded-full shadow-[0_0_10px_rgba(132,204,22,0.4)] pointer-events-none transition-transform group-hover:scale-110"
                style={{ left: `calc(${((value - min) / (max - min)) * 100}% - 6px)` }}
            />
        </div>
    </div>
);

export default function ControlCard({ activeTab, setActiveTab, joints, handleJointChange, resetJoints, setJoints }) {
    return (
        <div className="glass-panel flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-white/5 bg-black/20">
                {['joints', 'cartesian'].map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 py-3 text-[11px] font-bold uppercase tracking-widest transition-all ${activeTab === tab
                                ? 'text-lime-400 bg-white/5 shadow-[inset_0_-2px_0_#84cc16]'
                                : 'text-white/30 hover:text-white/50 hover:bg-white/[0.02]'
                            }`}
                    >
                        {tab === 'joints' ? 'Joint Control' : 'Cartesian IK'}
                    </button>
                ))}
            </div>

            <div className="p-5 flex-1 overflow-y-auto custom-scrollbar">
                {activeTab === 'joints' ? (
                    <div className="space-y-5">
                        <div className="space-y-4">
                            <JointSlider label="J1: WAIST (PAN)" value={joints.base} min={-180} max={180} onChange={v => handleJointChange('base', v)} />
                            <JointSlider label="J2: SHOULDER (LIFT)" value={joints.shoulder} min={-180} max={180} onChange={v => handleJointChange('shoulder', v)} />
                            <JointSlider label="J3: ELBOW (FLEX)" value={joints.elbow} min={-180} max={180} onChange={v => handleJointChange('elbow', v)} />
                            <JointSlider label="J4: WRIST PITCH" value={joints.wristPitch} min={-180} max={180} onChange={v => handleJointChange('wristPitch', v)} />
                            <JointSlider label="J5: WRIST ROLL" value={joints.wristRoll} min={-180} max={180} onChange={v => handleJointChange('wristRoll', v)} />

                            <div className="pt-2">
                                <JointSlider label="GRIPPER" value={joints.gripper} min={0} max={100} unit="%" onChange={v => handleJointChange('gripper', v)} />
                            </div>
                        </div>

                        <div className="pt-4 border-t border-white/5 grid grid-cols-2 gap-2 mt-auto">
                            <button onClick={resetJoints} className="btn-glass-subtle py-2.5 text-xs flex items-center justify-center gap-2 hover:bg-white/10 hover:text-white">
                                <RotateCcw size={14} className="opacity-70" /> Home Pose
                            </button>
                            <button onClick={() => setJoints({ ...INITIAL_JOINTS, elbow: -45, wristPitch: 45 })} className="btn-glass-subtle py-2.5 text-xs flex items-center justify-center gap-2 hover:bg-white/10 hover:text-white">
                                <Activity size={14} className="opacity-70" /> Ready Pose
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center text-white/30 space-y-4">
                        <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-2">
                            <GripHorizontal size={32} className="opacity-50" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-white/60">Inverse Kinematics</p>
                            <p className="text-[11px] text-white/30 mt-1 max-w-[200px]">Interactive 3D control enabled. Drag the target sphere in viewport.</p>
                        </div>
                        <button className="px-4 py-2 rounded bg-lime-500/10 hover:bg-lime-500/20 text-lime-400 text-xs border border-lime-500/20 transition-all">
                            Enable IK Solver
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
