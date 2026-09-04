import { describe, expect, it } from 'vitest';
import { createNativeCadDeliveryBarrier } from './nativeCadDelivery';

describe('native CAD delivery barrier', () => {
  it('waits when command completion arrives before the terminal channel event', async () => {
    const barrier = createNativeCadDeliveryBarrier();
    let completed = false;
    const waiting = barrier.wait().then(() => { completed = true; });

    await Promise.resolve();
    expect(completed).toBe(false);
    barrier.markDelivered();
    await waiting;
    expect(completed).toBe(true);
  });

  it('does not wait when the terminal channel event arrived first', async () => {
    const barrier = createNativeCadDeliveryBarrier();
    barrier.markDelivered();
    await expect(barrier.wait()).resolves.toBeUndefined();
  });
});
