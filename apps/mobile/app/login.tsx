import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isIndianMobile, LANGS, Lang } from '@medilink/core';
import { api, ApiError, setSession } from '@/api';
import { useSession } from '@/session';
import { fonts, useTheme } from '@/theme';
import { Btn, CardBox, Muted } from '@/ui';

const LANG_LABEL: Record<Lang, string> = { en: 'English', te: 'తెలుగు', hi: 'हिंदी' };

export default function Login() {
  const t = useTheme();
  const { t: tr, lang, setLang, reload } = useSession();
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'mobile' | 'otp'>('mobile');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const input = { borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, color: t.ink, borderRadius: 14, paddingHorizontal: 14, minHeight: 56, fontSize: 20, fontFamily: fonts.bodyBold } as const;

  async function send() {
    setError(null);
    if (!isIndianMobile(mobile)) return setError('Enter a 10-digit mobile number');
    setBusy(true);
    try {
      await api('/auth/otp/request', { body: { mobile } });
      setStep('otp');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send OTP');
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setError(null);
    setBusy(true);
    try {
      const r = await api('/auth/otp/verify', { body: { mobile, code } });
      if (r.registrationToken) {
        setError('This number is new. Please register your shop on the MediLink website first; the app will open after that.');
        return;
      }
      if (!String(r.user.role).startsWith('RETAILER')) {
        setError('This app is for shops. Distributors and the MediLink team please use the website.');
        return;
      }
      await setSession(r);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not verify');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.band }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 18, gap: 18 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 34, color: t.bandInk }}>MediLink</Text>
        <CardBox style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {LANGS.map((l) => (
              <Pressable key={l} onPress={() => setLang(l)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: lang === l ? t.brandSoft : t.sunk }} accessibilityRole="button" accessibilityState={{ selected: lang === l }}>
                <Text style={{ fontFamily: fonts.bodyBold, color: lang === l ? t.brandStrong : t.muted }}>{LANG_LABEL[l]}</Text>
              </Pressable>
            ))}
          </View>
          {step === 'mobile' ? (
            <>
              <Text style={{ fontFamily: fonts.display, fontSize: 24, color: t.ink }}>{tr('enterMobile')}</Text>
              <TextInput accessibilityLabel="Mobile number" style={input} keyboardType="phone-pad" textContentType="telephoneNumber" maxLength={10} value={mobile} onChangeText={(v) => setMobile(v.replace(/\D/g, ''))} placeholder="98480 12345" placeholderTextColor={t.muted} autoFocus />
              {error && <Text style={{ color: t.bad, fontFamily: fonts.bodyBold }}>{error}</Text>}
              <Btn label={busy ? '…' : tr('sendOtp')} onPress={send} disabled={busy} />
              <Muted>No password needed. We send a one-time code by SMS.</Muted>
            </>
          ) : (
            <>
              <Text style={{ fontFamily: fonts.display, fontSize: 24, color: t.ink }}>{tr('enterOtp')}</Text>
              <Muted>Sent to +91 {mobile}</Muted>
              <TextInput accessibilityLabel="OTP" style={[input, { letterSpacing: 10, textAlign: 'center' }]} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ''))} autoFocus />
              {error && <Text style={{ color: t.bad, fontFamily: fonts.bodyBold }}>{error}</Text>}
              <Btn label={busy ? '…' : tr('verify')} onPress={verify} disabled={busy || code.length !== 6} />
              <Btn label="Change number" kind="plain" small onPress={() => setStep('mobile')} />
            </>
          )}
        </CardBox>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
