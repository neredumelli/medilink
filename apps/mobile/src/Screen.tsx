import { ReactNode } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fonts, useTheme } from './theme';

/** Coloured header band + scrolling content, used by every tab except Home. */
export function Screen({ title, children, onRefresh, refreshing = false, footer }: { title: string; children: ReactNode; onRefresh?: () => void; refreshing?: boolean; footer?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ backgroundColor: t.band, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
        <SafeAreaView edges={['top']} style={{ paddingHorizontal: 18, paddingBottom: 16 }}>
          <Text style={{ color: t.bandInk, fontFamily: fonts.display, fontSize: 28 }}>{title}</Text>
        </SafeAreaView>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}>
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}
