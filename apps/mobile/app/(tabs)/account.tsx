import { Pressable, Text, View } from 'react-native';
import { LANGS, Lang } from '@medilink/core';
import { useSession } from '@/session';
import { Screen } from '@/Screen';
import { fonts, useTheme } from '@/theme';
import { Btn, CardBox, H2, Muted, Pill } from '@/ui';

const LANG_LABEL: Record<Lang, string> = { en: 'English', te: 'తెలుగు', hi: 'हिंदी' };

export default function AccountScreen() {
  const t = useTheme();
  const { me, logout, lang, setLang, t: tr } = useSession();
  return (
    <Screen title={tr('account')}>
      <CardBox>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <H2>{me?.retailer?.name}</H2>
          <Pill label={me?.retailer?.kycStatus === 'APPROVED' ? 'Verified' : 'Being checked'} tone={me?.retailer?.kycStatus === 'APPROVED' ? 'green' : 'sun'} />
        </View>
        <Muted>
          {me?.name} · ID {me?.userCode} · +91 {me?.mobile}
        </Muted>
        <Muted>GSTIN {me?.retailer?.gstin ?? 'not added'}</Muted>
      </CardBox>
      <CardBox>
        <H2>Language</H2>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {LANGS.map((l) => (
            <Pressable key={l} onPress={() => setLang(l)} accessibilityRole="button" accessibilityState={{ selected: lang === l }} style={{ flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: lang === l ? t.brand : t.sunk }}>
              <Text style={{ fontFamily: fonts.bodyBold, color: lang === l ? t.brandInk : t.ink }}>{LANG_LABEL[l]}</Text>
            </Pressable>
          ))}
        </View>
      </CardBox>
      <Btn kind="plain" label="Log out" onPress={logout} />
    </Screen>
  );
}
