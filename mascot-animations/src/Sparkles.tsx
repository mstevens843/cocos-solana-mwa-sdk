/**
 * Sparkles.tsx — deterministic particle effect component.
 *
 * Renders a fixed set of small 4-point star sparkles drifting around the
 * mascot. Each sparkle's position + opacity is a pure function of the
 * current frame, so playback is pixel-deterministic.
 *
 * Params:
 *   frame     — current frame (from useCurrentFrame)
 *   count     — number of sparkles (default 8)
 *   color     — hex color
 *   speed     — motion cycles per second (default 0.4 — slow ambient)
 *   radiusMin — inner radius of sparkle circle
 *   radiusMax — outer radius (sparkles oscillate between)
 *   size      — sparkle glyph size in px
 */

import React from 'react';

type Props = {
  frame: number;
  count?: number;
  color?: string;
  speed?: number;
  radiusMin?: number;
  radiusMax?: number;
  size?: number;
  fps?: number;
};

export const Sparkles: React.FC<Props> = ({
  frame,
  count = 8,
  color = '#14F195',
  speed = 0.4,
  radiusMin = 170,
  radiusMax = 210,
  size = 22,
  fps = 30,
}) => {
  const t = frame / fps;

  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const baseAngle = (i / count) * Math.PI * 2;
        const phase = i * 0.37; // deterministic offset per sparkle
        const r = radiusMin + (Math.sin(t * speed * Math.PI * 2 + phase) * 0.5 + 0.5) * (radiusMax - radiusMin);
        const wobble = Math.sin(t * speed * Math.PI * 4 + phase * 2) * 0.15;
        const angle = baseAngle + wobble;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        const twinkle = (Math.sin(t * 2 + phase * 3) * 0.5 + 0.5) * 0.7 + 0.3;
        const rotate = (t * 20 + i * 45) % 360;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              transform: `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${twinkle})`,
              opacity: twinkle,
              pointerEvents: 'none',
            }}
          >
            <SparkleGlyph color={color} size={size} />
          </div>
        );
      })}
    </>
  );
};

/** 4-point star sparkle, inline SVG. */
const SparkleGlyph: React.FC<{ color: string; size: number }> = ({ color, size }) => (
  <svg width={size} height={size} viewBox="-50 -50 100 100" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M 0 -45 L 10 -10 L 45 0 L 10 10 L 0 45 L -10 10 L -45 0 L -10 -10 Z"
      fill={color}
    />
  </svg>
);

/**
 * Gold burst — radial explosion of stars for the celebrate animation.
 * Stars travel outward from center, fade out as they go.
 */
export const GoldBurst: React.FC<{ frame: number; fps: number; startFrame: number; duration: number; count?: number }> = ({
  frame,
  fps,
  startFrame,
  duration,
  count = 12,
}) => {
  const burstFrame = frame - startFrame;
  if (burstFrame < 0 || burstFrame > duration) return null;
  const progress = burstFrame / duration; // 0..1
  const ease = 1 - Math.pow(1 - progress, 3); // cubic ease-out
  const fade = 1 - progress;

  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const distance = ease * 260;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance;
        const rotate = ease * 540 + i * 30;
        const scale = 0.2 + ease * 1.0;
        const color = i % 2 === 0 ? '#FFD24A' : '#FFB454'; // alternating gold/amber
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 40,
              height: 40,
              marginLeft: -20,
              marginTop: -20,
              transform: `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${scale})`,
              opacity: fade,
              pointerEvents: 'none',
            }}
          >
            <SparkleGlyph color={color} size={40} />
          </div>
        );
      })}
    </>
  );
};
