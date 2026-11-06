import * as THREE from 'three';
import type { Theme } from '@/lib/themeCore';

/**
 * Tokens de design do escritório 3D. Cada valor tem uma versão diurna
 * (claro) e noturna (escuro); a cena interpola entre elas gradualmente.
 */
export interface ScenePalette {
  background: string;
  sky: string;
  groundLight: string;
  hemiIntensity: number;
  sun: string;
  sunIntensity: number;
  ambient: string;
  ambientIntensity: number;
  ground: string;
  slab: string;
  wallInterior: string;
  wallExterior: string;
  wallCap: string;
  /** Cor que o piso das salas assume (mistura) no tema. */
  floorTint: string;
  floorTintAmount: number;
}

export const SCENE_PALETTES: Record<Theme, ScenePalette> = {
  light: {
    background: '#e9eff6',
    sky: '#f6faff',
    groundLight: '#b9c6d6',
    hemiIntensity: 1.15,
    sun: '#ffffff',
    sunIntensity: 1.55,
    ambient: '#dbeafe',
    ambientIntensity: 0.15,
    ground: '#d7e0ea',
    slab: '#aebccd',
    wallInterior: '#f4f7fb',
    wallExterior: '#cdd7e3',
    wallCap: '#8fa1b8',
    floorTint: '#ffffff',
    floorTintAmount: 0,
  },
  dark: {
    background: '#04070d',
    sky: '#6a93d6',
    groundLight: '#0b1324',
    hemiIntensity: 1.45,
    sun: '#a8ddff',
    sunIntensity: 1.35,
    ambient: '#2a4ea8',
    ambientIntensity: 0.6,
    ground: '#070c16',
    slab: '#0e1626',
    wallInterior: '#26354e',
    wallExterior: '#1a263c',
    wallCap: '#1596bb',
    floorTint: '#0a1322',
    floorTintAmount: 0.74,
  },
};

/** Fator de mistura atual: 0 = claro, 1 = escuro. Animado pelo ThemeAnimator. */
export const themeMix = { value: 0, target: 0, initialized: false };

interface ThemedEntry {
  material: THREE.Material & { color: THREE.Color };
  light: THREE.Color;
  dark: THREE.Color;
}

const registry: ThemedEntry[] = [];
const cache = new Map<string, THREE.Material>();

/**
 * Material cuja cor acompanha o tema (interpolada). Compartilhado por chave.
 * `unlit` cria um material sem iluminação (útil para filetes luminosos).
 */
export function getThemedMaterial(light: string, dark: string, opts: { unlit?: boolean } = {}): THREE.Material {
  const key = `${light}|${dark}|${opts.unlit ? 1 : 0}`;
  let mat = cache.get(key);
  if (!mat) {
    const material = opts.unlit
      ? new THREE.MeshBasicMaterial({ color: light, toneMapped: false })
      : new THREE.MeshStandardMaterial({ color: light, flatShading: true, roughness: 0.85, metalness: 0.05 });
    const entry: ThemedEntry = { material, light: new THREE.Color(light), dark: new THREE.Color(dark) };
    entry.material.color.copy(entry.light).lerp(entry.dark, themeMix.value);
    registry.push(entry);
    cache.set(key, material);
    mat = material;
  }
  return mat;
}

/**
 * Material temático exclusivo (não compartilhado), por exemplo com textura
 * própria. Quem cria é responsável por `dispose()` — o registro é limpo junto.
 */
export function createThemedMaterial(light: string, dark: string, opts: { map?: THREE.Texture } = {}): THREE.Material {
  const material = new THREE.MeshStandardMaterial({
    color: light,
    flatShading: false,
    roughness: 0.9,
    metalness: 0.02,
    ...(opts.map ? { map: opts.map } : {}),
  });
  const entry: ThemedEntry = { material, light: new THREE.Color(light), dark: new THREE.Color(dark) };
  material.color.copy(entry.light).lerp(entry.dark, themeMix.value);
  registry.push(entry);
  material.addEventListener('dispose', () => {
    const i = registry.indexOf(entry);
    if (i >= 0) registry.splice(i, 1);
  });
  return material;
}

/** Atualiza todas as cores temáticas para o fator de mistura `t`. */
export function applyThemedMaterials(t: number) {
  for (const e of registry) e.material.color.copy(e.light).lerp(e.dark, t);
}

/** Versão noturna de uma cor de piso (mistura com o tom do tema escuro). */
export function darkFloorColor(color: string): string {
  const p = SCENE_PALETTES.dark;
  return '#' + new THREE.Color(color).lerp(new THREE.Color(p.floorTint), p.floorTintAmount).getHexString();
}

/** Interpola uma propriedade numérica da paleta. */
export function mixNumber(key: 'hemiIntensity' | 'sunIntensity' | 'ambientIntensity', t: number): number {
  return SCENE_PALETTES.light[key] + (SCENE_PALETTES.dark[key] - SCENE_PALETTES.light[key]) * t;
}

const ca = new THREE.Color();
const cb = new THREE.Color();
export function mixColor(
  key: 'background' | 'sky' | 'groundLight' | 'sun' | 'ambient',
  t: number,
  out: THREE.Color,
): THREE.Color {
  ca.set(SCENE_PALETTES.light[key]);
  cb.set(SCENE_PALETTES.dark[key]);
  return out.copy(ca).lerp(cb, t);
}
