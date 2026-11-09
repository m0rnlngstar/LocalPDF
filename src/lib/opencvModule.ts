/**
 * Point d'entrée chargé dynamiquement par opencv.ts. Le paquet exporte une
 * Promise : importée directement via import(), l'interop CommonJS du bundler
 * en fait un faux « thenable » qui casse l'await. On la renvoie donc
 * emballée dans un objet.
 */
import cv from '@techstark/opencv-js'

export function openCvExport(): { value: unknown } {
  return { value: cv }
}
