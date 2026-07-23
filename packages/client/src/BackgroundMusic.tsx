import { useEffect, useRef, useState } from 'react';

const MUSIC_SRC = `${import.meta.env.BASE_URL}sounds/music/menu.mp3`;

export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const audio = new Audio(MUSIC_SRC);
    audio.loop = true;
    audio.volume = 0.15;
    audioRef.current = audio;

    // Autoplay with sound is blocked until a user gesture — start on the first one.
    const startOnGesture = () => {
      audio.play().catch(() => {});
      window.removeEventListener('pointerdown', startOnGesture);
      window.removeEventListener('keydown', startOnGesture);
    };
    window.addEventListener('pointerdown', startOnGesture);
    window.addEventListener('keydown', startOnGesture);

    return () => {
      window.removeEventListener('pointerdown', startOnGesture);
      window.removeEventListener('keydown', startOnGesture);
      audio.pause();
    };
  }, []);

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  };

  return (
    <button className="music-toggle" onClick={toggleMute}>
      {muted ? 'Music: Off' : 'Music: On'}
    </button>
  );
}
