# Splitteur intelligent — comment ça marche

Le splitteur intelligent sert à découper un **PDF « fourre-tout »** (un scan de 40 pages contenant 7 factures, par exemple) en **documents individuels**, sans avoir à repérer les frontières à la main.

## Utilisation simple (sans toucher aux réglages)

1. **Déposez** votre PDF multi-documents.
2. Cliquez sur **Analyser**. L'app lit chaque page et propose des coupures (traits + ciseaux bleus entre les pages).
3. **Ajustez si besoin** : cliquez sur les ciseaux entre deux pages pour ajouter ou retirer une coupure. Chaque futur document est encadré d'une couleur et numéroté.
4. Cliquez sur **Exporter** : vous récupérez un `.zip` avec un PDF par document détecté.

Les réglages par défaut conviennent à la plupart des cas : détection des mentions « Facture n° » / « Invoice # » en début de document, et pages blanches traitées comme séparateurs (puis retirées de l'export).

## Ce qui se passe pendant l'analyse

Pour chaque page, dans l'ordre :

1. **Rendu** — la page est convertie en image dans le navigateur (via pdf.js). Rien n'est envoyé sur un serveur.
2. **Détection de page blanche** — l'app mesure le « taux d'encre » : le pourcentage de pixels non blancs. En dessous du seuil (0,10 % par défaut), la page est considérée blanche. Les pages blanches sont fréquentes dans les scans recto/verso et marquent souvent la fin d'un document.
3. **OCR** — le texte de la page est extrait par reconnaissance optique (tesseract.js, français + anglais), sauf pour les pages blanches. C'est l'étape la plus longue ; la progression affichée est réelle.
4. **Empreinte visuelle** — une signature compacte de l'apparence de la page (aHash 8×8) est calculée, pour pouvoir comparer visuellement les pages entre elles.

Une fois toutes les pages analysées, des **coupures sont proposées** à partir de trois signaux, chacun activable dans les réglages avancés :

| Signal | Principe | Défaut |
|---|---|---|
| **Motifs de début de document** | Si le texte OCR d'une page matche un des motifs (regex), un nouveau document commence sur cette page | Activé (`Facture\s+n[°o]`, `Invoice\s+#?\d`) |
| **Pages blanches** | Une page blanche suivie d'une page non blanche → coupure après la blanche | Activé |
| **Rupture visuelle** | Deux pages consécutives très différentes visuellement (distance de Hamming entre empreintes > seuil) → coupure suggérée. Signal secondaire, plus bruité | Désactivé |

En survolant des ciseaux actifs, une infobulle indique **pourquoi** la coupure a été proposée.

## Réglages avancés

- **Motifs de début de document** : une expression régulière par ligne, insensible à la casse, testée sur le texte OCR de chaque page. Adaptez-les à vos documents : `Dossier\s+\d+`, `Bulletin de paie`, `Contrat de`, un en-tête d'entreprise récurrent… Si une page matche, elle est considérée comme la première page d'un nouveau document.
- **Seuil d'encre** (pages blanches) : montez-le (ex. 0,3–0,5 %) si vos scans ont du bruit (points, traces de pli) qui empêche des pages vides d'être reconnues comme blanches ; descendez-le si des pages peu denses sont prises à tort pour des blanches.
- **Exclure les pages blanches de l'export** : les pages blanches détectées ne sont pas incluses dans les PDF finaux (utile pour nettoyer les scans recto/verso). Décochez pour les conserver.
- **Rupture de similarité visuelle** : utile quand les documents n'ont ni motif texte fiable ni séparateurs blancs, mais des mises en page bien distinctes. La **sensibilité** est la distance (0–64) au-delà de laquelle une coupure est suggérée : plus la valeur est basse, plus il y aura de propositions (et de faux positifs). À utiliser comme signal d'appoint, à vérifier à l'œil.

Les réglages sont mémorisés dans le navigateur (localStorage) d'une session à l'autre.

## Limites et cas particuliers

- **Qualité de l'OCR** : sur des scans de mauvaise qualité, penchés ou en petite taille, l'OCR peut rater un motif → coupure manquante. Le résultat est toujours corrigeable à la main avant export.
- **Aucune coupure détectée ?** Vos documents n'ont probablement ni motif correspondant ni pages blanches : ajoutez un motif adapté dans les réglages avancés, ou activez la rupture visuelle, ou placez les coupures manuellement (les ciseaux fonctionnent sans analyse préalable des signaux).
- **Vérification par IA locale** (réglages avancés) : chaque coupure proposée par les signaux est soumise à un LLM local (Gemma via WebLLM/WebGPU) qui lit le texte OCR de part et d'autre et tranche « nouveau document » ou « continuation ». Une coupure jugée « continuation » est retirée ; les coupures confirmées sont étiquetées dans l'infobulle des ciseaux. Les coupures manuelles ne sont jamais touchées.
  - Le modèle (Gemma 3 1B par défaut, ~700 Mo ; Gemma 2 2B en option) est téléchargé au premier usage depuis le CDN de MLC puis mis en cache par le navigateur — c'est le seul cas où l'app télécharge quelque chose ; **vos documents, eux, ne quittent jamais la machine** (l'inférence est locale).
  - Nécessite WebGPU (Chrome/Edge récents). Si le GPU ne supporte pas l'extension `shader-f16`, l'app bascule automatiquement sur une variante f32 du modèle. En cas de moteur indisponible, les coupures sont conservées telles quelles.
  - En cas de doute (pages sans texte exploitable, réponse ambiguë), la coupure est conservée : le LLM ne fait qu'affiner les autres signaux, il n'en crée pas.
