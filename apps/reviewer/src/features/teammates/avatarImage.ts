/** What the wizard accepts before re-encoding; the server only ever receives a square PNG. */
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const ACCEPTED_AVATAR_TYPES = ACCEPTED_TYPES.join(',')
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
/** Twice the largest size a face is shown at, so it stays sharp on high-density screens. */
const AVATAR_SIZE = 256
const MAX_AVATAR_BYTES = 512 * 1024

export interface AvatarImage {
  /** The PNG as base64, for the upload. */
  png: string
  /** The same PNG as a data URL, for the preview. */
  preview: string
}

/**
 * Decode an image in the browser and re-encode its centered square as a PNG, so whatever the
 * user picks, the app stores a small image it decoded itself.
 */
export async function avatarFromFile(file: File): Promise<AvatarImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error('Use a PNG, JPEG or WebP image.')
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Use an image under 2 MB.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This image could not be read. Try another file.')
  }
  try {
    const preview = squarePng(bitmap)
    const png = preview.slice(preview.indexOf(',') + 1)
    if ((png.length * 3) / 4 > MAX_AVATAR_BYTES)
      throw new Error('This image is too detailed to store as a face. Try a simpler one.')
    return { png, preview }
  } finally {
    bitmap.close()
  }
}

function squarePng(bitmap: ImageBitmap): string {
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot resize images.')
  const side = Math.min(bitmap.width, bitmap.height)
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  )
  return canvas.toDataURL('image/png')
}
