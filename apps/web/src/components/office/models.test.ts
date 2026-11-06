import { describe, expect, it } from 'vitest';
import { MODELS } from './models';

/** Nenhum móvel flutua nem afunda: a peça mais baixa de cada modelo toca o chão (y = 0). */
describe('modelos 3D apoiados no chão', () => {
  for (const [type, parts] of Object.entries(MODELS)) {
    if (type === 'monitor') continue; // apoiado sobre a mesa
    if (type === 'whiteboard' || type === 'tv_screen' || type === 'wall_sign') continue; // fixados na parede
    it(type, () => {
      const bottoms = parts.map((p) => {
        const g = p.geometry;
        const half = g.kind === 'box' ? g.size[1] / 2 : g.kind === 'cyl' ? g.height / 2 : g.radius;
        return p.position[1] - half;
      });
      expect(Math.min(...bottoms)).toBeGreaterThanOrEqual(-1e-6);
      expect(Math.min(...bottoms)).toBeLessThanOrEqual(0.0011);
    });
  }

  it('monitor apoia exatamente sobre o tampo das mesas', () => {
    const top = (type: 'desk' | 'exec_desk') => {
      const p = MODELS[type][0]!;
      return p.position[1] + (p.geometry.kind === 'box' ? p.geometry.size[1] / 2 : 0);
    };
    const base = MODELS.monitor[0]!;
    const baseBottom = base.position[1] - (base.geometry.kind === 'box' ? base.geometry.size[1] / 2 : 0);
    expect(baseBottom).toBeCloseTo(top('desk'), 3);
    expect(baseBottom).toBeCloseTo(top('exec_desk'), 3);
  });
});
