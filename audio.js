// Audio : tout est converti en 16 kHz mono 16 bits et stocké par morceaux de 30 s.
// Ainsi, une réunion de 2 h n'est jamais chargée entièrement en mémoire par l'application
// (2 h à 16 kHz en 16 bits = environ 230 Mo sur disque, lus 30 s à la fois).
import { putChunk } from './db.js';

export const SR = 16000;
export const CHUNK_SEC = 30;
export const CHUNK = SR * CHUNK_SEC;

export class ChunkWriter {
  constructor(sessionId, onFlush) {
    this.id = sessionId;
    this.onFlush = onFlush;
    this.buf = new Int16Array(CHUNK);
    this.n = 0;
    this.idx = 0;
    this.total = 0;
    this.pending = Promise.resolve();
  }
  pushSample(v) {
    const s = v > 1 ? 1 : v < -1 ? -1 : v;
    this.buf[this.n++] = s < 0 ? s * 32768 : s * 32767;
    this.total++;
    if (this.n === CHUNK) this.flush();
  }
  flush() {
    if (this.n === 0) return;
    const data = this.buf.slice(0, this.n).buffer;
    const i = this.idx++;
    this.n = 0;
    this.pending = this.pending
      .then(() => putChunk(this.id, i, data))
      .then(() => this.onFlush && this.onFlush(i + 1, this.total));
  }
  drain() { return this.pending; }
  async finish() {
    this.flush();
    await this.pending;
    return { chunks: this.idx, total: this.total };
  }
}

// Conversion de fréquence (ex. 48000 Hz -> 16000 Hz) par moyenne : suffisant pour la parole.
export class Resampler {
  constructor(inRate, writer) {
    this.ratio = inRate / SR;
    this.writer = writer;
    this.acc = 0;
    this.n = 0;
    this.pos = 0;
    this.next = this.ratio;
  }
  push(f32) {
    for (let i = 0; i < f32.length; i++) {
      this.acc += f32[i];
      this.n++;
      this.pos++;
      if (this.pos >= this.next) {
        this.writer.pushSample(this.acc / this.n);
        this.acc = 0;
        this.n = 0;
        this.next += this.ratio;
      }
    }
  }
}

// ---------- Enregistrement micro ----------
export class Recorder {
  constructor(writer, { onLevel, onEnded } = {}) {
    this.writer = writer;
    this.onLevel = onLevel;
    this.onEnded = onEnded;
  }
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    await this.ctx.audioWorklet.addModule('recorder-worklet.js');
    this.rs = new Resampler(this.ctx.sampleRate, this.writer);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-tap');
    this.node.port.onmessage = (e) => {
      const f = e.data;
      this.rs.push(f);
      if (this.onLevel) {
        let s = 0;
        for (let i = 0; i < f.length; i += 8) s += f[i] * f[i];
        this.onLevel(Math.sqrt(s / (f.length / 8)));
      }
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    src.connect(this.node);
    this.node.connect(mute);
    mute.connect(this.ctx.destination);
    this.stream.getAudioTracks()[0].addEventListener('ended', () => this.onEnded && this.onEnded());
    this.inputRate = this.ctx.sampleRate;
  }
  async stop() {
    try { this.node.disconnect(); } catch {}
    this.stream.getTracks().forEach((t) => t.stop());
    try { await this.ctx.close(); } catch {}
    return this.writer.finish();
  }
}

// ---------- Import d'un fichier ----------
const tag = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

// WAV : lu par petits blocs de 1 Mo, donc sans limite de durée côté mémoire.
async function importWav(file, writer, onProgress) {
  const head = new DataView(await file.slice(0, 65536).arrayBuffer());
  if (head.byteLength < 12 || tag(head, 0) !== 'RIFF' || tag(head, 8) !== 'WAVE') return false;
  let p = 12, fmt = null, dataStart = -1, dataLen = 0;
  while (p + 8 <= head.byteLength) {
    const id = tag(head, p), size = head.getUint32(p + 4, true);
    if (id === 'fmt ') {
      fmt = { format: head.getUint16(p + 8, true), ch: head.getUint16(p + 10, true), rate: head.getUint32(p + 12, true), align: head.getUint16(p + 20, true), bits: head.getUint16(p + 22, true) };
      if (fmt.format === 0xfffe) fmt.format = head.getUint16(p + 32, true);
    } else if (id === 'data') {
      dataStart = p + 8;
      dataLen = size === 0 || size > file.size - dataStart ? file.size - dataStart : size;
      break;
    }
    p += 8 + size + (size & 1);
  }
  if (!fmt || dataStart < 0 || !fmt.align) return false;
  const ok = (fmt.format === 1 && [16, 24, 32].includes(fmt.bits)) || (fmt.format === 3 && fmt.bits === 32);
  if (!ok) throw new Error(`WAV non géré (format ${fmt.format}, ${fmt.bits} bits)`);

  const rs = new Resampler(fmt.rate, writer);
  const frames = Math.floor(1048576 / fmt.align);
  const step = frames * fmt.align;
  const bps = fmt.bits / 8;
  for (let off = 0; off < dataLen; off += step) {
    const end = Math.min(off + step, dataLen);
    const dv = new DataView(await file.slice(dataStart + off, dataStart + end).arrayBuffer());
    const nFrames = Math.floor(dv.byteLength / fmt.align);
    const mono = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) {
      let sum = 0;
      for (let c = 0; c < fmt.ch; c++) {
        const o = f * fmt.align + c * bps;
        if (fmt.format === 3) sum += dv.getFloat32(o, true);
        else if (fmt.bits === 16) sum += dv.getInt16(o, true) / 32768;
        else if (fmt.bits === 24) sum += (((dv.getUint8(o + 2) << 24) | (dv.getUint8(o + 1) << 16) | (dv.getUint8(o) << 8)) >> 8) / 8388608;
        else sum += dv.getInt32(o, true) / 2147483648;
      }
      mono[f] = sum / fmt.ch;
    }
    rs.push(mono);
    await writer.drain();
    onProgress && onProgress(end / dataLen);
  }
  return true;
}

// Autres formats (m4a, mp3...) : le navigateur doit décoder le fichier en une fois.
// C'est une LIMITE À MESURER : sur un fichier de 1-2 h, cela peut saturer la mémoire de l'iPhone.
async function importDecoded(file, writer, onProgress) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: SR });
  const audio = await ctx.decodeAudioData(await file.arrayBuffer());
  const rs = new Resampler(audio.sampleRate, writer);
  const n = audio.length, chs = audio.numberOfChannels;
  const data = [];
  for (let c = 0; c < chs; c++) data.push(audio.getChannelData(c));
  const BLOCK = 1 << 18;
  for (let off = 0; off < n; off += BLOCK) {
    const len = Math.min(BLOCK, n - off);
    const mono = new Float32Array(len);
    for (let c = 0; c < chs; c++) for (let i = 0; i < len; i++) mono[i] += data[c][off + i] / chs;
    rs.push(mono);
    await writer.drain();
    onProgress && onProgress((off + len) / n);
  }
  try { await ctx.close(); } catch {}
  return 'decode';
}

export async function importFile(file, writer, onProgress) {
  if (await importWav(file, writer, onProgress)) return 'wav-streaming';
  await importDecoded(file, writer, onProgress);
  return 'decodeAudioData';
}
