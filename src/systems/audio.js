// Ambient audio — the ez-tree demo's ambience loop (MIT, birds + wind).
// Plain HTMLAudioElement: no Babylon audio engine needed, and Chrome's
// sticky user activation (the Enter World click) authorizes play().
let _amb = null;
let _paused = false;

export function initAmbience() {
  if (_amb) return;
  _amb = new Audio('./assets/sounds/ambience.mp3');
  _amb.loop = true;
  _amb.volume = 0.35;
  window._ambienceEl = _amb; // debug handle (automated tests can't reach module scope)
  _amb.play().catch(() => { /* no gesture yet — resumes via updateAmbience */ });
}

/** Called every frame from the main loop; pauses the loop with the sim. */
export function updateAmbience(frozen) {
  if (!_amb || frozen === _paused) return;
  _paused = frozen;
  if (frozen) _amb.pause();
  else _amb.play().catch(() => {});
}
