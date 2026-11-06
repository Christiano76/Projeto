import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY, isTheme, resolveInitialTheme } from './themeCore';
import {
  SCENE_PALETTES,
  applyThemedMaterials,
  darkFloorColor,
  getThemedMaterial,
  mixColor,
  mixNumber,
} from '@/components/office/sceneTheme';

describe('tema da interface', () => {
  it('prioriza a preferência salva, depois a do sistema', () => {
    expect(resolveInitialTheme('dark', false)).toBe('dark');
    expect(resolveInitialTheme('light', true)).toBe('light');
    expect(resolveInitialTheme(null, true)).toBe('dark');
    expect(resolveInitialTheme('invalido', false)).toBe('light');
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('blue')).toBe(false);
  });

  it('script de boot define data-theme antes da pintura usando a chave salva', () => {
    const run = (stored: string | null, prefersDark: boolean) => {
      const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
      const fn = new Function('localStorage', 'window', 'document', THEME_BOOT_SCRIPT);
      fn(
        { getItem: (k: string) => (k === THEME_STORAGE_KEY ? stored : null) },
        { matchMedia: () => ({ matches: prefersDark }) },
        { documentElement: root },
      );
      return root;
    };
    expect(run('dark', false).dataset.theme).toBe('dark');
    expect(run(null, true).dataset.theme).toBe('dark');
    expect(run(null, false)).toMatchObject({ dataset: { theme: 'light' }, style: { colorScheme: 'light' } });
  });
});

describe('tema do escritório 3D', () => {
  it('interpola materiais temáticos entre dia e noite', () => {
    const mat = getThemedMaterial('#ffffff', '#000000') as THREE.MeshStandardMaterial;
    expect(getThemedMaterial('#ffffff', '#000000')).toBe(mat); // compartilhado
    applyThemedMaterials(0);
    expect(mat.color.getHexString()).toBe('ffffff');
    applyThemedMaterials(1);
    expect(mat.color.getHexString()).toBe('000000');
    applyThemedMaterials(0.5);
    expect(mat.color.r).toBeGreaterThan(0.1);
    expect(mat.color.r).toBeLessThan(0.9);
  });

  it('modo escuro é mais escuro e frio que o claro', () => {
    const light = new THREE.Color(SCENE_PALETTES.light.background);
    const dark = new THREE.Color(SCENE_PALETTES.dark.background);
    const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(lum(dark)).toBeLessThan(lum(light));
    expect(dark.b).toBeGreaterThanOrEqual(dark.r); // tom azulado, não quente
    const floor = new THREE.Color(darkFloorColor('#e3e9f0'));
    expect(lum(floor)).toBeLessThan(lum(new THREE.Color('#e3e9f0')) / 3);
    expect(mixNumber('sunIntensity', 1)).toBe(SCENE_PALETTES.dark.sunIntensity);
    expect(mixColor('background', 0, new THREE.Color()).getHexString()).toBe(light.getHexString());
  });
});
