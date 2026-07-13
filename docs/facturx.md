# Vérificateur Factur-X — comment ça marche

Ce module lit et vérifie une **facture électronique Factur-X** (norme AFNOR XP Z12-012 / EN 16931), le format hybride retenu pour la réforme française de la facturation électronique : un PDF lisible à l'œil qui embarque un fichier XML (`factur-x.xml`, syntaxe CII « Cross Industry Invoice ») portant les données structurées. C'est ce XML qui fait foi pour les logiciels comptables et les plateformes de dématérialisation.

## Utilisation

1. Déposez le PDF de la facture.
2. Le module extrait le XML embarqué et affiche un **verdict** : conforme / lisible avec avertissements / non conforme, avec le **profil** détecté.
3. Le détail des contrôles liste chaque vérification (✓ / ⚠ / ✕ avec explication).
4. Les données de la facture sont affichées : vendeur/acheteur (SIREN, TVA, adresse), dates, références, totaux, TVA par taux, lignes, XML source.
5. **Exporter JSON** télécharge les données extraites en JSON structuré.

Un PDF sans XML embarqué (simple scan, export bureautique) est signalé comme non conforme : ce n'est pas une facture électronique au sens de la réforme, seulement une « facture image ».

## Les profils Factur-X

Le profil (BT-24) indique la richesse des données du XML :

| Profil | Contenu |
|---|---|
| MINIMUM | Identités, totaux — insuffisant pour une intégration comptable complète |
| BASIC WL | + TVA par taux, échéances (sans lignes de facture) |
| BASIC | + lignes de facture |
| EN 16931 | Sémantique complète de la norme européenne |
| EXTENDED | Extensions au-delà de la norme (cas complexes) |

## Les contrôles effectués

- **Structure** : présence de la pièce jointe XML, nom `factur-x.xml`, déclaration PDF/A-3 dans les métadonnées XMP, XML bien formé avec racine `CrossIndustryInvoice`.
- **Champs obligatoires** (socle commun à tous les profils) : numéro de facture (BT-1), date d'émission (BT-2, format AAAAMMJJ), type de document (BT-3, ex. 380 = facture, 381 = avoir), devise (BT-5), noms du vendeur (BT-27) et de l'acheteur (BT-44).
- **Identifiants français** : SIREN du vendeur présent et **clé de Luhn valide** ; n° de TVA intracommunautaire français avec **clé de contrôle vérifiée** (calculée à partir du SIREN) ; SIREN de l'acheteur (attendu en B2B France).
- **Cohérence des montants** : TTC = HT + TVA (bloquant), net à payer = TTC − déjà payé, somme des lignes = total des lignes (BT-106), et pour chaque taux de TVA : montant = base × taux.

Trois niveaux : **✕ bloquant** (la facture n'est pas exploitable en l'état), **⚠ avertissement** (à corriger, non bloquant), **✓ OK**.

## Limites

C'est un contrôle de premier niveau, pensé pour repérer une facture mal générée ou non conforme avant de l'envoyer en comptabilité. Il ne remplace pas :

- la validation **Schematron** complète de la norme (des centaines de règles par profil) ;
- les contrôles d'une **plateforme de dématérialisation agréée** (annuaire, statuts, cycle de vie) ;
- la vérification de la **conformité PDF/A-3 réelle** du conteneur (seule la déclaration XMP est lue).

La syntaxe UBL (autorisée par la réforme aux côtés de CII) et l'ordre Order-X ne sont pas pris en charge à ce stade.
