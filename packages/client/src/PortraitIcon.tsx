import { useEffect, useRef } from 'react';
import { PORTRAIT_COLUMNS, PORTRAIT_SIZE } from 'shared';

let sheetImage: HTMLImageElement | null = null;
function getSheet() {
  if (!sheetImage) {
    sheetImage = new Image();
    sheetImage.src = `${import.meta.env.BASE_URL}portraits.png`;
  }
  return sheetImage;
}

// Rendered at a low internal resolution, then CSS-upscaled with
// image-rendering: pixelated — gives the detailed source art a chunky
// retro look instead of a smooth downscale of the original painting.
const RENDER_SIZE = 64;

export function PortraitIcon({ index, size = 120 }: { index: number; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const img = getSheet();
    const draw = () => {
      const col = index % PORTRAIT_COLUMNS;
      const row = Math.floor(index / PORTRAIT_COLUMNS);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, RENDER_SIZE, RENDER_SIZE);
      ctx.drawImage(img, col * PORTRAIT_SIZE, row * PORTRAIT_SIZE, PORTRAIT_SIZE, PORTRAIT_SIZE, 0, 0, RENDER_SIZE, RENDER_SIZE);
    };

    if (img.complete) draw();
    else img.addEventListener('load', draw, { once: true });
  }, [index]);

  return (
    <canvas
      ref={canvasRef}
      width={RENDER_SIZE}
      height={RENDER_SIZE}
      className="portrait-icon"
      style={{ width: size, height: size }}
    />
  );
}
