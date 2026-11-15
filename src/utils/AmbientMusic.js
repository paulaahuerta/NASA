const musicByGame = new WeakMap();

export function getAmbientMusic(game) {
  if (!musicByGame.has(game)) {
    const music = new AmbientMusic(game.sound);
    musicByGame.set(game, music);
    game.events.once('destroy', () => music.destroy());
  }
  return musicByGame.get(game);
}

export default class AmbientMusic {
  constructor(soundManager) {
    const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    this.context = soundManager.context ?? (AudioContext ? new AudioContext() : null);
    this.ownsContext = Boolean(this.context && !soundManager.context);
    this.enabled = Boolean(this.context);
    this.paused = false;
    this.volume = 0.65;
    this.destroyed = false;
    if (!this.context) return;

    this.output = this.context.createGain();
    this.output.gain.value = 0;
    this.output.connect(this.context.destination);
    this.abortController = new AbortController();
  }

  updateVolume() {
    if (!this.context) return;
    this.output.gain.setTargetAtTime(this.enabled && !this.paused ? this.volume : 0, this.context.currentTime, 0.1);
  }

  load() {
    if (this.loading) return;
    const url = `${import.meta.env.BASE_URL}assets/audio/space-ambient.wav`;
    this.loading = fetch(url, { signal: this.abortController.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
        return response.arrayBuffer();
      })
      .then((bytes) => this.context.decodeAudioData(bytes))
      .then((buffer) => {
        if (this.destroyed) return;
        this.source = this.context.createBufferSource();
        this.source.buffer = buffer;
        this.source.loop = true;
        this.source.connect(this.output);
        this.source.start();
      })
      .catch((error) => {
        if (!this.destroyed) {
          console.error('[AmbientMusic] No se pudo cargar la música:', error);
          this.loading = null;
        }
      });
  }

  start() {
    if (!this.context) return;
    this.paused = false;
    if (this.context.state === 'suspended') {
      this.context.resume().catch((error) => console.warn('[AmbientMusic] Audio bloqueado:', error));
    }
    this.load();
    this.updateVolume();
  }

  toggle() {
    if (!this.context) return;
    this.enabled = !this.enabled;
    if (this.enabled) this.start();
    this.updateVolume();
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.updateVolume();
  }

  setPaused(paused) {
    this.paused = paused;
    this.updateVolume();
  }

  destroy() {
    if (!this.context) return;
    this.destroyed = true;
    this.abortController.abort();
    this.source?.stop();
    this.source?.disconnect();
    this.output.disconnect();
    if (this.ownsContext) this.context.close();
  }
}