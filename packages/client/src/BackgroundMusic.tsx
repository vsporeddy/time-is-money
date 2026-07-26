import { useEffect, useRef, useState } from 'react';
import { loadAudioSettings, saveAudioSettings } from './audioSettings';
import { setSfxEnabled } from './sound';

const MUSIC_SRC = `${import.meta.env.BASE_URL}sounds/music/menu.mp3`;
const HELP_MEDIA_SRC = `${import.meta.env.BASE_URL}`;
const NORMAL_VOLUME = 0.15;
const DUCKED_VOLUME = 0.04;
const CLEAR_FILTER_HZ = 20000;
const MUFFLED_FILTER_HZ = 600;
const RAMP_SECONDS = 0.4;

interface BackgroundMusicProps {
  ducked: boolean; // fade down for the whole round — pre-bid countdown through spending
  muffled: boolean; // low-pass filter for the main menu/lobby
  onOpenCredits: () => void;
  // Omitted entirely on the starting screen — there's nowhere to go back to yet.
  onMainMenu?: () => void;
}

export function BackgroundMusic({ ducked, muffled, onOpenCredits, onMainMenu }: BackgroundMusicProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const [audioSettings, setAudioSettings] = useState(loadAudioSettings);

  useEffect(() => {
    const audio = new Audio(MUSIC_SRC);
    audio.loop = true;
    audio.muted = !audioSettings.musicEnabled;
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
    setAudioSettings((settings) => {
      const nextSettings = { ...settings, musicEnabled: !audio.muted };
      saveAudioSettings(nextSettings);
      return nextSettings;
    });
  };

  const toggleSfx = () => {
    setAudioSettings((settings) => {
      const nextSettings = { ...settings, sfxEnabled: !settings.sfxEnabled };
      setSfxEnabled(nextSettings.sfxEnabled);
      saveAudioSettings(nextSettings);
      return nextSettings;
    });
  };

  return (
    <div className="top-controls">
      <button type="button" className="how-to-play-trigger" aria-label="How to play">
        ?
        <span className="how-to-play-tooltip" role="tooltip">
          <b>HOW TO PLAY</b>
          <span className="how-to-play-row">
            <img src={`${HELP_MEDIA_SRC}help-tooltip-playertime.png`} alt="Player time display" />
            <span>
              <b className="how-to-play-label">TIME IS MONEY</b>
              Your time is your money. Spend it by <b>bidding</b> on items.
            </span>
          </span>
          <span className="how-to-play-row">
            <img src={`${HELP_MEDIA_SRC}bid.gif`} alt="Joining a bid" />
            <span>
              <b className="how-to-play-label">JOINING</b>
              During the opening window, click <b>BID</b> to join or{' '}
              <b className="how-to-play-cancel">CANCEL BID</b> to leave.
            </span>
          </span>
          <span className="how-to-play-row">
            <img src={`${HELP_MEDIA_SRC}bid-underway.gif`} alt="Bidding underway" />
            <span>
              <b className="how-to-play-label">WHILE BIDDING</b>
              Once bidding starts, your time ticks down. Press <b>WITHDRAW</b> to stop. The time you spend is{' '}
              <b>lost whether you win or not</b>.
            </span>
          </span>
          <span className="how-to-play-row">
            <img src={`${HELP_MEDIA_SRC}bid-finish.gif`} alt="Auction finish" />
            <span>
              <b className="how-to-play-label">WINNING THE ITEM</b>
              The <b>last bidder remaining</b> wins the item. A sole bidder wins automatically with a 5s bid. If
              everyone holds until time runs out, it's a <b>stalemate</b> and the time is <b>refunded</b>.
            </span>
          </span>
          <span className="how-to-play-row">
            <img src={`${HELP_MEDIA_SRC}hover.gif`} alt="Hovering item details" />
            <span>
              <b className="how-to-play-label">ITEM DETAILS</b>
              <b>Hover</b> over attributes, modifiers and set bonuses for details.
            </span>
          </span>
          <span className="how-to-play-row">
            <img className="how-to-play-items-media" src={`${HELP_MEDIA_SRC}items.gif`} alt="Item inventory" />
            <span>
              <b className="how-to-play-label">SCORING</b>
              Collect items and complete sets. Item values, effects and set bonuses decide your collection's worth,
              and the <b>most valuable collection wins</b>. On a tie, the <b>smaller collection</b> wins, then
              whoever has the most time left.
            </span>
          </span>
        </span>
      </button>
      <button type="button" className="music-toggle" onClick={toggleMute}>
        {audioSettings.musicEnabled ? 'Music: On' : 'Music: Off'}
      </button>
      <button type="button" className="sfx-toggle" onClick={toggleSfx}>
        {audioSettings.sfxEnabled ? 'SFX: On' : 'SFX: Off'}
      </button>
      <button type="button" className="credits-toggle" onClick={onOpenCredits}>
        Credits
      </button>
      {onMainMenu && (
        <button type="button" className="main-menu-toggle" onClick={onMainMenu}>
          Main Menu
        </button>
      )}
    </div>
  );
}
