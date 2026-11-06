'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { prefersReducedMotion, useThemeStore } from '@/lib/theme';
import { applyThemedMaterials, mixColor, mixNumber, themeMix } from './sceneTheme';

/** Duração aproximada da transição de iluminação (s). */
const TRANSITION_SECONDS = 1.2;

/**
 * Faz a iluminação, o fundo e os materiais temáticos acompanharem o tema,
 * com transição gradual (instantânea se o usuário prefere menos movimento).
 */
export function ThemeAnimator({
  hemi,
  sun,
  ambient,
}: {
  hemi: React.RefObject<THREE.HemisphereLight | null>;
  sun: React.RefObject<THREE.DirectionalLight | null>;
  ambient: React.RefObject<THREE.AmbientLight | null>;
}) {
  const theme = useThemeStore((s) => s.theme);
  const { scene, invalidate } = useThree();
  const dirty = useRef(true);

  useEffect(() => {
    themeMix.target = theme === 'dark' ? 1 : 0;
    if (!themeMix.initialized || prefersReducedMotion()) {
      themeMix.value = themeMix.target;
      themeMix.initialized = true;
    }
    dirty.current = true;
    invalidate();
  }, [theme, invalidate]);

  useFrame((_, dt) => {
    const m = themeMix;
    if (m.value !== m.target) {
      const step = Math.min(dt, 0.1) / TRANSITION_SECONDS;
      m.value = m.target > m.value ? Math.min(m.target, m.value + step) : Math.max(m.target, m.value - step);
      dirty.current = true;
    }
    if (!dirty.current) return;
    dirty.current = false;
    // Suavização (ease in-out) do fator linear
    const t = m.value * m.value * (3 - 2 * m.value);
    if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color();
    mixColor('background', t, scene.background as THREE.Color);
    if (hemi.current) {
      mixColor('sky', t, hemi.current.color);
      mixColor('groundLight', t, hemi.current.groundColor);
      hemi.current.intensity = mixNumber('hemiIntensity', t);
    }
    if (sun.current) {
      mixColor('sun', t, sun.current.color);
      sun.current.intensity = mixNumber('sunIntensity', t);
    }
    if (ambient.current) {
      mixColor('ambient', t, ambient.current.color);
      ambient.current.intensity = mixNumber('ambientIntensity', t);
    }
    applyThemedMaterials(t);
  });

  return null;
}
