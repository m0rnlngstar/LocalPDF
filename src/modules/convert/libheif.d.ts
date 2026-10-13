declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifImage {
    get_width(): number
    get_height(): number
    display(target: ImageData, cb: (result: ImageData | null) => void): void
    free(): void
  }
  interface HeifLib {
    HeifDecoder: new () => { decode(data: ArrayBuffer | Uint8Array): HeifImage[] }
  }
  const factory: () => HeifLib | Promise<HeifLib>
  export default factory
}
