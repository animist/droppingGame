type TiltState = {
  enabled: boolean;
  value: number;
};

export const tilt: TiltState = {
  enabled: false,
  value: 0,
};

let listener: ((e: DeviceOrientationEvent) => void) | null = null;

function attachListener() {
  if (listener) return;
  listener = (e: DeviceOrientationEvent) => {
    tilt.value = e.gamma ?? 0;
  };
  window.addEventListener('deviceorientation', listener);
  tilt.enabled = true;
}

export function enableTilt(): Promise<boolean> {
  return new Promise((resolve) => {
    const DOEvent = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    if (DOEvent && typeof DOEvent.requestPermission === 'function') {
      DOEvent.requestPermission()
        .then((result) => {
          if (result === 'granted') {
            attachListener();
            resolve(true);
          } else {
            resolve(false);
          }
        })
        .catch(() => resolve(false));
    } else if (typeof window.DeviceOrientationEvent !== 'undefined') {
      attachListener();
      resolve(true);
    } else {
      resolve(false);
    }
  });
}
