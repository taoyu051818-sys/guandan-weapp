export class AudioManager {
  private static instance: AudioManager;
  private ctx: AudioContext | null = null;
  private volume: number = 0.5;
  private enabled: boolean = true;
  private bgmEnabled: boolean = true;
  private bgmVolume: number = 0.3;
  private bgmAudio: HTMLAudioElement | null = null;
  private voiceAudio: HTMLAudioElement | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private getAudioContextCtor(): typeof AudioContext | null {
    if (typeof window === 'undefined') return null;
    const w = window as Window & { webkitAudioContext?: typeof AudioContext };
    const nativeCtor = typeof AudioContext !== 'undefined' ? AudioContext : null;
    return nativeCtor ?? w.webkitAudioContext ?? null;
  }
  
  private voiceFiles: Record<string, string> = {
    "rocket": "./voices/rocket.wav",
    "straight_flush": "./voices/straight_flush.wav",
    "bomb": "./voices/bomb.wav",
    "straight": "./voices/straight.wav",
    "tube": "./voices/tube.wav",
    "plate": "./voices/plate.wav",
    "triple_pair": "./voices/triple_pair.wav",

    "pass_1": "./voices/pass_1.wav",
    "pass_2": "./voices/pass_2.wav",
    "pass_3": "./voices/pass_3.wav",

    "chat_hurry": "./voices/chat_hurry.wav",
    "chat_mmgg": "./voices/chat_mmgg.wav",
    "chat_good": "./voices/chat_good.wav",
    "chat_friend": "./voices/chat_friend.wav",
    "chat_stay": "./voices/chat_stay.wav",
    "chat_lose": "./voices/chat_lose.wav",

    "single_2": "./voices/single_2.wav", "single_3": "./voices/single_3.wav", "single_4": "./voices/single_4.wav",
    "single_5": "./voices/single_5.wav", "single_6": "./voices/single_6.wav", "single_7": "./voices/single_7.wav",
    "single_8": "./voices/single_8.wav", "single_9": "./voices/single_9.wav", "single_10": "./voices/single_10.wav",
    "single_J": "./voices/single_J.wav", "single_Q": "./voices/single_quan.wav", "single_K": "./voices/single_K.wav",
    "single_A": "./voices/single_A.wav", "single_Small": "./voices/single_Small.wav", "single_Big": "./voices/single_Big.wav",

    "pair_2": "./voices/pair_2.wav", "pair_3": "./voices/pair_3.wav", "pair_4": "./voices/pair_4.wav",
    "pair_5": "./voices/pair_5.wav", "pair_6": "./voices/pair_6.wav", "pair_7": "./voices/pair_7.wav",
    "pair_8": "./voices/pair_8.wav", "pair_9": "./voices/pair_9.wav", "pair_10": "./voices/pair_10.wav",
    "pair_J": "./voices/pair_J.wav", "pair_Q": "./voices/pair_Q.wav", "pair_K": "./voices/pair_K.wav",
    "pair_A": "./voices/pair_A.wav",

    "triple_2": "./voices/triple_2.wav", "triple_3": "./voices/triple_3.wav", "triple_4": "./voices/triple_4.wav",
    "triple_5": "./voices/triple_5.wav", "triple_6": "./voices/triple_6.wav", "triple_7": "./voices/triple_7.wav",
    "triple_8": "./voices/triple_8.wav", "triple_9": "./voices/triple_9.wav", "triple_10": "./voices/triple_10.wav",
    "triple_J": "./voices/triple_J.wav", "triple_Q": "./voices/triple_Q.wav", "triple_K": "./voices/triple_K.wav",
    "triple_A": "./voices/triple_A.wav"
  };

  private constructor() {
    if (typeof window !== 'undefined') {
      this.voiceAudio = new Audio();
      
      this.bgmAudio = new Audio('./bgm.mp3');
      this.bgmAudio.loop = true;
      this.bgmAudio.volume = this.bgmVolume;
    }
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        const AudioContextCtor = this.getAudioContextCtor();
        if (!AudioContextCtor) {
          console.warn('Web Audio API not supported');
          return null;
        }
        this.ctx = new AudioContextCtor();
        this.initNoiseBuffer();
      } catch {
        console.warn('Web Audio API not supported');
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private initNoiseBuffer() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds of noise
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      // White noise
      output[i] = Math.random() * 2 - 1;
    }
  }

  public setConfig(enabled: boolean, volume: number, bgmEnabled: boolean = true, bgmVolume: number = 0.3) {
    this.enabled = enabled;
    this.volume = volume;
    
    this.bgmEnabled = bgmEnabled;
    this.bgmVolume = bgmVolume;
    
    if (this.bgmAudio) {
      this.bgmAudio.volume = bgmVolume;
      if (!bgmEnabled) {
        this.bgmAudio.pause();
      } else {
        // 尝试播放（如果浏览器允许自动播放）
        this.playBGM();
      }
    }
  }

  public playBGM() {
    if (this.bgmEnabled && this.bgmAudio && this.bgmAudio.paused) {
      // 使用 catch 捕获浏览器自动播放限制导致的错误
      this.bgmAudio.play().catch(() => {
        console.warn('Auto-play was prevented by the browser. BGM will play after user interaction.');
      });
    }
  }

  public stopBGM() {
    if (this.bgmAudio) {
      this.bgmAudio.pause();
    }
  }

  public playCardSound() {
    const ctx = this.getContext();
    if (!ctx || !this.noiseBuffer) return;

    const t = ctx.currentTime;
    
    // 使用白噪音+带通滤波来模拟真实的纸牌摩擦/拍打桌面的声音，比方波更柔和逼真
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, t); // 突出纸张摩擦的中高频
    filter.Q.value = 0.8;

    const gain = ctx.createGain();
    
    // 极短的音量包络，模拟清脆的“唰/啪”声
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(this.volume * 0.8, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noiseSource.start(t);
    noiseSource.stop(t + 0.15);
  }

  public playPassSound() {
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    
    // 使用柔和的正弦波产生类似木琴或水滴的“咚”声，听感更好
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.15);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(this.volume * 0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.25);
  }

  public playBombSound() {
    const ctx = this.getContext();
    if (!ctx || !this.noiseBuffer) return;

    const t = ctx.currentTime;
    
    // 1. 低频正弦波模拟爆炸的冲击波（Sub-bass）
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(120, t);
    subOsc.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    
    subGain.gain.setValueAtTime(0, t);
    subGain.gain.linearRampToValueAtTime(this.volume * 0.8, t + 0.05);
    subGain.gain.exponentialRampToValueAtTime(0.01, t + 0.8);
    
    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    
    subOsc.start(t);
    subOsc.stop(t + 1);

    // 2. 过滤的白噪音模拟爆炸的“轰”声，比方波/锯齿波柔和很多
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;
    
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(1000, t);
    noiseFilter.frequency.exponentialRampToValueAtTime(100, t + 0.6);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, t);
    noiseGain.gain.linearRampToValueAtTime(this.volume * 0.7, t + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.7);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noiseSource.start(t);
    noiseSource.stop(t + 1);
  }

  public preloadVoice() {
    if (!this.enabled || typeof window === 'undefined') return;
    ['single_2', 'pair_2', 'pass_1'].forEach(key => {
      const audio = new Audio(this.voiceFiles[key]);
      audio.preload = 'auto';
    });
  }

  public playVoice(key: string) {
    if (!this.enabled || typeof window === 'undefined' || !this.voiceAudio) return;
    
    const filePath = this.voiceFiles[key];
    if (filePath) {
      this.voiceAudio.src = filePath;
      this.voiceAudio.volume = this.volume;
      this.voiceAudio.play().catch(e => console.warn('Failed to play voice:', e));
    } else {
      console.warn('Voice file not found for key:', key);
    }
  }
}

export const audioManager = AudioManager.getInstance();
