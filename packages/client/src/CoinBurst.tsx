import { useEffect, useRef } from 'react';

let sheetImage: HTMLImageElement | null = null;
function getSheet() {
  if (!sheetImage) {
    sheetImage = new Image();
    sheetImage.src = `${import.meta.env.BASE_URL}coin2.png`;
  }
  return sheetImage;
}

// coin2.png is a horizontal strip of 16x16 spin frames.
const FRAME_SIZE = 16;
const FRAME_COUNT = 14;
const FRAME_DURATION_MS = 70;

const COIN_DRAW_SIZE = 32;
const COIN_LIFETIME_MS = 1100;
const SPAWN_INTERVAL_MS = 140;
// Canvas-local px per ms / px per ms^2.
const GRAVITY = 0.0005;

const CANVAS_WIDTH = 220;
const CANVAS_HEIGHT = 200;

type Coin = {
  bornAt: number;
  x0: number;
  vx: number;
  vy0: number;
  // Randomized so simultaneous coins don't spin in lockstep.
  frameOffset: number;
};

/**
 * Coins spewing up and out in parabolic arcs from behind the anchor element
 * (the local player's portrait), fading in and out over each coin's lifetime.
 * Draws on a fixed-position canvas so the dock's overflow clipping can't cut
 * the arcs off; negative z-index keeps it behind the player cards themselves.
 */
export function CoinBurst({ active }: { active: boolean }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const img = getSheet();
    const coins: Coin[] = [];
    let lastSpawnAt = 0;
    let rafId = 0;

    const spawn = (now: number) => {
      coins.push({
        bornAt: now,
        x0: CANVAS_WIDTH / 2 + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 0.12,
        vy0: -(0.25 + Math.random() * 0.12),
        frameOffset: Math.floor(Math.random() * FRAME_COUNT),
      });
    };

    const step = (now: number) => {
      // Track the portrait even while the dock scrolls or the window resizes.
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) {
        canvas.style.left = `${rect.left + rect.width / 2 - CANVAS_WIDTH / 2}px`;
        canvas.style.top = `${rect.top + rect.height / 2 - (CANVAS_HEIGHT - 20)}px`;
      }

      if (now - lastSpawnAt >= SPAWN_INTERVAL_MS) {
        lastSpawnAt = now;
        spawn(now);
      }

      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.imageSmoothingEnabled = false;

      for (let i = coins.length - 1; i >= 0; i--) {
        const coin = coins[i];
        const t = now - coin.bornAt;
        if (t >= COIN_LIFETIME_MS) {
          coins.splice(i, 1);
          continue;
        }
        const x = coin.x0 + coin.vx * t;
        // Emitter sits 20px above the canvas bottom, centered on the portrait.
        const y = CANVAS_HEIGHT - 20 + coin.vy0 * t + 0.5 * GRAVITY * t * t;
        const fadeIn = Math.min(1, t / 120);
        const fadeOut = Math.min(1, (COIN_LIFETIME_MS - t) / 350);
        const frame = (Math.floor(t / FRAME_DURATION_MS) + coin.frameOffset) % FRAME_COUNT;

        ctx.globalAlpha = Math.min(fadeIn, fadeOut);
        ctx.drawImage(
          img,
          frame * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE,
          Math.round(x - COIN_DRAW_SIZE / 2), Math.round(y - COIN_DRAW_SIZE / 2),
          COIN_DRAW_SIZE, COIN_DRAW_SIZE,
        );
      }
      ctx.globalAlpha = 1;

      rafId = requestAnimationFrame(step);
    };

    const start = () => {
      rafId = requestAnimationFrame(step);
    };
    if (img.complete) start();
    else img.addEventListener('load', start, { once: true });

    return () => {
      img.removeEventListener('load', start);
      cancelAnimationFrame(rafId);
    };
  }, [active]);

  return (
    <span ref={anchorRef} className="coin-burst-anchor" aria-hidden="true">
      {active && (
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="coin-burst-canvas"
        />
      )}
    </span>
  );
}
