import { useColorScheme } from 'react-native';
import { CATEGORY_COLOR, CategoryKey, palette } from '@medilink/core';

export type Theme = (typeof palette)['light'] | (typeof palette)['dark'];

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? palette.dark : palette.light;
}

export const fonts = {
  display: 'Baloo2_800ExtraBold',
  displayMedium: 'Baloo2_600SemiBold',
  body: 'Nunito_600SemiBold',
  bodyBold: 'Nunito_800ExtraBold',
  bodyRegular: 'Nunito_400Regular',
};

/** Colour pair (strong, soft) for a product category or a named family. */
export function family(t: Theme, name: string): { c: string; cs: string } {
  const key = (CATEGORY_COLOR as Record<string, string>)[name as CategoryKey] ?? name;
  switch (key) {
    case 'coral':
      return { c: t.coral, cs: t.coralSoft };
    case 'sun':
      return { c: t.sunInk, cs: t.sunSoft };
    case 'sky':
      return { c: t.sky, cs: t.skySoft };
    case 'pink':
      return { c: t.pink, cs: t.pinkSoft };
    case 'violet':
      return { c: t.violet, cs: t.violetSoft };
    case 'teal':
      return { c: t.teal, cs: t.tealSoft };
    default:
      return { c: t.brandStrong, cs: t.brandSoft };
  }
}
