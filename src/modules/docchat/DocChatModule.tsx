import { useEffect, useMemo, useRef, useState } from 'react'
import { openPdf } from '../../lib/pdfjs'
import { recognizeCanvas } from '../../lib/ocr'
import {
  askLlmChat, canRunLlm, LLM_MODELS, onLlmLoadProgress,
  type LlmChatMessage, type LlmLoadProgress,
} from '../../lib/llm'
import {
  classifyModels, detectHardware, type HardwareProfile, type ModelFit,
} from '../../lib/hardware'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { LlmLoadCard } from '../../components/ui/LlmLoadCard'
import { InfoDialog } from '../../components/ui/InfoDialog'
import { toast } from '../../components/ui/Toast'
import { IconX } from '../../components/ui/icons'

/**
 * Interroger un document : le PDF est lu (texte embarqué, OCR en repli pour
 * les scans), puis son contenu est fourni au LLM local comme contexte — les
 * questions et le document ne quittent jamais le navigateur.
 */

const CONFIG_KEY = 'docchat-config'

interface DocChatConfig {
  model: string
}

function loadConfig(): DocChatConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* config corrompue : défauts */ }
  return { model: 'onnx-community/gemma-4-E2B-it-ONNX' }
}

/**
 * Budget de contexte (caractères) par modèle. Gemma 4 accepte 128K tokens sur
 * le papier, mais un prefill massif sur WebGPU déclenche le watchdog GPU de
 * Windows (TDR ≈ 2 s) → périphérique perdu (« external Instance reference no
 * longer exists ») : on reste bien en deçà.
 */
function contextBudget(modelId: string): number {
  if (modelId.includes('gemma-4')) return 12000
  if (modelId.includes('SmolVLM')) return 4000
  return 8000
}

interface LoadedDoc {
  name: string
  pageTexts: string[]
  /** Vrai si au moins une page a nécessité l'OCR (scan). */
  usedOcr: boolean
}

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Résume ce document en quelques phrases.',
  'Quels sont les montants et les dates mentionnés ?',
  'Qui sont les parties concernées ?',
]

function DocChatHelp() {
  return (
    <InfoDialog title="💬 Interroger un document — comment ça marche">
      <p>
        Le PDF est lu dans votre navigateur : son texte embarqué est extrait
        directement (pour les scans, l'OCR prend le relais, page par page). Ce
        texte est ensuite fourni comme contexte à un <strong>modèle d'IA 100 %
        local</strong> (WebGPU ou CPU) — ni le document ni vos questions ne
        quittent votre machine.
      </p>
      <h4 className="font-semibold mt-1">Limites</h4>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          Les documents très longs sont tronqués pour tenir dans le contexte du
          modèle (le début du document est privilégié) ;
        </li>
        <li>
          la qualité des réponses dépend du modèle : Gemma 4 est nettement plus
          fiable que les petits modèles CPU ;
        </li>
        <li>
          comme tout LLM, il peut se tromper — vérifiez les informations
          importantes dans le document (survolez, citez la page).
        </li>
      </ul>
    </InfoDialog>
  )
}

export default function DocChatModule() {
  const [doc, setDoc] = useState<LoadedDoc | null>(null)
  const [extractProgress, setExtractProgress] = useState<{ page: number; total: number } | null>(null)
  const [config, setConfig] = useState<DocChatConfig>(loadConfig)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [llmLoad, setLlmLoad] = useState<LlmLoadProgress | null>(null)
  const [hardware, setHardware] = useState<HardwareProfile | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void detectHardware().then(setHardware)
  }, [])
  const modelFit = useMemo<Record<string, ModelFit> | null>(
    () => (hardware ? classifyModels(hardware) : null),
    [hardware]
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, asking])

  function updateConfig(patch: Partial<DocChatConfig>) {
    const next = { ...config, ...patch }
    setConfig(next)
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
  }

  async function handleFiles(files: File[]) {
    const file = files[0]
    if (!file) return
    try {
      const bytes = await file.arrayBuffer()
      const pdf = await openPdf(bytes)
      const pageTexts: string[] = []
      let usedOcr = false
      for (let i = 1; i <= pdf.numPages; i++) {
        setExtractProgress({ page: i, total: pdf.numPages })
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        let text = content.items
          .map((it) => ('str' in it ? it.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (text.length < 50) {
          // Page sans couche texte (scan) : OCR du rendu
          usedOcr = true
          const vp0 = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: Math.min(1300 / vp0.width, 2.5) })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
          const { text: ocrText } = await recognizeCanvas(canvas, () => {})
          text = ocrText.replace(/\s+/g, ' ').trim()
        }
        pageTexts.push(text)
      }
      setDoc({ name: file.name.replace(/\.pdf$/i, ''), pageTexts, usedOcr })
      setTurns([])
    } catch (err) {
      console.error(err)
      toast.error('Impossible de lire ce PDF')
    } finally {
      setExtractProgress(null)
    }
  }

  /** Contexte document : pages étiquetées, tronqué au budget du modèle. */
  function buildSystemPrompt(): string {
    if (!doc) return ''
    const budget = contextBudget(config.model)
    let body = ''
    for (let i = 0; i < doc.pageTexts.length; i++) {
      const chunk = `\n[Page ${i + 1}]\n${doc.pageTexts[i]}`
      if (body.length + chunk.length > budget) {
        body += `\n\n[…document tronqué : ${doc.pageTexts.length - i} page(s) restante(s) non incluse(s)]`
        break
      }
      body += chunk
    }
    return (
      `Tu es un assistant qui répond aux questions sur un document fourni. ` +
      `Réponds en français, de façon concise et factuelle. Si l'information ne ` +
      `figure pas dans le document, dis-le clairement. Cite la page quand c'est utile.\n\n` +
      `Document « ${doc.name} » (${doc.pageTexts.length} pages) :\n${body}`
    )
  }

  async function send(question: string) {
    const q = question.trim()
    if (!q || !doc || asking) return
    if (!canRunLlm(config.model)) {
      toast.error('Ce modèle exige un GPU (WebGPU) : choisissez SmolVLM (CPU)')
      return
    }
    setInput('')
    const history = [...turns, { role: 'user' as const, content: q }]
    setTurns(history)
    setAsking(true)
    onLlmLoadProgress((p) => setLlmLoad(p.progress >= 1 ? null : p))
    try {
      // Historique borné aux 6 derniers tours : le document (dans le prompt
      // système) reste la source principale, et le prompt ne gonfle pas à
      // chaque question.
      const messages: LlmChatMessage[] = [
        { role: 'system', content: buildSystemPrompt() },
        ...history.slice(-6),
      ]
      // Sur CPU, chaque token généré coûte cher : réponse plafonnée plus court
      const isCpuModel = LLM_MODELS.find((m) => m.id === config.model)?.device === 'wasm'
      const answer = await askLlmChat(config.model, messages, {
        maxTokens: isCpuModel ? 160 : 512,
      })
      setTurns([...history, { role: 'assistant', content: answer || '(réponse vide)' }])
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(
        /Instance reference|device lost/i.test(msg)
          ? 'Le GPU a été réinitialisé pendant le calcul (document trop long ?). Réessayez : le modèle sera rechargé depuis le cache.'
          : `Échec de la réponse : ${msg}`
      )
      setTurns(turns) // retire la question restée sans réponse
    } finally {
      setAsking(false)
      setLlmLoad(null)
      onLlmLoadProgress(null)
    }
  }

  if (!doc) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-16 flex flex-col gap-3">
        <FileDropzone
          accept="application/pdf"
          onFiles={(files) => void handleFiles(files)}
          className="bg-base-100 shadow-xl py-16"
          icon={extractProgress ? <span className="loading loading-spinner" /> : undefined}
          title="Déposez le document à interroger"
          description="Son texte est extrait puis fourni à une IA locale — rien ne quitte votre navigateur"
          footer={
            extractProgress ? (
              <span className="text-xs text-base-content/50">
                Lecture de la page {extractProgress.page} / {extractProgress.total}…
              </span>
            ) : (
              <span className="text-xs text-base-content/50 flex items-center gap-1">
                Comment ça marche ? <DocChatHelp />
              </span>
            )
          }
        />
      </div>
    )
  }

  const charCount = doc.pageTexts.reduce((n, t) => n + t.length, 0)

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-3 h-full">
      {/* Barre d'infos document + choix du modèle */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{doc.name}.pdf</span>
        <DocChatHelp />
        <span className="text-xs text-base-content/50">
          {doc.pageTexts.length} pages · {Math.round(charCount / 1000)} k caractères
          {doc.usedOcr ? ' · OCR' : ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <select
            className="select select-sm w-fit max-w-60"
            value={config.model}
            onChange={(e) => updateConfig({ model: e.target.value })}
            disabled={asking}
          >
            {LLM_MODELS.map((m) => {
              const fit = modelFit?.[m.id]
              return (
                <option key={m.id} value={m.id} disabled={fit === 'unavailable'}>
                  {fit === 'recommended' ? '⭐ ' : ''}{m.label}
                </option>
              )
            })}
          </select>
          <button
            className="btn btn-sm btn-ghost rounded-full gap-1"
            onClick={() => {
              setDoc(null)
              setTurns([])
            }}
          >
            <IconX /> Fermer
          </button>
        </div>
      </div>

      {llmLoad && (
        <LlmLoadCard
          load={llmLoad}
          footnote="Premier usage de ce modèle : il doit être téléchargé avant de répondre."
        />
      )}

      {/* Fil de conversation */}
      <div className="card bg-base-100 border border-base-300/50 shadow-sm flex-1 min-h-[50vh]">
        <div className="card-body p-4 gap-3 overflow-y-auto">
          {turns.length === 0 && (
            <div className="text-center text-sm text-base-content/50 my-auto flex flex-col gap-3">
              <p>Posez une question sur le document, ou essayez :</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    className="btn btn-xs btn-soft rounded-full"
                    onClick={() => void send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`chat ${t.role === 'user' ? 'chat-end' : 'chat-start'}`}>
              <div
                className={`chat-bubble text-sm whitespace-pre-wrap ${
                  t.role === 'user' ? 'chat-bubble-primary' : ''
                }`}
              >
                {t.content}
              </div>
            </div>
          ))}
          {asking && (
            <div className="chat chat-start">
              <div className="chat-bubble">
                <span className="loading loading-dots loading-sm" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Saisie */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <input
          className="input input-bordered flex-1"
          placeholder="Votre question sur le document…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={asking}
        />
        <button
          type="submit"
          className="btn btn-primary rounded-full px-5"
          disabled={asking || !input.trim()}
        >
          {asking ? <span className="loading loading-spinner loading-xs" /> : 'Envoyer'}
        </button>
      </form>
    </div>
  )
}
