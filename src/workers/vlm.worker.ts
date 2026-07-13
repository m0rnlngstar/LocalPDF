/**
 * Worker d'inférence VLM (vision-langage) via transformers.js (ONNX Runtime).
 *
 * Sert tous les modèles du runtime « transformers » de lib/llm.ts : Gemma 4
 * (WebGPU) comme SmolVLM (CPU/wasm — pour les machines sans GPU). WebLLM ne
 * couvre ni Gemma 4 ni les petits VLM CPU, d'où ce second runtime. Tout est
 * local ; seul le téléchargement des poids (première fois, ensuite en cache
 * navigateur) passe par le CDN Hugging Face.
 *
 * Protocole :  main → worker : {type:'load', modelId, dtype, device, family, expectedMB}
 *                            | {type:'ask', id, system, user, images?}
 *              worker → main : {type:'progress', loadedMB, totalMB} | {type:'ready'}
 *                            | {type:'result', id, text} | {type:'error', id?, message}
 */

import {
  AutoModelForImageTextToText,
  AutoProcessor,
  env,
  load_image,
} from '@huggingface/transformers'

/** Famille d'API du processeur : gemma4 = _call(text, images, audio, options). */
export type VlmFamily = 'gemma4' | 'generic'

interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type InMsg =
  | {
      type: 'load'
      modelId: string
      dtype: string
      device: string
      family: VlmFamily
      expectedMB?: number
    }
  | { type: 'ask'; id: number; messages: ChatMsg[]; images?: string[]; maxTokens?: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processor: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null
let family: VlmFamily = 'generic'
let device = 'webgpu'

/** Octets reçus par fichier, pour agréger une progression globale fiable. */
const files = new Map<string, { loaded: number; total: number }>()
/** Taille attendue du modèle (Mo) : plancher du total tant que tous les
 *  fichiers de poids n'ont pas rejoint l'agrégat. */
let expectedTotalMB = 0

function postDownloadProgress() {
  let loaded = 0
  let total = 0
  for (const f of files.values()) {
    loaded += f.loaded
    total += f.total
  }
  if (total > 0) {
    self.postMessage({
      type: 'progress',
      loadedMB: loaded / 1e6,
      totalMB: Math.max(total / 1e6, expectedTotalMB),
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onFileProgress(info: any) {
  if (info?.status === 'progress' && info.file && info.total) {
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total })
    postDownloadProgress()
  }
}

async function load(msg: Extract<InMsg, { type: 'load' }>) {
  family = msg.family
  device = msg.device
  // Sur WebGPU, le wasm ne fait que l'orchestration : le passer en
  // mono-thread évite les pièges d'atomiques non alignées d'onnxruntime-web
  // (« RuntimeError: operation does not support unaligned accesses », vu en
  // multi-tours) sans coût notable. Les modèles CPU gardent leurs threads.
  if (msg.device === 'webgpu' && env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1
  }
  processor = await AutoProcessor.from_pretrained(msg.modelId, {
    progress_callback: onFileProgress,
  })
  model = await AutoModelForImageTextToText.from_pretrained(msg.modelId, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dtype: msg.dtype as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    device: msg.device as any,
    progress_callback: onFileProgress,
  })
  self.postMessage({ type: 'ready' })
}

async function ask(
  id: number,
  rawMessages: ChatMsg[],
  images: string[] = [],
  maxTokens = 8
) {
  // Le rôle system n'existe pas dans les templates de ces modèles : fusionné
  // en tête du premier tour utilisateur. Les images sont attachées au dernier
  // message utilisateur, avant son texte (recommandation des cartes modèles).
  const system = rawMessages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const turns = rawMessages.filter((m) => m.role !== 'system')
  const messages = turns.map((m, i) => {
    const text = system && i === 0 ? `${system}\n\n${m.content}` : m.content
    const withImages = i === turns.length - 1 && m.role === 'user' && images.length > 0
    // Les templates idefics3/SmolVLM itèrent sur content : toujours un tableau
    // de segments. Ceux de Gemma acceptent aussi une chaîne (chemin éprouvé).
    if (withImages || family !== 'gemma4') {
      return {
        role: m.role,
        content: [
          ...(withImages ? images.map(() => ({ type: 'image' })) : []),
          { type: 'text', text },
        ],
      }
    }
    return { role: m.role, content: text }
  })
  const prompt = processor.apply_chat_template(messages, {
    enable_thinking: false,
    add_generation_prompt: true,
  })
  // Sur CPU (wasm), l'encodage d'image domine largement le temps de réponse :
  // on réduit à 448 px de bord long — suffisant pour juger une mise en page.
  const maxEdge = device === 'wasm' ? 448 : Infinity
  const imgs = images.length
    ? await Promise.all(
        images.map(async (u) => {
          const img = await load_image(u)
          const scale = maxEdge / Math.max(img.width, img.height)
          return scale < 1
            ? img.resize(Math.round(img.width * scale), Math.round(img.height * scale))
            : img
        })
      )
    : null
  // Signatures : gemma4 = (text, images, audio, options) ; les autres VLM
  // (idefics3/SmolVLM…) = (text, images, options). Sans image, le processeur
  // idefics3 plante (il lit image_inputs.rows sans garde) → tokenizer direct.
  const opts = { add_special_tokens: false }
  const inputs =
    family === 'gemma4'
      ? await processor(prompt, imgs, null, opts)
      : imgs
        ? await processor(prompt, imgs, opts)
        : processor.tokenizer(prompt, opts)
  const outputs = await model.generate({
    ...inputs,
    max_new_tokens: maxTokens,
    do_sample: false,
  })
  const text: string = processor.batch_decode(
    outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
    { skip_special_tokens: true }
  )[0]
  self.postMessage({ type: 'result', id, text: text.trim() })
}

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data
  if (msg.type === 'load') {
    expectedTotalMB = msg.expectedMB ?? 0
    load(msg).catch((err) => {
      self.postMessage({ type: 'error', message: String(err?.message ?? err) })
    })
  } else if (msg.type === 'ask') {
    ask(msg.id, msg.messages, msg.images, msg.maxTokens).catch((err) => {
      self.postMessage({ type: 'error', id: msg.id, message: String(err?.message ?? err) })
    })
  }
}
