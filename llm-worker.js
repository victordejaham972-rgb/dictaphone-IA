// Worker du modèle de langage (WebLLM, WebGPU) : génère les comptes rendus localement.
import * as webllm from 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm';

const handler = new webllm.WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
