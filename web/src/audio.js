// One PC-speaker-style channel with the original CL priority/interruption rule.
export class SoundChannel {
  constructor(backend) {
    this.backend = backend;
    this.current = null;
  }
  play(id, buffer, priority, volume = 0.4) {
    const now = this.backend.currentTime;
    if (this.current && now < this.current.endsAt && this.current.priority > priority) return false;
    this.stop();
    const source = this.backend.start(buffer, volume);
    this.current = { id, priority, endsAt: now + buffer.duration, source };
    return true;
  }
  stop() {
    if (this.current) {
      try { this.current.source.stop(); } catch { /* Already-ended source. */ }
      this.current = null;
    }
  }
}

export class GameAudio {
  constructor() {
    this.enabled = true;
    this.failed = false;
    this.context = null;
    this.channel = null;
    this.manifest = null;
    this.pending = null;
    this.buffers = new Map();
    this.epoch = 0;
    this.ready = this.preload().catch(() => { this.failed = true; return false; });
  }
  async preload() {
    const url = new URL('../assets/audio/sounds.json', import.meta.url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Audio manifest HTTP ${response.status}`);
    this.manifest = await response.json();
    this.bytes = new Map(await Promise.all(this.manifest.sounds.map(async sound => {
      const response = await fetch(new URL(sound.file, url));
      if (!response.ok) throw new Error(`Audio ${sound.file} HTTP ${response.status}`);
      return [sound.id, await response.arrayBuffer()];
    })));
    return true;
  }
  unlock() {
    // Call synchronously inside a real key/click gesture, before any awaits.
    if (!this.enabled || this.failed) return;
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) { this.failed = true; return; }
      try {
        const context = this.context = new AudioContextClass();
        this.decoded = this.ready.then(async loaded => {
          if (!loaded) return;
          await Promise.all([...this.bytes].map(async ([id, bytes]) => {
            this.buffers.set(id, await context.decodeAudioData(bytes));
          }));
          this.channel = new SoundChannel({
            get currentTime() { return context.currentTime; },
            start(buffer, volume) {
              const source = context.createBufferSource(), gain = context.createGain();
              source.buffer = buffer;
              gain.gain.value = Math.max(0, Math.min(1, volume));
              source.connect(gain); gain.connect(context.destination); source.start();
              source.addEventListener('ended', () => { source.disconnect(); gain.disconnect(); }, { once: true });
              return source;
            },
          });
          this.bytes.clear();
          const pending = this.pending;
          this.pending = null;
          if (pending && pending.epoch === this.epoch) this.request(pending.request);
        }).catch(() => { this.failed = true; this.pending = null; });
      } catch { this.failed = true; return; }
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }
  request(request) {
    if (!this.enabled || this.failed || !this.context) return false;
    const binding = request.event ? this.manifest?.events[request.event] : request;
    if (!this.channel) {
      // Keep just the most recent highest-priority pending cue, never a backlog
      // of old shots that would burst out when decoding/unlocking finishes.
      const old = this.pending?.request;
      const oldBinding = old?.event ? this.manifest?.events[old.event] : old;
      if (!oldBinding || (binding?.priority ?? 0) >= oldBinding.priority) {
        this.pending = { request, epoch: this.epoch };
      }
      return false;
    }
    if (!binding) return false;
    const buffer = this.buffers.get(binding.soundId);
    if (!buffer || this.context.state !== 'running') return false;
    return this.channel.play(binding.soundId, buffer, binding.priority, request.volume);
  }
  playEvent(event) { return this.request({ event }); }
  play(id, { priority, volume = 0.4 } = {}) {
    const sourcePriority = this.manifest?.sounds.find(sound => sound.id === id)?.priority ?? 0;
    return this.request({ soundId: id, priority: priority ?? sourcePriority, volume });
  }
  stop() {
    this.epoch++;
    this.pending = null;
    this.channel?.stop();
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }
  close() {
    this.stop();
    return this.context?.close();
  }
}

export async function loadAudio() {
  const audio = new GameAudio();
  await audio.ready;
  return audio; // Call unlock() from a user gesture before play()/playEvent().
}
