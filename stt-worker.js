// Worker de transcription : Whisper exécuté localement (Transformers.js + ONNX Runtime Web).
// Tourne dans un thread séparé pour ne pas figer l'écran.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';

env.allowLocalModels = false; // modèles téléchargés une fois depuis Hugging Face, puis gardés en cache

let asr = null;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      const t0 = performance.now();
      asr = await pipeline('automatic-speech-recognition', m.model, {
        device: m.device,
        dtype: m.device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
        progress_callback: (p) => self.postMessage({ type: 'progress', p }),
      });
      self.postMessage({ type: 'loaded', ms: performance.now() - t0 });
    } else if (m.type === 'run') {
      const t0 = performance.now();
      const out = await asr(m.audio, { language: 'french', task: 'transcribe' });
      self.postMessage({ type: 'result', index: m.index, text: (out.text || '').trim(), ms: performance.now() - t0 });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
