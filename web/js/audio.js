class AudioManager {
  constructor() {
    this.enabled = true;
    this.volume = 0.18;
    this.AudioContext = window.AudioContext || window.webkitAudioContext;
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
