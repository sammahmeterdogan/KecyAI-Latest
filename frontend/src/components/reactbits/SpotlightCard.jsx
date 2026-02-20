/*
  SpotlightCard
  Source: https://reactbits.dev/card/spotlight-card
*/
import React, { useRef, useState } from "react";

const SpotlightCard = ({ children, className = "", spotlightColor = "rgba(255, 255, 255, 0.25)" }) => {
    const divRef = useRef(null);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [opacity, setOpacity] = useState(0);

    const handleMouseMove = (e) => {
        if (!divRef.current || !divRef.current.parentElement) return;

        const rect = divRef.current.getBoundingClientRect();
        setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    const handleFocus = () => {
        setOpacity(1);
    };

    const handleBlur = () => {
        setOpacity(0);
    };

    const handleMouseEnter = () => {
        setOpacity(1);
    };

    const handleMouseLeave = () => {
        setOpacity(0);
    };

    return (
        <div
            ref={divRef}
            onMouseMove={handleMouseMove}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className={className}
            style={{
                position: "relative",
                overflow: "hidden",
                borderRadius: "inherit",
                border: "1px solid rgba(255,255,255,0.1)",
                backgroundColor: "rgba(255,255,255,0.02)",
            }}
        >
            <div
                style={{
                    pointerEvents: "none",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    opacity,
                    width: "100%",
                    height: "100%",
                    background: `radial-gradient(600px circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 40%)`,
                    transition: "opacity 0.2s",
                    zIndex: 0,
                }}
            />
            <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
        </div>
    );
};

export default SpotlightCard;
