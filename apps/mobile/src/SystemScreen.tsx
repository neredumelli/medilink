import { useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Text, View } from 'react-native';
import { useSession } from './session';
import { API_BASE } from './api';
import { getSystem, setSystem, subscribe } from './system';
import { fonts, useTheme } from './theme';
import { Btn } from './ui';

const STORE_URL = Platform.select({ ios: 'https://apps.apple.com/', default: 'https://play.google.com/store/apps/details?id=in.medilink.shop' });

/**
 * Full-screen, friendly message when MediLink cannot be used right now:
 * no internet, our server is down, planned maintenance, or this app is too old.
 * Checks again every 30 seconds (and when the app comes back to the front) and disappears by itself.
 */
export function SystemScreen() {
  const sys = useSyncExternalStore(subscribe, getSystem, getSystem);
  const { t } = useSession();
  const th = useTheme();

  useEffect(() => {
    if (sys.kind === 'ok' || sys.kind === 'update') return;
    const check = async () => {
      try {
        const r = await fetch(`${API_BASE}/public/status`);
        if (!r.ok) return;
        const b = await r.json();
        if (b.maintenance?.on) setSystem({ kind: 'maintenance', message: b.maintenance.message, until: b.maintenance.until ?? null });
        else setSystem({ kind: 'ok' });
      } catch {
        /* still unreachable, keep showing the screen */
      }
    };
    const id = setInterval(check, 30_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [sys.kind]);

  if (sys.kind === 'ok') return null;

  const content = {
    offline: { icon: '📶', color: th.sky, title: t('offlineTitle'), body: t('offlineBody') },
    down: { icon: '🛠️', color: th.coral, title: t('downTitle'), body: t('downBody') },
    maintenance: { icon: '⏳', color: th.sun, title: t('maintenanceTitle'), body: sys.message || t('maintenanceBody') },
    update: { icon: '⬆️', color: th.violet, title: t('updateTitle'), body: t('updateBody') },
  }[sys.kind];

  const until = sys.until ? new Date(sys.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: th.band, alignItems: 'center', justifyContent: 'center', padding: 18, zIndex: 100 }} accessibilityViewIsModal>
      <View style={{ backgroundColor: th.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 420, alignItems: 'center', gap: 12 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: content.color, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 34 }}>{content.icon}</Text>
        </View>
        <Text style={{ fontFamily: fonts.display, fontSize: 24, color: th.ink, textAlign: 'center' }} accessibilityRole="header">
          {content.title}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 15.5, color: th.muted, textAlign: 'center' }}>{content.body}</Text>
        {until && (
          <Text style={{ fontFamily: fonts.bodyBold, fontSize: 15, color: th.ink, backgroundColor: th.sunSoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, overflow: 'hidden' }}>
            {t('backBy')} {until}
          </Text>
        )}
        {sys.kind === 'update' ? (
          <Btn label={t('updateTitle')} onPress={() => Linking.openURL(STORE_URL!).catch(() => {})} style={{ alignSelf: 'stretch' }} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator color={th.brand} />
            <Text style={{ fontFamily: fonts.body, color: th.muted }}>{t('checkingAgain')}</Text>
          </View>
        )}
        {sys.ref && (
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: th.muted }}>
            {t('reference')}: {sys.ref}
          </Text>
        )}
      </View>
    </View>
  );
}
