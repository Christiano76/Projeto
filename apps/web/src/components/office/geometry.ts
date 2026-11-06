import * as THREE from 'three';
import type { PartGeometry } from './models';

const cache = new Map<string, THREE.BufferGeometry>();

/** Geometrias compartilhadas (uma instância por forma/tamanho). */
export function getGeometry(g: PartGeometry): THREE.BufferGeometry {
  const key = JSON.stringify(g);
  let geom = cache.get(key);
  if (!geom) {
    switch (g.kind) {
      case 'box':
        geom = new THREE.BoxGeometry(...g.size);
        break;
      case 'cyl':
        geom = new THREE.CylinderGeometry(g.rTop, g.rBottom, g.height, g.segments ?? 8);
        break;
      case 'ico':
        geom = new THREE.IcosahedronGeometry(g.radius, g.detail ?? 0);
        break;
    }
    cache.set(key, geom);
  }
  return geom;
}

const materialCache = new Map<string, THREE.Material>();

/** Materiais compartilhados, com flatShading para o visual low-poly. */
export function getMaterial(color: string, opts: { emissive?: boolean; vertexColors?: boolean } = {}): THREE.Material {
  const key = `${color}|${opts.emissive ? 1 : 0}|${opts.vertexColors ? 1 : 0}`;
  let mat = materialCache.get(key);
  if (!mat) {
    mat = opts.emissive
      ? new THREE.MeshBasicMaterial({ color, toneMapped: false })
      : new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05 });
    materialCache.set(key, mat);
  }
  return mat;
}
