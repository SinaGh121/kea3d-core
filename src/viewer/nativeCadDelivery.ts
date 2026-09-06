const DEFAULT_TERMINAL_DELIVERY_TIMEOUT_MS = 5_000;

export interface NativeCadDeliveryBarrier {
  markDelivered: () => void;
  wait: () => Promise<void>;
}

export function createNativeCadDeliveryBarrier(
  timeoutMs = DEFAULT_TERMINAL_DELIVERY_TIMEOUT_MS,
): NativeCadDeliveryBarrier {
  let delivered = false;
  let resolveDelivery: () => void = () => undefined;
  const delivery = new Promise<void>((resolve) => { resolveDelivery = resolve; });

  return {
    markDelivered: () => {
      if (delivered) return;
      delivered = true;
      resolveDelivery();
    },
    wait: async () => {
      if (delivered) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          delivery,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              reject(new Error('The native CAD worker response was not delivered to the viewer.'));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  };
}
