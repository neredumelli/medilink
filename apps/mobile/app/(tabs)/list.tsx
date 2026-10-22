import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/api';
import { useSession } from '@/session';
import { Screen } from '@/Screen';
import { fonts, useTheme } from '@/theme';
import { Btn, CardBox, Loading, Muted, ProductTile } from '@/ui';

interface Item {
  id: string;
  name: string;
  category: string;
  qty: number;
  addedBy: string;
}

export default function ListScreen() {
  const t = useTheme();
  const router = useRouter();
  const { t: tr, toast, refreshCart, markStart, me } = useSession();
  const [items, setItems] = useState<Item[] | null>(null);
  const load = useCallback(async () => setItems(await api<Item[]>('/shop/shortage')), []);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );
  const isOwner = me?.role === 'RETAILER_OWNER';

  return (
    <Screen title={tr('shortageList')} onRefresh={load}>
      <Muted>Staff add items here during the day. {isOwner ? 'Order everything in one tap when you are ready.' : 'The owner orders them.'}</Muted>
      {!items ? (
        <Loading />
      ) : items.length === 0 ? (
        <Muted style={{ textAlign: 'center', marginTop: 20 }}>Nothing here yet.</Muted>
      ) : (
        <CardBox>
          {items.map((l) => (
            <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ProductTile name={l.name} category={l.category} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bodyBold, color: t.ink }}>
                  {l.name} × {l.qty}
                </Text>
                <Muted>Added by {l.addedBy}</Muted>
              </View>
              <Btn small kind="plain" label="Remove" onPress={async () => setItems(await api<Item[]>(`/shop/shortage/${l.id}`, { method: 'DELETE' }))} />
            </View>
          ))}
          {isOwner && (
            <Btn
              label={`Order all ${items.length} at best price`}
              onPress={async () => {
                markStart();
                const r = await api<{ added: number }>('/shop/shortage/order-all', { body: {} });
                await refreshCart();
                toast(`${r.added} items in cart`);
                router.push('/cart');
              }}
            />
          )}
        </CardBox>
      )}
    </Screen>
  );
}
