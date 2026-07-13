# OCR — comment obtenir un bon résultat

Le module OCR extrait le texte d'un PDF scanné ou d'une image (tesseract.js, français + anglais, tout dans le navigateur). Le moteur est entraîné sur du texte **net, sombre sur fond clair, d'au moins ~20 px de hauteur** — les photos de documents (ombres, éclairage inégal, faible résolution) sont le cas le plus difficile. Deux options permettent d'y remédier.

## Prétraitement (activé par défaut)

Avant reconnaissance, l'image passe par un pipeline (`src/lib/preprocess.ts`) :

1. **Agrandissement** si l'image fait moins de 1500 px de large (le LSTM lit mal le petit texte) ;
2. **Niveaux de gris + étirement de contraste** (percentiles 1–99), avec inversion automatique si le texte est clair sur fond sombre ;
3. **Binarisation adaptative** (méthode de Bradley : seuil = moyenne locale calculée par image intégrale) — c'est elle qui neutralise ombres et vignettage, là où le seuil global appliqué en interne par tesseract transforme la moitié d'une photo ombrée en aplat noir ;
4. **Anti-mouchetures** : les amas de pixels quasi isolés créés par la binarisation du grain sont blanchis (deux passes).

La vignette affichée à côté du résultat montre l'image **réellement analysée** : si elle est illisible pour vous, elle l'est aussi pour le moteur. Désactivez le prétraitement si votre document est déjà propre et que le résultat se dégrade (rare).

## Modèle haute précision

Par défaut, l'app utilise les modèles tesseract « fast » (~2,5 Mo, quantifiés en entiers). L'option **Modèle haute précision** charge les modèles « best » (float, ~16 Mo, chargés au premier usage puis mis en cache par le navigateur) : plus lents, mais nettement plus fiables sur les scans difficiles, les petites tailles de police et les accents. Le réglage vaut aussi pour l'OCR du splitteur intelligent.

Après un premier essai, changez les options puis **Relancer** : le fichier n'a pas besoin d'être redéposé.

## Conseils de prise de vue

- Photographiez **à plat, de face** — la perspective et l'inclinaison ne sont pas corrigées ;
- évitez les ombres portées et le flou de bougé ;
- préférez un scan 300 dpi quand c'est possible ;
- seuls le **français et l'anglais** sont reconnus.

## Note technique (modèles best et cœur WASM)

Les modèles float « best » exigent le cœur WASM **complet** et la variante **simd** : les cœurs allégés `-lstm` n'embarquent pas les fonctions float, et les builds `relaxedsimd` de tesseract.js-core v6 référencent `DotProductSSE` sans l'implémenter (abort au chargement). D'où le `corePath` explicite vers `tesseract-core-simd.wasm.js` en mode haute précision dans `src/lib/ocr.ts`. Chaque jeu de modèles a son propre `cachePath` IndexedDB pour éviter les collisions de cache.
