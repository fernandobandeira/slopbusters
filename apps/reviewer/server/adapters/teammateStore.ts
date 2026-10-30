import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  moods,
  teammateIdSchema,
  teammateRecordSchema,
  type Mood,
  type TeammateRecord,
} from '../../shared/domain/teammates'
import { logError, UserError } from '../errors'

/** Avatars arrive re-encoded by the browser as square PNGs; these bound what the server keeps. */
const MAX_AVATAR_BYTES = 512 * 1024
const MAX_AVATAR_DIMENSION = 1024

export type StoredTeammate = TeammateRecord & { avatars: Mood[] }

/**
 * Teammates live in `<data>/teammates/<id>/`: `teammate.json` and one PNG per mood under
 * `avatars/`. Ids are slugs checked before they become a path, so every read and write stays
 * inside that folder.
 */
export class TeammateStore {
  private readonly root: string
  constructor(dataDirectory: string) {
    this.root = join(dataDirectory, 'teammates')
  }

  async list(): Promise<StoredTeammate[]> {
    let entries: string[]
    try {
      entries = await readdir(this.root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const teammates = await Promise.all(
      entries
        .filter((entry) => teammateIdSchema.safeParse(entry).success)
        .map((id) => this.get(id)),
    )
    return teammates
      .filter((teammate): teammate is StoredTeammate => Boolean(teammate))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async get(id: string): Promise<StoredTeammate | undefined> {
    const folder = this.folder(id)
    let text: string
    try {
      text = await readFile(join(folder, 'teammate.json'), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    const record = teammateRecordSchema.safeParse(withoutLegacyLogin(safeJson(text)))
    if (!record.success || record.data.id !== id) {
      logError(`Skipping the teammate in ${folder}: its teammate.json is not valid`, record.error)
      return undefined
    }
    return { ...record.data, avatars: await this.avatarMoods(id) }
  }

  async save(record: TeammateRecord): Promise<void> {
    const folder = this.folder(record.id)
    await mkdir(folder, { recursive: true, mode: 0o700 })
    await writeAtomically(
      join(folder, 'teammate.json'),
      `${JSON.stringify(teammateRecordSchema.parse(record), null, 2)}\n`,
    )
  }

  async remove(id: string): Promise<void> {
    await rm(this.folder(id), { recursive: true, force: true })
  }

  async saveAvatar(id: string, mood: Mood, png: Uint8Array): Promise<void> {
    assertAvatarPng(png)
    const folder = join(this.folder(id), 'avatars')
    await mkdir(folder, { recursive: true, mode: 0o700 })
    await writeAtomically(join(folder, `${mood}.png`), png)
  }

  async removeAvatar(id: string, mood: Mood): Promise<void> {
    await rm(this.avatarPath(id, mood), { force: true })
  }

  async avatar(id: string, mood: Mood): Promise<Buffer | undefined> {
    try {
      return await readFile(this.avatarPath(id, mood))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async avatarMoods(id: string): Promise<Mood[]> {
    try {
      const files = new Set(await readdir(join(this.folder(id), 'avatars')))
      return moods.filter((mood) => files.has(`${mood}.png`))
    } catch {
      return []
    }
  }

  private avatarPath(id: string, mood: Mood) {
    return join(this.folder(id), 'avatars', `${moods.includes(mood) ? mood : 'neutral'}.png`)
  }

  private folder(id: string) {
    return join(this.root, teammateIdSchema.parse(id))
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * The browser re-encodes every upload to a PNG; refuse anything else, so the avatar route only
 * ever serves a bounded PNG whatever a client sends.
 */
export function assertAvatarPng(bytes: Uint8Array): void {
  if (bytes.length > MAX_AVATAR_BYTES)
    throw new UserError(`Faces must be under ${String(MAX_AVATAR_BYTES / 1024)} KB.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const isPng =
    bytes.length > 24 &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) &&
    String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR'
  if (!isPng) throw new UserError('Faces must be PNG images.')
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (!width || !height || width > MAX_AVATAR_DIMENSION || height > MAX_AVATAR_DIMENSION)
    throw new UserError(
      `Faces must be at most ${String(MAX_AVATAR_DIMENSION)} pixels on each side.`,
    )
}

async function writeAtomically(path: string, data: string | Uint8Array) {
  const temporary = `${path}.${String(process.pid)}.tmp`
  await writeFile(temporary, data, { mode: 0o600 })
  await rename(temporary, path)
}

/** Earlier versions saved a GitHub login on a teammate; seats now read every reviewer's comments. */
function withoutLegacyLogin(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('login' in value)) return value
  const { login: _login, ...record } = value
  return record
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
