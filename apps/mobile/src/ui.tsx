import { ReactNode, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { formatINR, freeQty, MIN_TAP } from '@medilink/core';
import { api, ApiError } from './api';
import { useSession } from './session';
import { family, fonts, Theme, useTheme } from './theme';

export const inr = (p: number) => formatINR(p);
export const inr0 = (p: number) => formatINR(p, { decimals: false });

export function Btn({ label, onPress, kind = 'primary', disabled, small, style, icon }: { label: string; onPress: () => void; kind?: 'primary' | 'sun' | 'plain' | 'danger'; disabled?: boolean; small?: boolean; style?: ViewStyle; icon?: ReactNode }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.brand : kind === 'sun' ? t.sun : t.surface;
  const fg = kind === 'primary' ? t.brandInk : kind === 'sun' ? '#3A2500' : kind === 'danger' ? t.bad : t.ink;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        { backgroundColor: bg, borderColor: kind === 'plain' || kind === 'danger' ? (kind === 'danger' ? t.bad : t.line) : bg, borderWidth: 1.5, borderRadius: small ? 11 : 16, minHeight: small ? 40 : 52, paddingHorizontal: small ? 12 : 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        style,
      ]}
    >
      {icon}
      <Text style={{ color: fg, fontFamily: fonts.bodyBold, fontSize: small ? 14 : 16 }}>{label}</Text>
    </Pressable>
  );
}

export function Pill({ label, tone }: { label: string; tone?: string }) {
  const t = useTheme();
  const f = tone ? family(t, tone) : { c: t.muted, cs: t.sunk };
  return (
    <View style={{ backgroundColor: f.cs, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: f.c, fontFamily: fonts.bodyBold, fontSize: 12.5 }}>{label}</Text>
    </View>
  );
}

export function ProductTile({ name, category, size = 48 }: { name: string; category: string; size?: number }) {
  const t = useTheme();
  const f = family(t, category);
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.31, backgroundColor: f.cs, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: f.c, fontFamily: fonts.display, fontSize: size * 0.38 }}>{name.replace(/[^A-Za-z]/g, '').slice(0, 2)}</Text>
    </View>
  );
}

export function CardBox({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.surface, borderRadius: 22, padding: 16, gap: 12, shadowColor: '#10231A', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 }, style]}>{children}</View>;
}

export function H2({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ fontFamily: fonts.display, fontSize: 20, color: t.ink }}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[{ fontFamily: fonts.body, fontSize: 13.5, color: t.muted }, style]}>{children}</Text>;
}

export function Loading() {
  const t = useTheme();
  return <ActivityIndicator color={t.brand} style={{ marginTop: 40 }} />;
}

// ------------------------------------------------------------- product card (same rules as web)
export interface Offer {
  distributorId: string;
  distributorName: string;
  deliveryLabel: string;
  stockQty: number;
  stockLevel: 'out' | 'low' | 'in';
  ptrPaise: number;
  discountPct: number;
  scheme: { buy: number; free: number } | null;
  netRatePaise: number;
  shortExpiry: boolean;
}
export interface Card {
  product: { id: string; name: string; form: string; pack: string; salt: string; company: string; schedule: string; category: string; mrpPaise: number; status?: string; statusNote?: string | null };
  blocked?: string | null;
  usualQty: number;
  offers: Offer[];
  best: { distributorId: string; overCredit: boolean } | null;
  substitutes: { id: string; name: string; company: string; fromNetRatePaise: number }[];
}

export function ProductCard({ card, onSearch }: { card: Card; onSearch: (q: string) => void }) {
  const t = useTheme();
  const { t: tr, toast, refreshCart, markStart } = useSession();
  const [qty, setQty] = useState(card.usualQty);
  const [pick, setPick] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const p = card.product;
  const s = styles(t);

  const head = (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <ProductTile name={p.name} category={p.category} />
      <View style={{ flex: 1 }}>
        <Text style={s.name}>
          {p.name} <Text style={s.pack}>{p.form} {p.pack}</Text>
        </Text>
        <Muted>
          {p.salt} · {p.company}
          {p.schedule !== 'NONE' ? `  ·  Sch ${p.schedule}` : ''}
        </Muted>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Muted>MRP</Muted>
        <Text style={s.mrp}>{inr(p.mrpPaise)}</Text>
      </View>
    </View>
  );

  if (card.blocked) {
    const label = p.status === 'BANNED' ? tr('statusBanned') : p.status === 'RECALLED' ? tr('statusRecalled') : tr('statusDiscontinued');
    return (
      <CardBox>
        {head}
        <View style={[s.note, { backgroundColor: t.coralSoft }]} accessibilityLabel={`${p.name}: ${tr('cannotOrder')}`}>
          <Pill label={label} tone="coral" />
          <Text style={{ color: t.coral, fontFamily: fonts.bodyBold }}>{tr('cannotOrder')}</Text>
          {p.statusNote ? <Text style={{ color: t.ink, fontFamily: fonts.body }}>{p.statusNote}</Text> : null}
          {card.substitutes.length > 0 && <Muted>{tr('sameMedicine')}:</Muted>}
          {card.substitutes.map((x) => (
            <Btn key={x.id} small kind="plain" label={`${x.name} · ${x.company} · ${inr(x.fromNetRatePaise)}`} onPress={() => onSearch(x.name)} />
          ))}
        </View>
      </CardBox>
    );
  }

  if (!card.best) {
    return (
      <CardBox>
        {head}
        <View style={[s.note, { backgroundColor: t.coralSoft }]}>
          <Text style={{ color: t.coral, fontFamily: fonts.bodyBold }}>{tr('outOfStock')} at all your distributors.</Text>
          {card.substitutes.map((x) => (
            <Btn key={x.id} small kind="plain" label={`${x.name} · ${x.company} · ${inr(x.fromNetRatePaise)}`} onPress={() => onSearch(x.name)} />
          ))}
        </View>
      </CardBox>
    );
  }

  const chosen = pick ?? card.best.distributorId;
  const o = card.offers.find((x) => x.distributorId === chosen)!;
  const isBest = chosen === card.best.distributorId;
  const fq = freeQty(o.scheme, qty);

  async function add() {
    markStart();
    try {
      await api(`/shop/cart/${p.id}`, { method: 'PUT', body: { qty, distributorId: pick ?? undefined } });
      await refreshCart();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(`✓ ${p.name} × ${qty} from ${o.distributorName}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not add');
    }
  }

  return (
    <CardBox>
      {head}
      <View style={[s.best, { backgroundColor: isBest ? t.brandSoft : t.skySoft }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <View style={[s.tag, { backgroundColor: isBest ? t.sun : t.sky }]}>
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 11, color: isBest ? '#3A2500' : '#fff' }}>{(isBest ? tr('bestPrice') : tr('yourChoice')).toUpperCase()}</Text>
            </View>
            <Text style={[s.price, { color: isBest ? t.brandStrong : t.sky }]}>
              {inr(o.netRatePaise)} <Text style={s.per}>{tr('perStrip')}</Text>
            </Text>
          </View>
          <Pill label={o.stockQty === 0 ? tr('outOfStock') : o.stockLevel === 'low' ? `${tr('lowStock')} · ${o.stockQty}` : tr('inStock')} tone={o.stockLevel === 'in' ? 'green' : o.stockLevel === 'low' ? 'sun' : 'coral'} />
        </View>
        <Text style={{ fontFamily: fonts.body, color: t.ink }}>
          {tr('from')} <Text style={{ fontFamily: fonts.bodyBold }}>{o.distributorName}</Text> · {o.deliveryLabel}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {o.scheme && <Pill label={`Scheme ${o.scheme.buy}+${o.scheme.free}`} tone="violet" />}
          {o.discountPct > 0 && <Pill label={`${o.discountPct}% off`} tone="violet" />}
          <Pill label={`PTR ${inr(o.ptrPaise)}`} />
          {o.shortExpiry && <Pill label="Short expiry" tone="sun" />}
        </View>
      </View>

      {card.offers.filter((x) => x.stockQty > 0).length > 1 && (
        <Pressable onPress={() => setOpen(!open)} style={{ minHeight: 36, justifyContent: 'center' }} accessibilityRole="button">
          <Text style={{ color: t.sky, fontFamily: fonts.bodyBold }}>
            {open ? '▴' : '▾'} {tr('compare')} ({card.offers.length})
          </Text>
        </Pressable>
      )}
      {open &&
        card.offers.map((x) => (
          <Pressable key={x.distributorId} disabled={x.stockQty === 0} onPress={() => setPick(x.distributorId)} style={[s.drow, { borderColor: x.distributorId === chosen ? t.brand : t.line, backgroundColor: x.distributorId === chosen ? t.brandSoft : t.surface, opacity: x.stockQty === 0 ? 0.5 : 1 }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodyBold, color: t.ink }}>{x.distributorName}</Text>
              <Muted>{x.stockQty === 0 ? tr('outOfStock') : x.deliveryLabel}</Muted>
            </View>
            <Text style={{ fontFamily: fonts.bodyBold, color: t.ink, fontSize: 16 }}>{inr(x.netRatePaise)}</Text>
          </Pressable>
        ))}

      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <View style={[s.stepper, { backgroundColor: t.sunk }]}>
          <Pressable accessibilityLabel="Less" onPress={() => setQty(Math.max(1, qty - 1))} style={[s.stepBtn, { backgroundColor: t.surface }]}>
            <Text style={[s.stepTxt, { color: t.brandStrong }]}>−</Text>
          </Pressable>
          <TextInput accessibilityLabel="Quantity" keyboardType="number-pad" value={String(qty)} onChangeText={(v) => setQty(Math.max(1, Math.min(9999, Number(v.replace(/\D/g, '')) || 1)))} style={[s.qty, { color: t.ink }]} />
          <Pressable accessibilityLabel="More" onPress={() => setQty(Math.min(9999, qty + 1))} style={[s.stepBtn, { backgroundColor: t.surface }]}>
            <Text style={[s.stepTxt, { color: t.brandStrong }]}>+</Text>
          </Pressable>
        </View>
        <Btn label={`${tr('addToCart')}${fq ? ` · +${fq} free` : ''}`} onPress={add} style={{ flex: 1 }} />
      </View>
    </CardBox>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    name: { fontFamily: fonts.display, fontSize: 21, color: t.ink, lineHeight: 24 },
    pack: { fontFamily: fonts.body, fontSize: 13, color: t.muted },
    mrp: { fontFamily: fonts.bodyBold, fontSize: 16, color: t.ink },
    best: { borderRadius: 18, padding: 12, gap: 6 },
    tag: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
    price: { fontFamily: fonts.display, fontSize: 28, marginTop: 4 },
    per: { fontFamily: fonts.body, fontSize: 12, color: t.muted },
    note: { borderRadius: 14, padding: 12, gap: 8 },
    drow: { borderWidth: 2, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MIN_TAP },
    stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 4 },
    stepBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    stepTxt: { fontSize: 22, fontFamily: fonts.bodyBold },
    qty: { width: 46, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 17 },
  });
