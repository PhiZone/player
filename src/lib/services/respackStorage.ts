import type {
  BitmapFont,
  Font,
  HitEffects,
  ResourcePackWithId,
  OrdinaryParticle,
  PolygonParticle,
} from '$lib/types';
import { openDB } from './idb';

const STORE_NAME = 'resource_packs';
const SELECTED_KEY = 'selectedResourcePack';

interface StoredFile {
  data: Blob;
  name: string;
  type: string;
}

interface StoredResourcePack {
  id: string;
  name: string;
  author: string;
  description?: string;
  thumbnail?: StoredFile;
  noteSkins: { name: string; file: StoredFile }[];
  hitSounds: { name: string; file: StoredFile }[];
  hitEffects?: {
    spriteSheet: StoredFile;
    frameWidth: number;
    frameHeight: number;
    frameRate: number;
    colorPerfect?: [number, number, number, number];
    colorGood?: [number, number, number, number];
    particle: OrdinaryParticle | PolygonParticle;
  };
  ending: {
    grades: { name: string; file: StoredFile }[];
    music: { levelType: number; beats: number; bpm: number; file: StoredFile }[];
  };
  fonts: (
    | { name: string; type: 'truetype' | 'opentype'; file: StoredFile }
    | { name: string; type: 'bitmap'; texture: StoredFile; descriptor: StoredFile }
  )[];
  options?: {
    holdBodyRepeat?: boolean;
    holdCompact?: boolean;
    holdKeepHead?: boolean;
  };
}

function fileToStored(file: File): StoredFile {
  return { data: file.slice(), name: file.name, type: file.type };
}

function storedToFile(stored: StoredFile): File {
  return new File([stored.data], stored.name, { type: stored.type });
}

function packRespack(pack: ResourcePackWithId<File>): StoredResourcePack {
  return {
    id: pack.id,
    name: pack.name,
    author: pack.author,
    description: pack.description,
    thumbnail: pack.thumbnail ? fileToStored(pack.thumbnail) : undefined,
    noteSkins: pack.noteSkins.map((e) => ({ name: e.name, file: fileToStored(e.file) })),
    hitSounds: pack.hitSounds.map((e) => ({ name: e.name, file: fileToStored(e.file) })),
    hitEffects: pack.hitEffects
      ? {
          spriteSheet: fileToStored(pack.hitEffects.spriteSheet),
          frameWidth: pack.hitEffects.frameWidth,
          frameHeight: pack.hitEffects.frameHeight,
          frameRate: pack.hitEffects.frameRate,
          colorPerfect: pack.hitEffects.colorPerfect,
          colorGood: pack.hitEffects.colorGood,
          particle: pack.hitEffects.particle,
        }
      : undefined,
    ending: {
      grades: pack.ending.grades.map((e) => ({ name: e.name, file: fileToStored(e.file) })),
      music: pack.ending.music.map((e) => ({
        levelType: e.levelType,
        beats: e.beats,
        bpm: e.bpm,
        file: fileToStored(e.file),
      })),
    },
    fonts: pack.fonts.map((e) =>
      e.type === 'bitmap'
        ? {
            name: e.name,
            type: e.type as 'bitmap',
            texture: fileToStored(e.texture),
            descriptor: fileToStored(e.descriptor),
          }
        : {
            name: e.name,
            type: e.type as 'truetype' | 'opentype',
            file: fileToStored(e.file),
          },
    ),
    options: pack.options,
  };
}

function unpackRespack(stored: StoredResourcePack): ResourcePackWithId<File> {
  return {
    id: stored.id,
    name: stored.name,
    author: stored.author,
    description: stored.description,
    thumbnail: stored.thumbnail ? storedToFile(stored.thumbnail) : undefined,
    noteSkins: stored.noteSkins.map((e) => ({
      name: e.name as ResourcePackWithId<File>['noteSkins'][number]['name'],
      file: storedToFile(e.file),
    })),
    hitSounds: stored.hitSounds.map((e) => ({
      name: e.name as ResourcePackWithId<File>['hitSounds'][number]['name'],
      file: storedToFile(e.file),
    })),
    hitEffects: stored.hitEffects
      ? ({
          spriteSheet: storedToFile(stored.hitEffects.spriteSheet),
          frameWidth: stored.hitEffects.frameWidth,
          frameHeight: stored.hitEffects.frameHeight,
          frameRate: stored.hitEffects.frameRate,
          colorPerfect: stored.hitEffects.colorPerfect,
          colorGood: stored.hitEffects.colorGood,
          particle: stored.hitEffects.particle,
        } as HitEffects<File>)
      : undefined,
    ending: {
      grades: stored.ending.grades.map((e) => ({
        name: e.name as ResourcePackWithId<File>['ending']['grades'][number]['name'],
        file: storedToFile(e.file),
      })),
      music: stored.ending.music.map((e) => ({
        levelType: e.levelType as ResourcePackWithId<File>['ending']['music'][number]['levelType'],
        beats: e.beats,
        bpm: e.bpm,
        file: storedToFile(e.file),
      })),
    },
    fonts: stored.fonts.map((e) =>
      e.type === 'bitmap'
        ? ({
            name: e.name,
            type: e.type,
            texture: storedToFile(e.texture),
            descriptor: storedToFile(e.descriptor),
          } as BitmapFont<File>)
        : ({
            name: e.name,
            type: e.type,
            file: storedToFile(e.file),
          } as Font<File>),
    ),
    options: stored.options,
  };
}

export async function saveRespack(pack: ResourcePackWithId<File>): Promise<void> {
  const db = await openDB();
  const stored = packRespack(pack);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(stored);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function loadAllRespacks(): Promise<ResourcePackWithId<File>[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      db.close();
      const stored = request.result as StoredResourcePack[];
      resolve(stored.map(unpackRespack));
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function deleteRespack(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export function saveSelectedRespack(id: string): void {
  localStorage.setItem(SELECTED_KEY, id);
}

export function loadSelectedRespack(): string | null {
  return localStorage.getItem(SELECTED_KEY);
}
