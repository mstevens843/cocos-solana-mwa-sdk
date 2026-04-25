/**
 * MascotThink — 3s loopable thinking animation.
 *
 * Motion:
 *   - Head tilt: rotation oscillates -6° → +6° → -6° over 3s (loopable)
 *   - Subtle vertical bob: ±4px, slower than idle
 *   - Ambient sparkles drift around (dimmer/slower than idle — character is focused)
 *   - A small "?" thought-bubble floats above at 50% cycle
 */

import React from 'react';
import { Img, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { Sparkles } from './Sparkles';

export const MascotThink: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;

  // 1 full tilt cycle over the whole duration
  const tiltCycle = (frame / durationInFrames) * Math.PI * 2;
  const rotate = Math.sin(tiltCycle) * 6; // degrees, -6 to +6
  const bobY = Math.sin(tiltCycle * 2) * 4; // 2x frequency for gentle bob

  // Thought bubble fades in at 25%, out at 75% of cycle
  const bubbleProgress = frame / durationInFrames;
  const bubbleOpacity = interpolate(
    bubbleProgress,
    [0, 0.2, 0.5, 0.8, 1.0],
    [0, 0.9, 1.0, 0.9, 0],
    { extrapolateRight: 'clamp' },
  );
  const bubbleFloat = Math.sin(tiltCycle * 3) * 4;

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
        {/* Ambient sparkles — slower/dimmer */}
        <Sparkles frame={frame} fps={fps} color="#14F195" count={6} speed={0.3} size={18} />

        {/* Shadow */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 20,
            width: 180,
            height: 18,
            marginLeft: -90,
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0) 70%)',
          }}
        />

        {/* Mascot — tilts left↔right with subtle bob */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 420,
            height: 420,
            marginLeft: -210,
            marginTop: -210,
            transform: `translateY(${bobY}px) rotate(${rotate}deg)`,
            transformOrigin: 'center 70%',
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

        {/* Thought bubble (?) floating above */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 30,
            width: 80,
            height: 80,
            marginLeft: 60,
            transform: `translateY(${bubbleFloat}px)`,
            opacity: bubbleOpacity,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg viewBox="0 0 100 100" width="80" height="80">
            <circle cx="50" cy="50" r="44" fill="#151929" stroke="#9945FF" strokeWidth="4" />
            <text
              x="50"
              y="65"
              fontSize="52"
              fontWeight="700"
              textAnchor="middle"
              fill="#F4F5F9"
              fontFamily="system-ui, sans-serif"
            >
              ?
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
};
