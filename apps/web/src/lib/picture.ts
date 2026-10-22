// The app's own pictures, loaded so a canvas can draw them and still be read and saved: a canvas
// holding a picture from another origin can't be, whatever headers the storage sends, so Blob
// files come through the app's own origin (/api/picture).

export const sameOriginUrl = (url: string) =>
  url.startsWith('/') ? url : `/api/picture?url=${encodeURIComponent(url)}`

const images = new Map<string, Promise<HTMLImageElement>>()

/** Loads (once) one of the app's pictures for drawing on a canvas. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  let image = images.get(url)
  if (!image) {
    image = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('A picture could not be loaded.'))
      img.src = sameOriginUrl(url)
    })
    image.catch(() => images.delete(url))
    images.set(url, image)
  }
  return image
}
