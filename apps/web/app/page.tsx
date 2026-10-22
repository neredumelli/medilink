'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useSession } from '@/lib/session';

export default function Index() {
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(me ? homeFor(me.role) : '/login');
  }, [me, loading, router]);
  return <div className="authwrap" />;
}
