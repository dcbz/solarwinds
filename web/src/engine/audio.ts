// Solar Winds audio: Creative Music Format (CMF) music and the headerless VOC
// block bank in BH_VFD.DAT.
//
// The executable loads BH_VFD at @0x2fbc8 and passes one of its offset-table
// entries to the CT-VOICE driver at @0x260d5.  Those entries are complete VOC
// data blocks (type 1 + 24-bit length + time constant + codec + wave + type 0
// terminator), deliberately without the 26-byte "Creative Voice File" header.
// FUN_231e_5950 @0x28b30 loads BH_MU1..13 and hands their CTMF instrument and
// event regions to the FM driver.  Web Audio cannot expose an OPL2 chip, so the
// CMF score and its own 16-byte patches are reproduced with a small FM synth.

export interface CmfInstrument {
  modCharacteristic: number;
  carrierCharacteristic: number;
  modLevel: number;
  carrierLevel: number;
  modAttackDecay: number;
  carrierAttackDecay: number;
  modSustainRelease: number;
  carrierSustainRelease: number;
  modWave: number;
  carrierWave: number;
  feedback: number;
  bytes: Uint8Array;
}

export interface CmfEvent {
  tick: number;
  status: number;
  data: Uint8Array;
  metaType?: number;
}

export interface CmfSong {
  version: number;
  ticksPerQuarter: number;
  ticksPerSecond: number;
  tempo: number;
  instruments: CmfInstrument[];
  events: CmfEvent[];
  duration: number;
}

const u16 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);

function vlq(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  for (let n = 0; n < 4; n++) {
    if (at >= bytes.length) throw new RangeError('truncated CMF variable-length value');
    const b = bytes[at++];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) return [value, at];
  }
  throw new RangeError('CMF variable-length value exceeds four bytes');
}

/** Decode a Creative Music Format 1.0/1.1 file and its single MIDI-like track. */
export function parseCmf(bytes: Uint8Array): CmfSong {
  if (bytes.length < 0x28 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'CTMF') {
    throw new Error('CMF signature mismatch');
  }
  const version = u16(bytes, 4);
  const instrumentAt = u16(bytes, 6);
  const musicAt = u16(bytes, 8);
  const ticksPerQuarter = u16(bytes, 0x0a);
  const ticksPerSecond = u16(bytes, 0x0c);
  const instrumentCount = version >= 0x0101 ? u16(bytes, 0x24) : bytes[0x24];
  const tempo = version >= 0x0101 ? u16(bytes, 0x26) : 120;
  if (!ticksPerSecond || instrumentAt < 0x28 || musicAt < instrumentAt || musicAt > bytes.length) {
    throw new RangeError('invalid CMF header offsets');
  }
  if (instrumentAt + instrumentCount * 16 > musicAt) throw new RangeError('CMF instrument bank overlaps score');

  const instruments: CmfInstrument[] = [];
  for (let i = 0; i < instrumentCount; i++) {
    const b = bytes.slice(instrumentAt + i * 16, instrumentAt + (i + 1) * 16);
    instruments.push({
      modCharacteristic: b[0], carrierCharacteristic: b[1], modLevel: b[2], carrierLevel: b[3],
      modAttackDecay: b[4], carrierAttackDecay: b[5], modSustainRelease: b[6], carrierSustainRelease: b[7],
      modWave: b[8], carrierWave: b[9], feedback: b[10], bytes: b,
    });
  }

  const events: CmfEvent[] = [];
  let at = musicAt, tick = 0, running = 0;
  while (at < bytes.length) {
    let delta: number;
    [delta, at] = vlq(bytes, at);
    tick += delta;
    if (at >= bytes.length) throw new RangeError('truncated CMF event');
    let status = bytes[at++];
    if (status < 0x80) {
      if (!running) throw new Error('CMF running status has no preceding channel event');
      at--;
      status = running;
    } else if (status < 0xf0) running = status;

    if (status === 0xff) {
      if (at >= bytes.length) throw new RangeError('truncated CMF meta event');
      const metaType = bytes[at++];
      let length: number;
      [length, at] = vlq(bytes, at);
      if (at + length > bytes.length) throw new RangeError('truncated CMF meta payload');
      events.push({ tick, status, metaType, data: bytes.slice(at, at + length) });
      at += length;
      if (metaType === 0x2f) break;
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      let length: number;
      [length, at] = vlq(bytes, at);
      if (at + length > bytes.length) throw new RangeError('truncated CMF system event');
      events.push({ tick, status, data: bytes.slice(at, at + length) });
      at += length;
      continue;
    }
    if (status >= 0xf0) throw new Error(`unsupported CMF system status 0x${status.toString(16)}`);
    const kind = status & 0xf0;
    const length = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
    if (at + length > bytes.length) throw new RangeError('truncated CMF channel event');
    events.push({ tick, status, data: bytes.slice(at, at + length) });
    at += length;
  }
  return { version, ticksPerQuarter, ticksPerSecond, tempo, instruments, events, duration: tick / ticksPerSecond };
}

export interface VoiceSample {
  rate: number;
  codec: number;
  samples: Float32Array<ArrayBuffer>;
}

function expandCreativeAdpcm(
  predictor: number, step: number, nibble: number, size: number, shift: number,
): [number, number] {
  const sign = nibble & (1 << (size - 1));
  const delta = nibble & ((1 << (size - 1)) - 1);
  const diff = delta << (7 + step + shift);
  predictor = Math.max(-16384, Math.min(16256, predictor + (sign ? -diff : diff)));
  if (delta >= 2 * size - 3 && step < 3) step++;
  else if (delta === 0 && step > 0) step--;
  return [predictor, step];
}

/** Decode one legacy VOC type-1 payload to mono floating-point samples. */
function decodeVoice(codec: number, wave: Uint8Array): Float32Array<ArrayBuffer> {
  if (codec === 0) return Float32Array.from(wave, (v) => (v - 128) / 128);
  if (codec < 1 || codec > 3) throw new Error(`unsupported Creative voice codec ${codec}`);
  if (!wave.length) return new Float32Array();
  const perByte = codec === 1 ? 2 : codec === 2 ? 3 : 4;
  const out = new Float32Array(1 + Math.max(0, wave.length - 1) * perByte);
  let predictor = 128 * (wave[0] - 0x80), step = 0, p = 0;
  out[p++] = predictor / 16384;
  const emit = (value: number, size: number, shift: number) => {
    [predictor, step] = expandCreativeAdpcm(predictor, step, value, size, shift);
    out[p++] = predictor / 16384;
  };
  for (let i = 1; i < wave.length; i++) {
    const b = wave[i];
    if (codec === 1) { emit(b >> 4, 4, 0); emit(b & 15, 4, 0); }
    else if (codec === 2) { emit(b >> 5, 3, 0); emit((b >> 2) & 7, 3, 0); emit(b & 3, 2, 0); }
    else { emit(b >> 6, 2, 2); emit((b >> 4) & 3, 2, 2); emit((b >> 2) & 3, 2, 2); emit(b & 3, 2, 2); }
  }
  return out;
}

/** Decode BH_VFD.DAT's word-offset table and its six headerless VOC blocks. */
export function decodeVoiceBank(bytes: Uint8Array): VoiceSample[] {
  if (bytes.length < 4) throw new RangeError('voice bank is truncated');
  const offsets: number[] = [];
  for (let at = 0; at + 1 < Math.min(bytes.length, 0x100); at += 2) {
    const off = u16(bytes, at);
    if (!off) break;
    if (off > bytes.length) throw new RangeError('voice bank offset is outside the file');
    offsets.push(off);
    if (off === bytes.length) break; // final table word is the end marker
  }
  if (offsets.length < 2 || offsets[0] < offsets.length * 2) throw new Error('voice bank offset table is invalid');
  const result: VoiceSample[] = [];
  for (let i = 0; i + 1 < offsets.length; i++) {
    const at = offsets[i], end = offsets[i + 1];
    if (end <= at || at + 6 > end || bytes[at] !== 1) throw new Error(`voice block ${i + 1} is invalid`);
    const bodyLength = bytes[at + 1] | (bytes[at + 2] << 8) | (bytes[at + 3] << 16);
    const bodyEnd = at + 4 + bodyLength;
    if (bodyLength < 2 || bodyEnd > end) throw new RangeError(`voice block ${i + 1} is truncated`);
    const timeConstant = bytes[at + 4];
    const codec = bytes[at + 5];
    result.push({
      rate: 1_000_000 / (256 - timeConstant),
      codec,
      samples: decodeVoice(codec, bytes.subarray(at + 6, bodyEnd)),
    });
  }
  return result;
}

export interface AudioStatus {
  available: boolean;
  unlocked: boolean;
  currentTrack: number;
  category: number;
  tracks: number;
  effects: number;
  effectsPlayed: number;
}

export interface GameAudio {
  unlock(): Promise<boolean>;
  tick(): void;
  setCategory(category: 1 | 2 | 3 | 4): void;
  playMusic(track: number): void;
  stopMusic(): void;
  playEffect(id: number): void;
  readonly status: AudioStatus;
}

const MUSIC_GROUPS: Record<number, number[]> = { 1: [1], 2: [2, 3, 4, 5], 3: [6, 7, 8, 9], 4: [10, 11, 12, 13] };
type LiveVoice = { carrier: OscillatorNode; modulator: OscillatorNode; gain: GainNode; release: number };

/** Load every shipped audio resource and create a user-gesture-safe browser player. */
export async function createGameAudio(read: (name: string) => Promise<Uint8Array>): Promise<GameAudio> {
  const [musicBytes, voiceBytes] = await Promise.all([
    Promise.all(Array.from({ length: 13 }, (_, i) => read(`BH_MU${i + 1}.DAT`))),
    read('BH_VFD.DAT'),
  ]);
  const songs = musicBytes.map(parseCmf);
  const effects = decodeVoiceBank(voiceBytes);
  let context: AudioContext | null = null;
  let musicGain: GainNode | null = null;
  let effectGain: GainNode | null = null;
  let unlocked = false, currentTrack = 0, category = 0, groupCursor = 0, eventCursor = 0;
  let songStart = 0, effectsPlayed = 0;
  const programs = new Uint8Array(16), volumes = new Uint8Array(16).fill(100);
  const pitches = new Uint16Array(16).fill(8192);
  const voices = new Map<string, LiveVoice>();
  const AudioContextCtor = typeof window !== 'undefined'
    ? (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    : undefined;

  const resetChannels = () => { programs.fill(0); volumes.fill(100); pitches.fill(8192); voices.clear(); eventCursor = 0; };
  const stopVoices = () => {
    const now = context?.currentTime ?? 0;
    for (const voice of voices.values()) {
      try { voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setTargetAtTime(0, now, 0.01); voice.carrier.stop(now + 0.08); voice.modulator.stop(now + 0.08); } catch { /* already stopped */ }
    }
    voices.clear();
  };
  const beginTrack = (track: number) => {
    if (track < 1 || track > songs.length) return;
    stopVoices();
    currentTrack = track;
    resetChannels();
    songStart = (context?.currentTime ?? 0) + 0.04;
  };
  const waveform = (value: number): OscillatorType => ['sine', 'square', 'sawtooth', 'triangle'][value & 3] as OscillatorType;
  const multiplier = (value: number) => [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15][value & 15];
  const rateTime = (nibble: number, slow: number, fast: number) => fast + (slow - fast) * ((15 - nibble) / 15) ** 2;
  const stopNote = (channel: number, note: number, when: number) => {
    const voice = voices.get(`${channel}:${note}`);
    if (!voice) return;
    voice.gain.gain.cancelScheduledValues(when);
    voice.gain.gain.setTargetAtTime(0.0001, when, Math.max(0.01, voice.release / 3));
    try { voice.carrier.stop(when + voice.release); voice.modulator.stop(when + voice.release); } catch { /* already stopped */ }
    voices.delete(`${channel}:${note}`);
  };
  const startNote = (song: CmfSong, channel: number, note: number, velocity: number, when: number) => {
    if (!context || !musicGain) return;
    stopNote(channel, note, when);
    const patch = song.instruments[programs[channel] % Math.max(1, song.instruments.length)] ?? song.instruments[0];
    if (!patch) return;
    const bend = (pitches[channel] - 8192) / 8192 * 2;
    const frequency = 440 * 2 ** ((note - 69 + bend) / 12);
    const carrier = context.createOscillator(), modulator = context.createOscillator();
    const gain = context.createGain(), modDepth = context.createGain();
    const carrierMultiple = multiplier(patch.carrierCharacteristic);
    carrier.type = waveform(patch.carrierWave);
    modulator.type = waveform(patch.modWave);
    carrier.frequency.setValueAtTime(frequency * carrierMultiple, when);
    modulator.frequency.setValueAtTime(frequency * multiplier(patch.modCharacteristic), when);
    const carrierLevel = 10 ** (-(patch.carrierLevel & 0x3f) / 18);
    const level = Math.max(0.0001, (velocity / 127) * (volumes[channel] / 127) * carrierLevel);
    const attack = rateTime(patch.carrierAttackDecay >> 4, 0.45, 0.004);
    const decay = rateTime(patch.carrierAttackDecay & 15, 0.9, 0.025);
    const sustain = Math.max(0.04, 1 - ((patch.carrierSustainRelease >> 4) & 15) / 16);
    const release = rateTime(patch.carrierSustainRelease & 15, 1.3, 0.04);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), when + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * sustain), when + attack + decay);
    modDepth.gain.setValueAtTime(frequency * (1 - (patch.modLevel & 0x3f) / 63) * 1.6, when);
    modulator.connect(modDepth); modDepth.connect(carrier.frequency); carrier.connect(gain); gain.connect(musicGain);
    carrier.start(when); modulator.start(when);
    voices.set(`${channel}:${note}`, { carrier, modulator, gain, release });
  };
  const handleEvent = (song: CmfSong, event: CmfEvent, when: number) => {
    if (event.status >= 0xf0) return;
    const kind = event.status & 0xf0, channel = event.status & 15;
    if (kind === 0x80 || (kind === 0x90 && event.data[1] === 0)) stopNote(channel, event.data[0], when);
    else if (kind === 0x90) startNote(song, channel, event.data[0], event.data[1], when);
    else if (kind === 0xc0) programs[channel] = event.data[0];
    else if (kind === 0xb0) {
      if (event.data[0] === 7) volumes[channel] = event.data[1];
      if (event.data[0] === 120 || event.data[0] === 123) {
        for (const key of [...voices.keys()]) if (key.startsWith(`${channel}:`)) stopNote(channel, Number(key.slice(key.indexOf(':') + 1)), when);
      }
    } else if (kind === 0xe0) pitches[channel] = event.data[0] | (event.data[1] << 7);
  };
  const nextInCategory = () => {
    const group = MUSIC_GROUPS[category] ?? MUSIC_GROUPS[2];
    const track = group[groupCursor++ % group.length];
    beginTrack(track);
  };

  const api: GameAudio = {
    async unlock() {
      if (!AudioContextCtor) return false;
      if (!context) {
        context = new AudioContextCtor();
        musicGain = context.createGain(); effectGain = context.createGain();
        musicGain.gain.value = 0.18; effectGain.gain.value = 0.62;
        musicGain.connect(context.destination); effectGain.connect(context.destination);
        if (currentTrack) beginTrack(currentTrack);
      }
      await context.resume();
      unlocked = context.state === 'running';
      return unlocked;
    },
    tick() {
      if (!context || !unlocked || !currentTrack) return;
      const song = songs[currentTrack - 1], horizon = context.currentTime + 0.12;
      while (eventCursor < song.events.length) {
        const event = song.events[eventCursor];
        const when = songStart + event.tick / song.ticksPerSecond;
        if (when > horizon) break;
        handleEvent(song, event, Math.max(context.currentTime, when));
        eventCursor++;
      }
      if (eventCursor >= song.events.length && context.currentTime >= songStart + song.duration + 0.1) nextInCategory();
    },
    setCategory(next) {
      if (category === next && currentTrack) return;
      category = next; groupCursor = 0; nextInCategory();
    },
    playMusic(track) { category = 0; beginTrack(track); },
    stopMusic() { stopVoices(); currentTrack = 0; eventCursor = 0; },
    playEffect(id) {
      const effect = effects[id - 1];
      if (!effect) return;
      effectsPlayed++;
      if (!context || !unlocked || !effectGain) return;
      const buffer = context.createBuffer(1, effect.samples.length, effect.rate);
      buffer.copyToChannel(effect.samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer; source.connect(effectGain); source.start();
    },
    get status() {
      return { available: Boolean(AudioContextCtor), unlocked, currentTrack, category, tracks: songs.length, effects: effects.length, effectsPlayed };
    },
  };
  return api;
}
