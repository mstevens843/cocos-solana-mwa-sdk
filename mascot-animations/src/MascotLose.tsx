/**
 * MascotLose — 2s defeat animation. Not loopable (plays once, settles).
 *
 * Timeline:
 *   0-0.3s (f0-9)   — static held pose
 *   0.3-1.0s (f9-30) — shoulders slump: translateY 0 → +16, saturation 1.0 → 0.4, slight rotate -4°
 *   1.0-2.0s (f30-60) — settle: position and state hold, puff of smoke appears above at f30-f48
 */

import React from 'react';
import { Img, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

export const MascotLose: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slumpStart = 9;
  const slumpEnd = 30;
  const smokeStart = 30;
  const smokeEnd = 48;

  // Vertical slump: 0 → +16
  const translateY = interpolate(
    frame,
    [0, slumpStart, slumpEnd],
    [0, 0, 16],
    { easing: Easing.inOut(Easing.cubic), extrapolateRight: 'clamp' },
  );
  // Slight rotation: 0 → -4° (defeated slump)
  const rotate = interpolate(
    frame,
    [0, slumpStart, slumpEnd],
    [0, 0, -4],
    { easing: Easing.inOut(Easing.cubic), extrapolateRight: 'clamp' },
  );
  // Saturation desaturate to communicate loss (1.0 = full color → 0.4 = dim)
  const saturation = interpolate(
    frame,
    [0, slumpStart, slumpEnd],
    [1.0, 1.0, 0.4],
    { easing: Easing.inOut(Easing.cubic), extrapolateRight: 'clamp' },
  );
  const brightness = interpolate(
    frame,
    [0, slumpStart, slumpEnd],
    [1.0, 1.0, 0.7],
    { easing: Easing.inOut(Easing.cubic), extrapolateRight: 'clamp' },
  );

  // Smoke puff above the head, from frame 30-48.
  const smokeProgress = interpolate(
    frame,
    [smokeStart, smokeEnd],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const smokeOpacity = smokeProgress < 0.5
    ? smokeProgress * 2
    : (1 - smokeProgress) * 2; // fade in, then fade out
  const smokeY = -100 - smokeProgress * 40;
  const smokeScale = 0.5 + smokeProgress * 0.8;

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
        {/* Shadow — slightly wider as mascot slumps down (body closer to ground) */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 20,
            width: 200,
            height: 22,
            marginLeft: -100,
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 70%)',
          }}
        />

        {/* Mascot — slumps, desaturates */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 420,
            height: 420,
            marginLeft: -210,
            marginTop: -210,
            transform: `translateY(${translateY}px) rotate(${rotate}deg)`,
            transformOrigin: 'center 80%',
            filter: `saturate(${saturation}) brightness(${brightness})`,
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

        {/* Smoke puff drifting up above the head */}
        {smokeProgress > 0 && smokeProgress < 1 && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 100,
              height: 100,
              marginLeft: -50,
              transform: `translateY(${smokeY}px) scale(${smokeScale})`,
              opacity: smokeOpacity,
            }}
          >
            <svg viewBox="0 0 100 100" width="100" height="100">
              <circle cx="35" cy="55" r="22" fill="#8a91a8" opacity="0.8" />
              <circle cx="55" cy="48" r="26" fill="#a8aec9" opacity="0.85" />
              <circle cx="70" cy="60" r="20" fill="#9ba2be" opacity="0.75" />
              <circle cx="50" cy="38" r="15" fill="#b5bbd4" opacity="0.7" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};
