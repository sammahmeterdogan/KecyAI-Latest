/*
  Magnet
  Source: https://reactbits.dev/animation/magnet
*/
import React, { useRef, useState } from "react";
import { motion } from "framer-motion";

const Magnet = ({ children, padding = 20, disabled = false, magnetStrength = 20 }) => {
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const ref = useRef(null);

    const handleMouseMove = (e) => {
        const { clientX, clientY } = e;
        const { left, top, width, height } = ref.current.getBoundingClientRect();
        const x = ((clientX - (left + width / 2)) / width) * magnetStrength;
        const y = ((clientY - (top + height / 2)) / height) * magnetStrength;
        setPosition({ x, y });
    };

    const reset = () => {
        setPosition({ x: 0, y: 0 });
    };

    if (disabled) return <>{children}</>;

    return (
        <motion.div
            ref={ref}
            onMouseMove={handleMouseMove}
            onMouseLeave={reset}
            animate={{ x: position.x, y: position.y }}
            transition={{ type: "spring", stiffness: 150, damping: 15, mass: 0.1 }}
            style={{ display: "inline-block" }}
        >
            {children}
        </motion.div>
    );
};

export default Magnet;
