import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { useSession } from '@/session';
import { fonts, useTheme } from '@/theme';
import { Icon, IconName } from '@/icons';

const ICON: Record<string, IconName> = { index: 'home', list: 'list', cart: 'cart', orders: 'box', account: 'user' };

export default function TabsLayout() {
  const t = useTheme();
  const { t: tr, cartCount, refreshCart } = useSession();
  useEffect(() => {
    refreshCart();
  }, [refreshCart]);
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: t.brandStrong,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line, height: 68, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: fonts.bodyBold, fontSize: 11.5 },
        tabBarIcon: ({ color }) => <Icon name={ICON[route.name] ?? 'home'} color={color} />,
      })}
    >
      <Tabs.Screen name="index" options={{ title: tr('home') }} />
      <Tabs.Screen name="list" options={{ title: tr('list') }} />
      <Tabs.Screen name="cart" options={{ title: tr('cart'), tabBarBadge: cartCount || undefined, tabBarBadgeStyle: { backgroundColor: t.coral } }} />
      <Tabs.Screen name="orders" options={{ title: tr('orders') }} />
      <Tabs.Screen name="account" options={{ title: tr('account') }} />
    </Tabs>
  );
}
