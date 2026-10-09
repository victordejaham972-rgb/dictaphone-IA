// Thread séparé pour le moteur d'IA locale (WebLLM, hébergé dans vendor/).
import { WebWorkerMLCEngineHandler } from './vendor/web-llm.js';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
