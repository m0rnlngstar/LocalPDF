# PDF Toolkit

Application web de manipulation de PDF **100% côté client** : aucun backend, aucun fichier n'est jamais envoyé sur un serveur. Tout le traitement (rendu, édition, OCR, export) se fait dans le navigateur, ce qui en fait une alternative locale à iLovePDF/Smallpdf. Déployable en simple site statique.

## Modules

| Module | Description |
|---|---|
| 📄 **Créateur PDF** | Document vierge (A4, Letter, custom), texte, images, formes — éléments déplaçables, redimensionnables, avec gestion des calques |
| ✏️ **Éditeur / Annotateur** | Ouvre un PDF existant : surlignage, texte libre, formes, signature à main levée, sticky notes, ajout/suppression/réorganisation/rotation de pages |
| 🔗 **Fusionneur** | Fusion multi-fichiers (PDF + images), réordonnancement par drag & drop, aperçu avant export |
| ✂️ **Éclateur** | Découpage par plages ou « une page = un fichier », export `.zip` |
| 🧠 **Splitteur intelligent** | Pipeline OCR → détection de ruptures de document (regex configurables, pages blanches, similarité visuelle) avec validation manuelle des coupures |
| 🔍 **OCR** | Extraction de texte (français + anglais), export `.txt` ou PDF cherchable (couche texte invisible) |

## Stack

- **Vite + React 19 (TypeScript)**, state via **Zustand**
- **pdf-lib** (manipulation) + **pdf.js** (rendu) + **tesseract.js** (OCR WASM, assets vendorés dans `public/`)
- **react-konva** (canvas d'édition/annotation), **@dnd-kit** (drag & drop), **framer-motion** (animations)
- **Tailwind CSS v4 + daisyUI v5** — sélecteur de thème persistant (localStorage)
- **IndexedDB** (via `idb`) pour la persistance de session : rien n'est perdu si l'onglet se ferme

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
├── modules/          # un dossier par module (create, edit, merge, split, smart-split, ocr)
├── components/ui/    # wrappers daisyUI réutilisables (Toast, ThemeController, FileDropzone…)
├── lib/              # wrappers pdf.js, tesseract, polices, IndexedDB
└── store/            # store Zustand global (module actif)
public/
├── tesseract/        # worker + core WASM tesseract.js (vendorés → fonctionne hors-ligne)
└── tessdata/         # modèles fra + eng
```

### Point d'extension : vérification des coupures par LLM

Le splitteur intelligent expose un hook optionnel `verifySplitBoundary(pageBefore, pageAfter): Promise<boolean>` dans `src/modules/smart-split/hooks.ts` (actuellement `null`). Il est appelé par le pipeline sur chaque coupure candidate quand il est fourni — prévu pour brancher plus tard une vérification par LLM local (ex. Gemma via WebLLM) sans toucher au pipeline.

## Déploiement

`npm run build` produit un site statique autonome dans `dist/` (~25 Mo, dont les assets OCR). Déployable tel quel sur n'importe quel hébergeur statique (Netlify, Vercel, GitHub Pages, nginx…). Aucune variable d'environnement, aucun service externe.
