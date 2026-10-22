import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { STATUS_LABEL_EN, TRACKER_STEPS } from '@medilink/core';
import { api, ApiError } from '@/api';
import { useSession } from '@/session';
import { Screen } from '@/Screen';
import { fonts, useTheme } from '@/theme';
import { Btn, CardBox, inr0, Loading, Muted, Pill } from '@/ui';

interface Order {
  id: string;
  number: string;
  status: keyof typeof STATUS_LABEL_EN;
  distributor: { name: string; deliveryLabel: string };
  totalPaise: number;
  partial: boolean;
  rejectReason: string | null;
  invoiceNo: string | null;
  items: { name: string; qty: number; billedQty: number | null }[];
}
const TONE: Record<string, string> = { PLACED: 'coral', ACCEPTED: 'sky', BILLED: 'violet', DISPATCHED: 'sun', DELIVERED: 'green', REJECTED: 'coral' };

function Tracker({ status }: { status: string }) {
  const t = useTheme();
  const k = TRACKER_STEPS.indexOf(status as never);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`Status ${status}`}>
      {TRACKER_STEPS.map((s, i) => (
        <View key={s} style={{ flexDirection: 'row', alignItems: 'center', flex: i ? 1 : 0 }}>
          {i > 0 && <View style={{ flex: 1, height: 4, backgroundColor: i <= k ? t.brand : t.sunk }} />}
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: i <= k ? t.brand : t.sunk, borderWidth: i === k ? 4 : 0, borderColor: t.brandSoft }} />
        </View>
      ))}
    </View>
  );
}

export default function OrdersScreen() {
  const t = useTheme();
  const router = useRouter();
  const { t: tr, toast, refreshCart } = useSession();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const load = useCallback(async () => setOrders(await api<Order[]>('/shop/orders')), []);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  async function act(path: string, toCart: boolean, msg: string) {
    try {
      const r = await api<any>(path, { body: {} });
      if (toCart) {
        await refreshCart();
        toast(r.added ? msg : 'No other distributor has stock right now');
        if (r.added) router.push('/cart');
      } else {
        toast(msg);
        await load();
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  }

  return (
    <Screen title={tr('orders')} onRefresh={load}>
      {!orders ? (
        <Loading />
      ) : (
        orders.map((o) => {
          const short = o.items.filter((i) => i.billedQty !== null && i.billedQty < i.qty);
          return (
            <CardBox key={o.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.bodyBold, fontSize: 17, color: t.ink }}>{o.distributor.name}</Text>
                  <Muted>
                    {o.number} · {o.items.length} items · {inr0(o.totalPaise)}
                  </Muted>
                </View>
                <Pill label={STATUS_LABEL_EN[o.status]} tone={TONE[o.status]} />
              </View>
              {o.status === 'REJECTED' || o.status === 'CANCELLED' ? <Muted>{o.rejectReason ?? 'Cancelled'}. Your credit has been released.</Muted> : <Tracker status={o.status} />}
              {short.length > 0 && (
                <View style={{ backgroundColor: t.sunSoft, borderRadius: 14, padding: 12, gap: 8 }}>
                  <Text style={{ color: t.sunInk, fontFamily: fonts.bodyBold }}>
                    {tr('cameShort')}: {short.map((i) => `${i.name} ${i.billedQty} of ${i.qty}`).join(', ')}
                  </Text>
                  <Btn kind="sun" small label={tr('getRest')} onPress={() => act(`/shop/orders/${o.id}/get-rest`, true, 'Added from another distributor')} />
                </View>
              )}
              {o.status === 'DISPATCHED' && <Btn small label="Goods received" onPress={() => act(`/shop/orders/${o.id}/received`, false, 'Marked as received')} />}
              {o.status === 'DELIVERED' && <Btn small kind="plain" label="Order again" onPress={() => act(`/shop/orders/${o.id}/reorder`, true, 'Items added at best price')} />}
              {o.status === 'PLACED' && <Btn small kind="plain" label="Cancel order" onPress={() => act(`/shop/orders/${o.id}/cancel`, false, 'Order cancelled')} />}
            </CardBox>
          );
        })
      )}
    </Screen>
  );
}
