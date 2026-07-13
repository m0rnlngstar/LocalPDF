/**
 * Worker WebLLM : héberge le moteur d'inférence (WebGPU) hors du thread
 * principal, pour que l'UI reste fluide pendant le chargement du modèle et
 * la génération. Le protocole de messages est géré par WebLLM lui-même.
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg)
