/**
 * Design tokens shared by web (CSS variables) and mobile (React Native styles).
 * Vibrant, warm palette inspired by medicine strips and shop signage.
 */
export const palette = {
  light: {
    bg: '#F4F7F1',
    surface: '#FFFFFF',
    sunk: '#EDF2E9',
    ink: '#10231A',
    muted: '#5B6E63',
    line: '#DFE7DA',
    band: '#0E9F5E',
    band2: '#0B8A51',
    bandInk: '#FFFFFF',
    brand: '#0E9F5E',
    brandStrong: '#08744A',
    brandInk: '#FFFFFF',
    brandSoft: '#DCF5E7',
    sun: '#FFB21E',
    sunSoft: '#FFF0CC',
    sunInk: '#6A4300',
    coral: '#F2513C',
    coralSoft: '#FFE3DD',
    sky: '#1B83F0',
    skySoft: '#DDEDFF',
    pink: '#E33A78',
    pinkSoft: '#FDE0EB',
    violet: '#7448F0',
    violetSoft: '#ECE4FF',
    teal: '#00968F',
    tealSoft: '#D3F3F0',
    bad: '#D2361F',
  },
  dark: {
    bg: '#0B1510',
    surface: '#13211A',
    sunk: '#1A2B22',
    ink: '#EAF4EE',
    muted: '#9AB0A4',
    line: '#26392F',
    band: '#115C3B',
    band2: '#0E4D31',
    bandInk: '#F2FFF7',
    brand: '#2FCF89',
    brandStrong: '#4CE09D',
    brandInk: '#062114',
    brandSoft: '#123A27',
    sun: '#FFC34D',
    sunSoft: '#3A2C0D',
    sunInk: '#FFD88A',
    coral: '#FF7B69',
    coralSoft: '#3E1D18',
    sky: '#5FB0FF',
    skySoft: '#132A42',
    pink: '#FF6FA2',
    pinkSoft: '#3D1727',
    violet: '#A78DFF',
    violetSoft: '#251D47',
    teal: '#3FD4CC',
    tealSoft: '#0F3633',
    bad: '#FF7B69',
  },
} as const;

export type ColorName = keyof typeof palette.light;

/** Product category -> colour family (so products are recognisable by colour). */
export const CATEGORY_COLOR = {
  FEVER_PAIN: 'coral',
  GASTRO: 'sun',
  ANTIBIOTIC: 'sky',
  CARDIAC: 'pink',
  DIABETES_THYROID: 'violet',
  ALLERGY_RESPIRATORY: 'teal',
  VITAMINS: 'brand',
  OTHER: 'sky',
} as const;
export type CategoryKey = keyof typeof CATEGORY_COLOR;

export const radius = { sm: 11, md: 16, lg: 22, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const font = {
  display: 'Baloo 2',
  displayTelugu: 'Baloo Tammudu 2',
  body: 'Nunito',
  mono: 'JetBrains Mono',
} as const;
/** Minimum touch target in px/dp (ease rule: thumb-friendly). */
export const MIN_TAP = 48;
