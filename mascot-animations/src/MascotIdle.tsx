/**
 * MascotIdle — 4s loopable idle animation.
 *
 * Motion:
 *   - Vertical bob: sine wave, ±8px, 3 full cycles over 4s
 *   - Scale breathe: ±2%, synced to bob
 *   - Slight shadow ellipse under character that pulses with bob
 *   - Ambient teal sparkles drift around the character (Sparkles component)
 *
 * Fully deterministic — same frame always renders identical pixels.
 */

import React from 'react';
import { Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Sparkles } from './Sparkles';

export const MascotIdle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps; // seconds
  const cycleProgress = (frame / durationInFrames) * Math.PI * 2 * 3; // 3 cycles over duration
  const bobY = Math.sin(cycleProgress) * 8;
  const scale = 1 + Math.sin(cycleProgress) * 0.02;
  const shadowScale = 1 - Math.sin(cycleProgress) * 0.08; // shadow shrinks as mascot rises

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Center everything on the composition origin */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 512,
          height: 512,
        }}
      >
        {/* Ambient sparkles */}
        <Sparkles frame={frame} fps={fps} color="#14F195" count={8} />

        {/* Shadow ellipse under the character */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 20,
            width: 180,
            height: 20,
            marginLeft: -90,
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 70%)',
            transform: `scaleX(${shadowScale})`,
          }}
        />

        {/* Mascot */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 420,
            height: 420,
            marginLeft: -210,
            marginTop: -210,
            transform: `translateY(${bobY}px) scale(${scale})`,
          }}
        >
          <Img
            src={staticFile('mascot-ref.png')}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />
        </div>
      </div>
    </div>
  );
};
