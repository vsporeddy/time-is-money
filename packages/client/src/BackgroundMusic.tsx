import { useEffect, useRef, useState } from 'react';

const MUSIC_SRC = `${import.meta.env.BASE_URL}sounds/music/menu.mp3`;
const NORMAL_VOLUME = 0.15;
const DUCKED_VOLUME = 0.04;
const CLEAR_FILTER_HZ = 20000;
const MUFFLED_FILTER_HZ = 600;
const RAMP_SECONDS = 0.4;

interface BackgroundMusicProps {
  ducked: boolean; // fade down for the whole round — pre-bid countdown through spending
  muffled: boolean; // low-pass filter for the main menu/lobby
}

export function BackgroundMusic({ ducked, muffled }: BackgroundMusicProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const audio = new Audio(MUSIC_SRC);
    audio.loop = true;
    audioRef.current = audio;

    // Routed through a filter (muffled in menus) and a gain node (ducked
    // while the coin cue plays) instead of the plain element volume.
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = CLEAR_FILTER_HZ;
    const gain = ctx.createGain();
    gain.gain.value = NORMAL_VOLUME;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    ctxRef.current = ctx;
    filterRef.current = filter;
    gainRef.current = gain;

    // Autoplay with sound is blocked until a user gesture — start on the first one.
    const startOnGesture = () => {
      ctx.resume().catch(() => {});
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
      ctx.close().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const gain = gainRef.current;
    const ctx = ctxRef.current;
    if (!gain || !ctx) return;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(ducked ? DUCKED_VOLUME : NORMAL_VOLUME, ctx.currentTime + RAMP_SECONDS);
  }, [ducked]);

  useEffect(() => {
    const filter = filterRef.current;
    const ctx = ctxRef.current;
    if (!filter || !ctx) return;
    filter.frequency.cancelScheduledValues(ctx.currentTime);
    filter.frequency.setValueAtTime(filter.frequency.value, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(muffled ? MUFFLED_FILTER_HZ : CLEAR_FILTER_HZ, ctx.currentTime + RAMP_SECONDS);
  }, [muffled]);

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  };

  return (
    <div className="top-controls">
      <button type="button" className="how-to-play-trigger" aria-label="How to play">
        ?
        <span className="how-to-play-tooltip" role="tooltip">
          <b>HOW TO PLAY</b>
          <span>Your remaining time is both your budget and your bid.</span>
          <span>During the opening window, click BID to opt in or CANCEL BID to leave.</span>
          <span>When bidding starts, your remaining time will start ticking down. Press withdraw to stop spending time. Regardless of whether you win the bid, the time spent will be lost. The last bidder remaining wins the item. A sole winner will automatically win the item with a 5s bid.</span>
          <span>Collect valuable items and complete sets. A combination of your base item values, item effects, and set bonuses will determine your final value. The highest total value wins after all rounds have finished.</span>
          <span>Hover over attributes/modifiers/set bonus bubbles for details.</span>
        </span>
      </button>
      <button type="button" className="music-toggle" onClick={toggleMute}>
        {muted ? 'Music: Off' : 'Music: On'}
      </button>
    </div>
  );
}
