import { useEffect, useRef } from "react";
import { Renderer, Camera, Transform, Plane, Program, Color } from "ogl";

/*
  Grainient (OGL Shader)
  Based on common gradient shader implementations.
*/

const vertex = `
  attribute vec2 uv;
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0, 1);
  }
`;

const fragment = `
  precision highp float;
  uniform float uTime;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform float uNoiseScale;
  uniform float uGrainAmount;
  uniform float uGrainScale;
  uniform bool uGrainAnimated;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uGamma;
  uniform float uWarpStrength;
  uniform float uWarpFrequency;
  uniform float uWarpSpeed;
  uniform float uWarpAmplitude;
  varying vec2 vUv;

  // Simplex noise function
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 uv = vUv;
    
    // Warp
    float time = uTime * uWarpSpeed;
    float noise = snoise(uv * uWarpFrequency + time * 0.1);
    vec2 warpedUv = uv + noise * uWarpStrength * (uWarpAmplitude * 0.01);
    
    // Gradient
    vec3 color = mix(uColor1, uColor2, warpedUv.x + warpedUv.y);
    color = mix(color, uColor3, snoise(warpedUv * 2.0));

    // Contrast/Saturation/Gamma
    color = pow(color, vec3(uGamma));
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    vec3 grey = vec3(lum);
    color = mix(grey, color, uSaturation);
    color = (color - 0.5) * uContrast + 0.5;

    // Grain
    float grainTime = uGrainAnimated ? uTime : 0.0;
    float grain = snoise(uv * uNoiseScale * uGrainScale + grainTime * 5.0);
    color += grain * uGrainAmount;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const Grainient = ({
    color1 = "#211c21",
    color2 = "#727274",
    color3 = "#d6d3de",
    timeSpeed = 0.25,
    uNoiseScale = 2,
    uGrainAmount = 0.1,
    uGrainScale = 2,
    uGrainAnimated = false,
    uContrast = 1.5,
    uGamma = 1,
    uSaturation = 1,
    uWarpStrength = 1,
    uWarpFrequency = 5,
    uWarpSpeed = 2,
    uWarpAmplitude = 50,
}) => {
    const ctnRef = useRef(null);

    useEffect(() => {
        if (!ctnRef.current) return;

        const renderer = new Renderer({ alpha: true, dpr: 2 });
        const gl = renderer.gl;
        gl.clearColor(0, 0, 0, 0);

        const container = ctnRef.current;
        container.appendChild(gl.canvas);

        const camera = new Camera(gl);
        camera.position.z = 1;

        function resize() {
            renderer.setSize(container.offsetWidth, container.offsetHeight);
            camera.perspective({ aspect: gl.canvas.width / gl.canvas.height });
        }

        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(container);

        const geometry = new Plane(gl, { width: 2, height: 2 });
        const program = new Program(gl, {
            vertex,
            fragment,
            uniforms: {
                uTime: { value: 0 },
                uColor1: { value: new Color(color1) },
                uColor2: { value: new Color(color2) },
                uColor3: { value: new Color(color3) },
                uNoiseScale: { value: uNoiseScale },
                uGrainAmount: { value: uGrainAmount },
                uGrainScale: { value: uGrainScale },
                uGrainAnimated: { value: uGrainAnimated },
                uContrast: { value: uContrast },
                uGamma: { value: uGamma },
                uSaturation: { value: uSaturation },
                uWarpStrength: { value: uWarpStrength },
                uWarpFrequency: { value: uWarpFrequency },
                uWarpSpeed: { value: uWarpSpeed },
                uWarpAmplitude: { value: uWarpAmplitude },
            },
        });

        const mesh = new Mesh(gl, { geometry, program });

        let animateId;
        function update(t) {
            animateId = requestAnimationFrame(update);
            program.uniforms.uTime.value = t * 0.001 * timeSpeed;
            renderer.render({ scene: mesh, camera });
        }
        animateId = requestAnimationFrame(update);

        return () => {
            cancelAnimationFrame(animateId);
            observer.disconnect();
            if (container.contains(gl.canvas)) {
                container.removeChild(gl.canvas);
            }
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        };
    }, [
        color1, color2, color3, timeSpeed,
        uNoiseScale, uGrainAmount, uGrainScale, uGrainAnimated,
        uContrast, uGamma, uSaturation,
        uWarpStrength, uWarpFrequency, uWarpSpeed, uWarpAmplitude
    ]);

    return <div ref={ctnRef} style={{ width: '100%', height: '100%' }} />;
};

// Start of OGL Mesh import (fixed missing import)
import { Mesh } from "ogl";

export default Grainient;
