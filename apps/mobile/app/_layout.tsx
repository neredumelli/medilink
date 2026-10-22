import { useEffect } from 'react';
import { ErrorBoundaryProps, Stack, useRouter, useSegments } from 'expo-router';
import { Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Baloo2_600SemiBold, Baloo2_800ExtraBold } from '@expo-google-fonts/baloo-2';
import { Nunito_400Regular, Nunito_600SemiBold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { SessionProvider, useSession } from '@/session';
import { SystemScreen } from '@/SystemScreen';
import { Btn } from '@/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate() {
  const { me, ready } = useSession();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {});
    const inAuth = segments[0] === 'login';
    if (!me && !inAuth) router.replace('/login');
    else if (me && inAuth) router.replace('/');
  }, [me, ready, segments, router]);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({ Baloo2_600SemiBold, Baloo2_800ExtraBold, Nunito_400Regular, Nunito_600SemiBold, Nunito_800ExtraBold });
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Gate />
        <SystemScreen />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/** If a screen crashes, show a calm message with a reference instead of a blank or red screen. Cart stays on the server. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const ref = `ML-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  console.error(ref, error);
  return (
    <View style={{ flex: 1, backgroundColor: '#0E9F5E', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, width: '100%', maxWidth: 420, gap: 10, alignItems: 'center' }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: '#10231A', textAlign: 'center' }}>Something went wrong</Text>
        <Text style={{ fontSize: 15, color: '#10231A', textAlign: 'center' }}>ఏదో సమస్య వచ్చింది · कुछ गड़बड़ हो गई</Text>
        <Text style={{ fontSize: 15, color: '#5B6E63', textAlign: 'center' }}>Please try again. Your cart is saved.</Text>
        <Text style={{ fontSize: 13, color: '#5B6E63' }}>Reference: {ref}</Text>
        <Btn label="Try again · మళ్ళీ · फिर कोशिश" onPress={retry} style={{ alignSelf: 'stretch' }} />
      </View>
    </View>
  );
}
