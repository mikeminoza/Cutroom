// Reads the pixel size of an image from its first bytes (PNG, JPEG, WebP, GIF), without decoding
// it, so a generated image can be saved with its size on the server.

export function imageDimensions(data: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...data.subarray(offset, offset + length))
  const ok = (size: { width: number; height: number }) => (size.width > 0 && size.height > 0 ? size : null)

  // PNG: signature, then the IHDR chunk with width and height.
  if (data.length >= 24 && data[0] === 0x89 && ascii(1, 3) === 'PNG') {
    return ok({ width: view.getUint32(16), height: view.getUint32(20) })
  }
  // GIF: logical screen size.
  if (data.length >= 10 && ascii(0, 3) === 'GIF') {
    return ok({ width: view.getUint16(6, true), height: view.getUint16(8, true) })
  }
  // WebP: RIFF container with a VP8, VP8L or VP8X chunk.
  if (data.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4)
    if (chunk === 'VP8 ') {
      return ok({ width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff })
    }
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true)
      return ok({ width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 })
    }
    if (chunk === 'VP8X') {
      const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16))
      const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16))
      return ok({ width, height })
    }
    return null
  }
  // JPEG: walk the markers to the first start-of-frame.
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset++
        continue
      }
      const marker = data[offset + 1]
      // Standalone markers have no length.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        offset += marker === 0xff ? 1 : 2
        continue
      }
      const length = view.getUint16(offset + 2)
      const isFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) return ok({ height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) })
      offset += 2 + length
    }
  }
  return null
}

export function imageExtension(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg'
  if (mimeType.includes('webp')) return '.webp'
  if (mimeType.includes('gif')) return '.gif'
  return '.png'
}
