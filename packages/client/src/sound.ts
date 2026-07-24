const SFX_BASE = `${import.meta.env.BASE_URL}sounds/interface/`;

function playSfx(file: string, volume = 0.5) {
  const audio = new Audio(`${SFX_BASE}${file}`);
  audio.volume = volume;
  audio.play().catch(() => {}); // ignored — e.g. no user gesture yet
}

export function playClick() {
  playSfx('click.wav', 0.4);
}

export function playChatDing() {
  playSfx('ding.wav', 0.5);
}

export function playCoin() {
  playSfx('coin.wav', 0.2);
}

export function playWin() {
  playSfx('1up_a.wav', 0.5);
}

export function playLose() {
  playSfx('lose_a.wav', 0.5);
}
