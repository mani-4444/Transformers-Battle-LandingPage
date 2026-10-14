export interface Quality {
  tier: 'high' | 'low';
  dprCap: number;
  shadowMapSize: number;
  bloom: boolean;
  motionBlur: boolean;
  sparks: number;
  debris: number;
  smoke: number;
  embers: number;
  reducedMotion: boolean;
}

export function detectQuality(reducedMotion: boolean): Quality {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const small = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 700;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const low = coarse || small || cores <= 4;
  const rm = reducedMotion ? 0.5 : 1;
  return {
    tier: low ? 'low' : 'high',
    dprCap: low ? 1.5 : 2,
    shadowMapSize: low ? 1024 : 2048,
    bloom: true,
    motionBlur: !reducedMotion && !low,
    sparks: Math.round((low ? 700 : 1400) * rm),
    debris: Math.round((low ? 90 : 180) * rm),
    smoke: Math.round((low ? 260 : 520) * rm),
    embers: Math.round((low ? 220 : 480) * rm),
    reducedMotion,
  };
}
