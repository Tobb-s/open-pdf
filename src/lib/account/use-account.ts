'use client';
import { useEffect, useState } from 'react';
import type { AccountState } from './contracts';

export function useAccount() {
  const [account, setAccount] = useState<AccountState>();
  const [failed, setFailed] = useState(false);
  async function refresh() {
    setFailed(false);
    try {
      const response = await fetch('/api/account', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const next = await response.json() as AccountState;
      setAccount(next);
    } catch { setFailed(true); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/account', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const next = await response.json() as AccountState;
      if (!controller.signal.aborted) setAccount(next);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  return { account, failed, refresh };
}
