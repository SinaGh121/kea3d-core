import { useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { isNativeShell } from '@/nativeShell';

export function PwaStatus() {
  if (isNativeShell()) return null;
  return <WebPwaStatus />;
}

function WebPwaStatus() {
  const [dismissedOffline, setDismissedOffline] = useState(false);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisterError(error) {
      console.error('Service worker registration failed', error);
    },
  });

  if ((!offlineReady || dismissedOffline) && !needRefresh) return null;

  const dismiss = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
    setDismissedOffline(true);
  };

  return (
    <Card role="status" className="fixed right-4 bottom-4 z-[70] w-[min(360px,calc(100%_-_32px))] flex-row items-center gap-3 p-3 shadow-2xl">
      {needRefresh ? <Download className="size-4 shrink-0 text-primary" /> : <WifiOff className="size-4 shrink-0 text-primary" />}
      <div className="min-w-0 flex-1">
        <strong className="block text-xs">{needRefresh ? 'Update available' : 'Ready offline'}</strong>
        <span className="block text-[11px] text-muted-foreground">
          {needRefresh ? 'Apply it when you are ready.' : 'The viewer can now start without a connection.'}
        </span>
      </div>
      {needRefresh && <Button size="sm" onClick={() => void updateServiceWorker(true)}>Update</Button>}
      <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={dismiss}><X /></Button>
    </Card>
  );
}
