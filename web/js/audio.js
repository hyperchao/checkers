class AudioManager {
  constructor() {
    this.enabled = true;
    this.bgmEnabled = true;
    this.volume = 0.18;
    this.bgmVolume = 0.3;
    this.AudioContext = window.AudioContext || window.webkitAudioContext;
    this.bgmAudio = null;
    this.bgmSrc = null;
    this.bgmLoaded = false;
    this.bgmCanPlayHandler = null;
    this.bgmErrorHandler = null;
    this.sfxContext = null;
  }

  loadBGM(src = 'assets/bgm.mp3') {
    if (!this.AudioContext) return;
    if (this.bgmAudio && this.bgmSrc === src) {
      if (this.bgmEnabled && this.enabled && this.bgmLoaded) {
        this.bgmAudio.play().catch(() => {});
      }
      return;
    }

    this.disposeBGM();
    this.bgmAudio = new Audio(src);
    this.bgmSrc = src;
    this.bgmAudio.loop = true;
    this.bgmAudio.volume = this.bgmVolume;
    this.bgmCanPlayHandler = () => {
      this.bgmLoaded = true;
      if (this.bgmEnabled && this.enabled) {
        this.bgmAudio.play().catch(() => {});
      }
    };
    this.bgmErrorHandler = () => {
      this.bgmLoaded = false;
    };
    this.bgmAudio.addEventListener('canplaythrough', this.bgmCanPlayHandler);
    this.bgmAudio.addEventListener('error', this.bgmErrorHandler);
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

    const context = this.getSfxContext();
    if (!context) return;
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
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  getSfxContext() {
    if (!this.sfxContext || this.sfxContext.state === 'closed') {
      this.sfxContext = new this.AudioContext();
    }
    if (this.sfxContext.state === 'suspended') {
      this.sfxContext.resume().catch(() => {});
    }
    return this.sfxContext;
  }

  frequencyFor(name) {
    const map = {
      select: 440,
      move: 330,
      jump: 330,
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
      oscillator.onended = () => {
        oscillator.disconnect();
        if (index === notes.length - 1) gain.disconnect();
      };
    });
  }

  disposeBGM() {
    if (!this.bgmAudio) return;
    if (this.bgmCanPlayHandler) {
      this.bgmAudio.removeEventListener('canplaythrough', this.bgmCanPlayHandler);
    }
    if (this.bgmErrorHandler) {
      this.bgmAudio.removeEventListener('error', this.bgmErrorHandler);
    }
    this.bgmAudio.pause();
    this.bgmAudio.removeAttribute('src');
    this.bgmAudio.load();
    this.bgmAudio = null;
    this.bgmSrc = null;
    this.bgmLoaded = false;
    this.bgmCanPlayHandler = null;
    this.bgmErrorHandler = null;
  }

  dispose() {
    this.disposeBGM();
    if (this.sfxContext && this.sfxContext.state !== 'closed') {
      this.sfxContext.close().catch(() => {});
    }
    this.sfxContext = null;
  }
}
