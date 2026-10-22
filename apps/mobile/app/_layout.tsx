import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Baloo2_600SemiBold, Baloo2_800ExtraBold } from '@expo-google-fonts/baloo-2';
import { Nunito_400Regular, Nunito_600SemiBold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { SessionProvider, useSession } from '@/session';

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
      </SessionProvider>
    </SafeAreaProvider>
  );
}
