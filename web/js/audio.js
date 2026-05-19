class AudioManager {
  constructor() {
    this.enabled = true;
    this.bgmEnabled = true;
    this.volume = 0.18;
    this.bgmVolume = 0.3;
    this.AudioContext = window.AudioContext || window.webkitAudioContext;
    this.bgmAudio = null;
    this.bgmLoaded = false;
  }

  loadBGM(src = 'assets/bgm.mp3') {
    if (!this.AudioContext) return;
    this.bgmAudio = new Audio(src);
    this.bgmAudio.loop = true;
    this.bgmAudio.volume = this.bgmVolume;
    this.bgmAudio.addEventListener('canplaythrough', () => {
      this.bgmLoaded = true;
      if (this.bgmEnabled && this.enabled) {
        this.bgmAudio.play().catch(() => {});
      }
    });
    this.bgmAudio.addEventListener('error', () => {
      this.bgmLoaded = false;
    });
  }

  startBGM() {
    if (!this.bgmAudio || !this.bgmLoaded) return;
    this.bgmEnabled = true;
    this.bgmAudio.play().catch(() => {});
  }

  stopBGM() {
    if (!this.bgmAudio) return;
    this.bgmEnabled = false;
    this.bgmAudio.pause();
  }

  toggleBGM() {
    if (this.bgmEnabled) {
      this.stopBGM();
    } else {
      this.startBGM();
    }
    return this.bgmEnabled;
  }

  play(name) {
    if (!this.enabled || !this.AudioContext) return;

    const context = new this.AudioContext();
    const gain = context.createGain();
    gain.connect(context.destination);

    if (name === 'finish') {
      this.playSequence(context, gain, [523, 659, 784], 0.12);
      return;
    }

    const oscillator = context.createOscillator();
    oscillator.connect(gain);
    oscillator.frequency.value = this.frequencyFor(name);
    oscillator.type = name === 'jump' ? 'triangle' : 'sine';
    gain.gain.setValueAtTime(this.volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.12);
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + 0.12);
  }

  frequencyFor(name) {
    const map = {
      select: 440,
      move: 330,
      jump: 560,
      finish: 720
    };
    return map[name] || 300;
  }

  playSequence(context, gain, notes, step) {
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.connect(gain);
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      const start = context.currentTime + index * step;
      gain.gain.setValueAtTime(this.volume, start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + step);
      oscillator.start(start);
      oscillator.stop(start + step);
    });
  }
}
