# LocalPDF

Application web de manipulation de PDF **100% côté client** : aucun backend, aucun fichier n'est jamais envoyé sur un serveur. Tout le traitement — rendu, édition, OCR et même l'IA — se fait dans le navigateur, ce qui en fait une alternative locale à iLovePDF/Smallpdf. Déployable en simple site statique.

🎬 **[Vidéo de présentation](docs/presentation.mp4)**

## Modules

| Module | Description |
|---|---|
| 💬 **Interroger un document** | Posez vos questions sur un PDF à un LLM 100 % local (Gemma 4 sur WebGPU, ou SmolVLM sur CPU) — extraction du texte embarqué, OCR en repli pour les scans |
| 📄 **Créateur PDF** | Document vierge (A4, Letter, custom), texte, images, formes — éléments déplaçables, redimensionnables, avec gestion des calques |
| ✏️ **Éditeur / Annotateur** | Ouvre un PDF existant : surlignage, texte libre, formes, signature à main levée, sticky notes, ajout/suppression/réorganisation/rotation de pages |
| 🔗 **Fusionneur** | Fusion multi-fichiers (PDF + images), réordonnancement par drag & drop, aperçu avant export |
| ✂️ **Éclateur** | Découpage par plages ou « une page = un fichier », export `.zip` |
| 🧠 **Splitteur intelligent** | Pipeline texte/OCR → détection de ruptures de document (regex configurables, pages blanches, similarité visuelle) avec validation manuelle des coupures (aperçu au survol), et vérification multimodale de chaque frontière par LLM local — [fonctionnement détaillé](docs/splitteur-intelligent.md) |
| 🔍 **OCR** | Extraction de texte (français + anglais), prétraitement d'image (binarisation adaptative) et modèle haute précision en option, export `.txt` ou PDF cherchable (couche texte invisible) — [conseils et fonctionnement](docs/ocr.md) |
| 🧾 **Vérificateur Factur-X** | Lecture et contrôle de conformité de factures électroniques (norme AFNOR / EN 16931) : profil, champs obligatoires, clés SIREN/TVA, cohérence des montants, export JSON — [fonctionnement détaillé](docs/facturx.md) |

## Stack

- **Vite + React 19 (TypeScript)**, state via **Zustand**
- **pdf-lib** (manipulation) + **pdf.js** (rendu) + **tesseract.js** (OCR WASM, assets vendorés dans `public/`)
- **react-konva** (canvas d'édition/annotation), **@dnd-kit** (drag & drop), **framer-motion** (animations)
- **Tailwind CSS v4 + daisyUI v5** — sélecteur de thème persistant (localStorage)
- **IndexedDB** (via `idb`) pour la persistance de session : rien n'est perdu si l'onglet se ferme
- **IA locale** : [WebLLM](https://github.com/mlc-ai/web-llm) (Gemma 2/3, WebGPU) + [transformers.js](https://github.com/huggingface/transformers.js) (Gemma 4 multimodal sur WebGPU, SmolVLM sur CPU)

## Développement

```bash
npm install
npm run dev      # serveur de dev sur http://localhost:5173
npm run build    # tsc + build de production dans dist/
npm run lint     # oxlint
npm run preview  # sert le build de production
```

## Architecture

```
src/
├── modules/          # un dossier par module (home, create, edit, merge, split, smart-split, ocr, facturx, docchat)
├── components/ui/    # wrappers daisyUI réutilisables (Toast, ColorWell, SegmentedControl, LlmLoadCard…)
├── lib/              # wrappers pdf.js, tesseract, LLM (2 runtimes), détection matérielle, IndexedDB
├── workers/          # Web Workers d'inférence (WebLLM, transformers.js)
└── store/            # store Zustand global (module actif)
public/
├── tesseract/        # worker + core WASM tesseract.js (vendorés → fonctionne hors-ligne)
└── tessdata/         # modèles fra + eng
```

### IA locale (LLM dans le navigateur)

Deux runtimes derrière une même API (`src/lib/llm.ts`, chargés en lazy dans des Web Workers) :

- **WebLLM/MLC** pour Gemma 3 1B et Gemma 2 2B (texte, WebGPU) ;
- **transformers.js/ONNX Runtime** pour Gemma 4 E2B/E4B (multimodal, WebGPU) et SmolVLM 256M (multimodal, CPU — machines sans GPU).

Les modèles sont téléchargés au premier usage depuis le CDN (MLC ou Hugging Face) puis mis en cache — seule exception au « aucun CDN » ; l'inférence et les documents restent 100 % locaux. Un détecteur de configuration (WebGPU, `shader-f16`, indice de VRAM) recommande le modèle adapté à la machine, avec bascule automatique sur variante f32 si le GPU n'a pas `shader-f16`.

Utilisé par le **Splitteur intelligent** (vérification multimodale des frontières entre pages : le modèle voit l'image des pages, pas seulement leur texte OCR) et par **Interroger un document** (chat avec contexte documentaire).

## Déploiement

`npm run build` produit un site statique autonome dans `dist/` (~69 Mo, dont les assets OCR fast/best et les cœurs WASM). Déployable tel quel sur n'importe quel hébergeur statique (Netlify, Vercel, GitHub Pages, nginx…). Aucune variable d'environnement, aucun service obligatoire (les CDN de modèles ne sont sollicités que si l'IA est activée). WebGPU exige un contexte sécurisé : servir en **HTTPS** (ou localhost).
