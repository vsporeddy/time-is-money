import { useEffect, useRef } from 'react';
import { getSpriteSourceRect, SPRITE_SIZE } from './sprites';

let sheetImage: HTMLImageElement | null = null;
function getSheet() {
  if (!sheetImage) {
    sheetImage = new Image();
    sheetImage.src = '/sprites.png';
  }
  return sheetImage;
}

export function SpriteIcon({ index, scale = 2 }: { index: number; scale?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;

    const img = getSheet();
    const draw = () => {
      const { x, y, size } = getSpriteSourceRect(index);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, x, y, size, size, 0, 0, size * scale, size * scale);
    };

    if (img.complete) draw();
    else img.addEventListener('load', draw, { once: true });
  }, [index, scale]);

  return (
    <canvas
      ref={canvasRef}
      width={SPRITE_SIZE * scale}
      height={SPRITE_SIZE * scale}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
