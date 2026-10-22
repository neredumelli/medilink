import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api, ApiError } from '@/api';
import { useSession } from '@/session';
import { Screen } from '@/Screen';
import { fonts, useTheme } from '@/theme';
import { Btn, CardBox, H2, inr, inr0, Loading, Muted, Pill, ProductTile } from '@/ui';

interface Cart {
  groups: {
    distributorId: string;
    distributorName: string;
    deliveryLabel: string;
    creditAvailablePaise: number;
    overCredit: boolean;
    overByPaise: number;
    totals: { total: number };
    lines: { productId: string; name: string; pack: string; category: string; qty: number; freeQty: number; ratePaise: number; valuePaise: number; stockQty: number; shortExpiry: boolean }[];
  }[];
  totals: { subtotal: number; gst: number; total: number };
  itemCount: number;
  canPlace: boolean;
}

export default function CartScreen() {
  const t = useTheme();
  const router = useRouter();
  const { t: tr, toast, refreshCart, takeElapsed } = useSession();
  const [cart, setCart] = useState<Cart | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setCart(await api<Cart>('/shop/cart')), []);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  async function remove(productId: string) {
    await api(`/shop/cart/${productId}`, { method: 'DELETE' });
    await Promise.all([load(), refreshCart()]);
  }
  async function place() {
    setBusy(true);
    try {
      const r = await api<{ orders: { distributorName: string }[]; totalPaise: number; timeToPlaceSec: number | null }>('/shop/orders', { body: { timeToPlaceSec: takeElapsed(), source: 'APP' } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await refreshCart();
      toast(`${tr('ordersSent')} ${r.orders.map((o) => o.distributorName).join(', ')} · ${inr0(r.totalPaise)}`);
      router.push('/orders');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not place the order');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!cart) return <Screen title={tr('cart')}><Loading /></Screen>;
  if (cart.itemCount === 0)
    return (
      <Screen title={tr('cart')}>
        <Muted style={{ textAlign: 'center', marginTop: 30 }}>Your cart is empty.</Muted>
        <Btn label="Find medicines" onPress={() => router.push('/')} />
      </Screen>
    );

  return (
    <Screen
      title={tr('cart')}
      onRefresh={load}
      footer={
        <View style={{ padding: 16, backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.line, gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.display, fontSize: 22, color: t.ink }}>Total</Text>
            <Text style={{ fontFamily: fonts.display, fontSize: 22, color: t.ink }}>{inr(cart.totals.total)}</Text>
          </View>
          <Btn label={`${tr('placeOrders')} · ${cart.groups.length}`} onPress={place} disabled={busy || !cart.canPlace} />
        </View>
      }
    >
      {cart.groups.map((g) => (
        <CardBox key={g.distributorId}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <H2>{g.distributorName}</H2>
            <Pill label={g.deliveryLabel} tone="green" />
          </View>
          {g.lines.map((l) => (
            <View key={l.productId} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: t.line, paddingTop: 10 }}>
              <ProductTile name={l.name} category={l.category} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bodyBold, color: t.ink }}>
                  {l.name} <Text style={{ color: t.muted, fontFamily: fonts.body }}>{l.pack}</Text>
                </Text>
                <Muted>
                  {l.qty}
                  {l.freeQty ? ` + ${l.freeQty} free` : ''} × {inr(l.ratePaise)}
                  {l.shortExpiry ? ' · short expiry' : ''}
                  {l.stockQty < l.qty ? ` · only ${l.stockQty} in stock` : ''}
                </Muted>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={{ fontFamily: fonts.bodyBold, color: t.ink }}>{inr0(l.valuePaise)}</Text>
                <Text onPress={() => remove(l.productId)} style={{ color: t.muted, textDecorationLine: 'underline', fontFamily: fonts.body, padding: 4 }} accessibilityRole="button">
                  Remove
                </Text>
              </View>
            </View>
          ))}
          <Muted>
            Credit free here: <Text style={{ color: g.overCredit ? t.bad : t.ink, fontFamily: fonts.bodyBold }}>{inr0(g.creditAvailablePaise)}</Text>
          </Muted>
          {g.overCredit && (
            <View style={{ backgroundColor: t.coralSoft, borderRadius: 14, padding: 12 }}>
              <Text style={{ color: t.coral, fontFamily: fonts.bodyBold }}>This order is {inr0(g.overByPaise)} over your credit here. Change the distributor for some items on the web, or pay your dues.</Text>
            </View>
          )}
        </CardBox>
      ))}
    </Screen>
  );
}
