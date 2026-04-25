/**
 * MascotCelebrate — 2s celebration animation.
 *
 * Timeline (2s = 60 frames at 30fps):
 *   0-0.5s   (f0-15)   — crouch: scale 1 → 0.9, anticipation
 *   0.5-1.0s (f15-30)  — explode up: scale 0.9 → 1.15, translateY 0 → -80, rotate 0 → 360°
 *   1.0-1.5s (f30-45)  — apex hold: position peak, GOLD BURST fires
 *   1.5-2.0s (f45-60)  — return: scale 1.15 → 1.0, translateY -80 → 0, rotate settles
 *
 * Fully deterministic. No random — every frame always identical pixels.
 */

import React from 'react';
import { Img, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { GoldBurst, Sparkles } from './Sparkles';

export const MascotCelebrate: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animation keyframes (in frames at 30fps). 60 total frames = 2 seconds.
  const crouchEnd = 15;
  const peakFrame = 30;
  const holdEnd = 45;
  const endFrame = 60;

  // Scale curve: 1 → 0.9 → 1.15 → 1.0
  const scale = interpolate(
    frame,
    [0, crouchEnd, peakFrame, holdEnd, endFrame],
    [1.0, 0.9, 1.15, 1.10, 1.0],
    { easing: Easing.inOut(Easing.cubic), extrapolateRight: 'clamp' },
  );

  // Vertical translation: 0 → 0 → -80 → -80 → 0
  const translateY = interpolate(
    frame,
    [0, crouchEnd, peakFrame, holdEnd, endFrame],
    [0, 0, -80, -80, 0],
    { easing: Easing.inOut(Easing.cubic), extrapolateRight: 'clamp' },
  );

  // Rotation: 0 → 0 → 360 → 360 → 0 (the spin happens during the jump)
  const rotate = interpolate(
    frame,
    [0, crouchEnd, peakFrame, holdEnd, endFrame],
    [0, 0, 360, 360, 360],
    { easing: Easing.out(Easing.cubic), extrapolateRight: 'clamp' },
  );

  // Shadow inversely scales with height (bigger when character is low, smaller up high)
  const shadowScale = interpolate(
    frame,
    [0, crouchEnd, peakFrame, holdEnd, endFrame],
    [1.0, 1.1, 0.5, 0.5, 1.0],
    { easing: Easing.inOut(Easing.cubic), extrapolateRight: 'clamp' },
  );
  const shadowOpacity = interpolate(
    frame,
    [0, peakFrame, holdEnd, endFrame],
    [0.35, 0.15, 0.15, 0.35],
    { extrapolateRight: 'clamp' },
  );

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
        {/* Ambient sparkles — dimmer during celebrate so the gold burst steals the show */}
        <Sparkles frame={frame} fps={fps} color="#14F195" count={6} radiusMin={180} radiusMax={220} size={16} />

        {/* Shadow ellipse */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 20,
            width: 180,
            height: 20,
            marginLeft: -90,
            background: `radial-gradient(ellipse at center, rgba(0,0,0,${shadowOpacity}) 0%, rgba(0,0,0,0) 70%)`,
            transform: `scaleX(${shadowScale})`,
          }}
        />

        {/* Mascot — jumps, spins, returns */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 420,
            height: 420,
            marginLeft: -210,
            marginTop: -210,
            transform: `translateY(${translateY}px) scale(${scale}) rotate(${rotate}deg)`,
            transformOrigin: 'center center',
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

        {/* Gold burst — fires when mascot is at apex (frame 30), radiates outward until frame 54 */}
        <GoldBurst frame={frame} fps={fps} startFrame={peakFrame} duration={24} count={14} />
      </div>
    </div>
  );
};
