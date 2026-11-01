/**
 * Seeded colour scheme modelled on FlClash's design language (see README "Design notes"):
 *  - structure is drawn with neutral fills in four levels (page → card → block → inset), never borders;
 *  - surfaces stay near-gray (chroma ≤ 3, light paper ≤ 1.5) unless the "tinted" style is chosen;
 *  - "vivid"/"tinted" keep the picked seed as primary, like an Apple accent colour;
 *  - dark mode spreads its levels (6 / 15 / 21 / 27) and lifts titles to tone 97.
 * Re-implemented from scratch on top of Google's HCT colour space.
 */
import { Hct, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';

export type ColorStyle = 'vivid' | 'tinted' | 'soft' | 'monochrome';
export type Brightness = 'light' | 'dark';

export const ACCENT_PRESETS = ['#007AFF', '#CB30E0', '#FF2D55', '#FF383C', '#FF8D28', '#FFCC00', '#34C759', '#8E8E93'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hex = (argb: number) => hexFromArgb(argb).toUpperCase();
const hct = (h: number, c: number, t: number) => hex(Hct.from(h, c, t).toInt());

export interface Scheme {
  [token: string]: string;
}

export function buildScheme(seedHex: string, brightness: Brightness, style: ColorStyle): Scheme {
  const dark = brightness === 'dark';
  const seedArgb = argbFromHex(seedHex);
  const seed = Hct.fromInt(seedArgb);

  // neutral surfaces
  const tint = style === 'tinted' ? Math.min(seed.chroma / 6, 10) : null;
  const neutralChroma = style === 'monochrome' ? 0 : Math.min(seed.chroma / 8, 6);
  const n = (tone: number, cap = 3) => hct(seed.hue, tint ?? Math.min(neutralChroma, cap), tone);
  const nv = (tone: number) => hct(seed.hue, style === 'monochrome' ? 0 : tint ?? Math.min(neutralChroma + 2, 6), tone);

  // primary
  let primary: string;
  let onPrimary: string;
  if (style === 'vivid' || style === 'tinted') {
    const tone = dark ? clamp(seed.tone + 3, 50, 75) : clamp(seed.tone, 35, 60);
    primary = tone === seed.tone ? seedHex.toUpperCase() : hct(seed.hue, seed.chroma, tone);
    onPrimary = tone <= 60 ? '#FFFFFF' : hex(TonalPalette.fromHueAndChroma(seed.hue, seed.chroma).tone(10));
  } else if (style === 'soft') {
    const pal = TonalPalette.fromHueAndChroma(seed.hue, Math.max(Math.min(seed.chroma, 36), 16));
    primary = hex(pal.tone(dark ? 80 : 40));
    onPrimary = hex(pal.tone(dark ? 20 : 100));
  } else {
    primary = dark ? '#FFFFFF' : '#000000';
    onPrimary = dark ? '#000000' : '#FFFFFF';
  }
  const pc = TonalPalette.fromHueAndChroma(seed.hue, Math.min(seed.chroma, 48));

  const levels = dark
    ? { page: n(6), card: n(15), block: n(21), inset: n(27), chrome: n(10), float: n(21), floatBlock: n(27), elevatedPage: n(15) }
    : { page: n(94), card: n(98, 1.5), block: n(94), inset: n(90), chrome: n(90), float: n(98, 1.5), floatBlock: n(94), elevatedPage: n(94) };

  const err = TonalPalette.fromHueAndChroma(25, 84);
  const green = TonalPalette.fromHueAndChroma(145, 48);
  const orange = TonalPalette.fromHueAndChroma(60, 60);

  return {
    '--seed': seedHex,
    '--primary': primary,
    '--on-primary': onPrimary,
    '--primary-container': hex(pc.tone(dark ? 30 : 90)),
    '--on-primary-container': hex(pc.tone(dark ? 90 : 30)),
    '--page': levels.page,
    '--card': levels.card,
    '--block': levels.block,
    '--inset': levels.inset,
    '--chrome': levels.chrome,
    '--float': levels.float,
    '--float-block': levels.floatBlock,
    '--on-surface': dark ? n(97) : n(10),
    '--on-surface-variant': nv(dark ? 80 : 30),
    '--outline': nv(dark ? 60 : 50),
    '--error': hex(err.tone(dark ? 80 : 40)),
    '--on-error': hex(err.tone(dark ? 20 : 100)),
    '--error-container': hex(err.tone(dark ? 30 : 90)),
    '--on-error-container': hex(err.tone(dark ? 90 : 30)),
    '--destructive': dark ? '#FF453A' : '#FF3B30',
    '--success': hex(green.tone(dark ? 80 : 40)),
    '--success-container': hex(green.tone(dark ? 30 : 90)),
    '--on-success-container': hex(green.tone(dark ? 90 : 30)),
    '--warning': hex(orange.tone(dark ? 80 : 45)),
    '--warning-container': hex(orange.tone(dark ? 30 : 90)),
    '--on-warning-container': hex(orange.tone(dark ? 90 : 30)),
    '--inverse-surface': dark ? n(90) : n(20),
    '--on-inverse-surface': dark ? n(20) : n(95),
  };
}
