import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { greetingKey } from '@medilink/core';
import { api, ApiError } from '@/api';
import { useSession } from '@/session';
import { family, fonts, useTheme } from '@/theme';
import { Icon, IconName } from '@/icons';
import { Btn, Card, CardBox, H2, inr0, Loading, Muted, ProductCard, ProductTile } from '@/ui';

interface Home {
  shop: { name: string; canOrder: boolean };
  chips: { onTheWay: number; creditFreePaise: number; shortageCount: number };
  usual: { productId: string; name: string; category: string; usualQty: number }[];
  lastDelivered: { id: string; items: unknown[] } | null;
}

export default function HomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const { t: tr, toast, refreshCart, markStart } = useSession();
  const [home, setHome] = useState<Home | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Card[] | null>(null);
  const [paste, setPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => setHome(await api<Home>('/shop/home')), []);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );
  useEffect(() => {
    if (params.q) setQ(params.q);
  }, [params.q]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) return setResults(null);
    timer.current = setTimeout(() => {
      api<Card[]>(`/catalog/search?q=${encodeURIComponent(q.trim())}`)
        .then(setResults)
        .catch((e) => toast(e instanceof ApiError ? e.message : 'Search failed'));
    }, 220);
  }, [q, toast]);

  async function quick(productId: string, qty: number, name: string) {
    markStart();
    try {
      await api(`/shop/cart/${productId}`, { method: 'PUT', body: { qty } });
      await refreshCart();
      toast(`✓ ${name} × ${qty}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not add');
    }
  }
  async function reorder() {
    if (!home?.lastDelivered) return;
    markStart();
    const r = await api<{ added: number }>(`/shop/orders/${home.lastDelivered.id}/reorder`, { body: {} });
    await refreshCart();
    toast(`${r.added} items added at best price`);
    router.push('/cart');
  }
  async function readList() {
    markStart();
    const lines = await api<{ productId: string | null; qty: number }[]>('/shop/read-list', { body: { text: pasteText } });
    const items = lines.filter((l) => l.productId).map((l) => ({ productId: l.productId!, qty: l.qty }));
    if (!items.length) return toast('We could not read any medicines from that list');
    const r = await api<{ added: number; missing: string[] }>('/shop/cart/add-many', { body: { items } });
    await refreshCart();
    setPaste(false);
    setPasteText('');
    toast(`${r.added} items added${r.missing.length ? `. Out of stock: ${r.missing.join(', ')}` : ''}`);
    router.push('/cart');
  }

  const tiles: { key: string; label: string; sub: string; icon: IconName; tone: string; onPress: () => void }[] = [
    { key: 're', label: tr('reorder'), sub: home?.lastDelivered ? '1 tap' : 'No orders yet', icon: 'redo', tone: 'green', onPress: reorder },
    { key: 'pa', label: tr('pasteList'), sub: 'We read it for you', icon: 'chat', tone: 'sun', onPress: () => setPaste(true) },
    { key: 'sl', label: tr('shortageList'), sub: `${home?.chips.shortageCount ?? 0} items`, icon: 'note', tone: 'coral', onPress: () => router.push('/list') },
    { key: 'sc', label: tr('scan'), sub: 'Point at the barcode', icon: 'scan', tone: 'sky', onPress: () => router.push('/scan') },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ backgroundColor: t.band, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
        <SafeAreaView edges={['top']} style={{ paddingHorizontal: 18, paddingBottom: 18, gap: 12 }}>
          <View>
            <Text style={{ color: t.bandInk, fontFamily: fonts.body, opacity: 0.9 }}>{tr(greetingKey(new Date().getHours()))},</Text>
            <Text style={{ color: t.bandInk, fontFamily: fonts.display, fontSize: 26 }}>{home?.shop.name ?? '…'}</Text>
          </View>
          {home && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {[
                [String(home.chips.onTheWay), tr('onTheWay')],
                [inr0(home.chips.creditFreePaise), tr('creditFree')],
                [String(home.chips.shortageCount), tr('shortageList')],
              ].map(([b, l]) => (
                <View key={l} style={{ backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', gap: 6 }}>
                  <Text style={{ color: '#FFD45C', fontFamily: fonts.bodyBold }}>{b}</Text>
                  <Text style={{ color: t.bandInk, fontFamily: fonts.body }}>{l}</Text>
                </View>
              ))}
            </ScrollView>
          )}
          <View style={{ backgroundColor: t.surface, borderRadius: 18, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 56, gap: 10 }}>
            <Icon name="search" color={t.muted} />
            <TextInput accessibilityLabel={tr('search')} placeholder={tr('search')} placeholderTextColor={t.muted} value={q} onChangeText={setQ} returnKeyType="search" style={{ flex: 1, fontFamily: fonts.body, fontSize: 17, color: t.ink }} />
          </View>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load().catch(() => {}); setRefreshing(false); }} />}>
        {home && !home.shop.canOrder && (
          <View style={{ backgroundColor: t.skySoft, borderRadius: 14, padding: 12 }}>
            <Text style={{ color: t.sky, fontFamily: fonts.bodyBold }}>Your shop documents are being checked. You can fill your cart now; ordering opens once approved.</Text>
          </View>
        )}
        {paste && (
          <CardBox style={{ borderWidth: 2, borderColor: t.sun }}>
            <H2>{tr('pasteList')}</H2>
            <Muted>One item per line, quantity at the end. Spelling mistakes are fine.</Muted>
            <TextInput accessibilityLabel="Order list" multiline value={pasteText} onChangeText={setPasteText} placeholder={'Dolo 650 - 20\nPan 40 x 10'} placeholderTextColor={t.muted} style={{ minHeight: 130, borderWidth: 2, borderColor: t.line, borderRadius: 14, padding: 12, color: t.ink, fontFamily: fonts.body, textAlignVertical: 'top' }} />
            <Btn kind="sun" label="Read my list and add" onPress={readList} disabled={!pasteText.trim()} />
            <Btn kind="plain" small label="Close" onPress={() => setPaste(false)} />
          </CardBox>
        )}

        {q.trim() ? (
          !results ? (
            <Loading />
          ) : results.length === 0 ? (
            <Muted style={{ textAlign: 'center', marginTop: 20 }}>No medicine matches “{q}”. Try the salt name, like paracetamol.</Muted>
          ) : (
            results.map((c) => <ProductCard key={c.product.id} card={c} onSearch={setQ} />)
          )
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {tiles.map((tile) => {
                const f = family(t, tile.tone);
                return (
                  <Pressable key={tile.key} onPress={tile.onPress} accessibilityRole="button" style={({ pressed }) => ({ width: '47.5%', minHeight: 118, borderRadius: 22, padding: 14, backgroundColor: f.cs, justifyContent: 'space-between', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: f.c, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={tile.icon} color={t.surface} size={24} />
                    </View>
                    <View>
                      <Text style={{ fontFamily: fonts.display, fontSize: 17, color: t.ink, lineHeight: 20 }}>{tile.label}</Text>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.muted }}>{tile.sub}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {home && home.usual.length > 0 && (
              <View style={{ gap: 10 }}>
                <H2>{tr('usualItems')}</H2>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 4 }}>
                  {home.usual.map((u) => (
                    <Pressable key={u.productId} onPress={() => quick(u.productId, u.usualQty, u.name)} style={{ width: 128, backgroundColor: t.surface, borderRadius: 18, padding: 12, gap: 8 }} accessibilityRole="button" accessibilityLabel={`Add ${u.usualQty} ${u.name}`}>
                      <ProductTile name={u.name} category={u.category} size={40} />
                      <Text style={{ fontFamily: fonts.bodyBold, color: t.ink }}>{u.name}</Text>
                      <Text style={{ fontFamily: fonts.bodyBold, color: t.brandStrong, backgroundColor: t.brandSoft, alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' }}>+ {u.usualQty}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
