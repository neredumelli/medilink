import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { api, ApiError } from '@/api';
import { useSession } from '@/session';
import { fonts, useTheme } from '@/theme';
import { Btn, Card, Muted, ProductCard } from '@/ui';

/** Scan the barcode on a strip or box to find the medicine with live prices. */
export default function ScanScreen() {
  const t = useTheme();
  const router = useRouter();
  const { t: tr, toast } = useSession();
  const [perm, request] = useCameraPermissions();
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);

  async function onScan(code: string) {
    if (busy || card) return;
    setBusy(true);
    try {
      setCard(await api<Card>(`/catalog/barcode/${encodeURIComponent(code)}`));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not read that barcode');
    } finally {
      setTimeout(() => setBusy(false), 1200);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ padding: 16, gap: 12, flex: 1 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 26, color: t.ink }}>{tr('scan')}</Text>
        {!perm ? null : !perm.granted ? (
          <>
            <Muted>MediLink needs the camera to read barcodes on strips and boxes.</Muted>
            <Btn label="Allow camera" onPress={request} />
          </>
        ) : card ? (
          <ScrollView contentContainerStyle={{ gap: 12 }}>
            <ProductCard card={card} onSearch={(q) => router.replace({ pathname: '/', params: { q } })} />
            <Btn kind="plain" label="Scan another" onPress={() => setCard(null)} />
          </ScrollView>
        ) : (
          <View style={{ flex: 1, borderRadius: 22, overflow: 'hidden' }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'code128', 'qr', 'datamatrix'] }} onBarcodeScanned={(r) => onScan(r.data)} />
          </View>
        )}
        <Btn kind="plain" label="Close" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}
