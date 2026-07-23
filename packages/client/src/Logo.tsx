import { SpriteIcon } from './SpriteIcon';

const HOURGLASS_SPRITE_INDEX = 175;

export function Logo({ scale = 4 }: { scale?: number }) {
  return (
    <div className="logo">
      <SpriteIcon index={HOURGLASS_SPRITE_INDEX} scale={scale} />
      <h1 className="logo-title">
        TIME is MONEY
        <small>a countdown auction</small>
      </h1>
    </div>
  );
}
