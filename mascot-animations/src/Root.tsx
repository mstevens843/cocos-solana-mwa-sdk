/**
 * Root.tsx — Remotion composition registry.
 *
 * Four mascot animations for Token Duel. Each is deterministic + pixel-perfect;
 * frame N always renders identical pixels. Render to mp4 via `npm run render:*`
 * or to PNG frames via `npm run render:frames:*`.
 *
 * All compositions are 512×512, 30fps. Transparent background — the PNG alpha
 * is preserved through the render pipeline (JPEG format bakes white; use PNG
 * frames for correct alpha retention into Cocos).
 */

import './index.css';
import { Composition } from 'remotion';
import { MascotIdle } from './MascotIdle';
import { MascotCelebrate } from './MascotCelebrate';
import { MascotThink } from './MascotThink';
import { MascotLose } from './MascotLose';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MascotIdle"
        component={MascotIdle}
        durationInFrames={120}   // 4s @ 30fps (loopable)
        fps={30}
        width={512}
        height={512}
      />
      <Composition
        id="MascotCelebrate"
        component={MascotCelebrate}
        durationInFrames={60}    // 2s @ 30fps
        fps={30}
        width={512}
        height={512}
      />
      <Composition
        id="MascotThink"
        component={MascotThink}
        durationInFrames={90}    // 3s @ 30fps (loopable)
        fps={30}
        width={512}
        height={512}
      />
      <Composition
        id="MascotLose"
        component={MascotLose}
        durationInFrames={60}    // 2s @ 30fps
        fps={30}
        width={512}
        height={512}
      />
    </>
  );
};
