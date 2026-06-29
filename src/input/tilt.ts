type TiltState = {
  enabled: boolean;
  value: number;
  hasReading: boolean; // deviceorientation イベントを一度でも受信したか（中立0事故の防止に使う）
};

export const tilt: TiltState = {
  enabled: false,
  value: 0,
  hasReading: false,
};

let listener: ((e: DeviceOrientationEvent) => void) | null = null;

function attachListener() {
  if (listener) return;
  listener = (e: DeviceOrientationEvent) => {
    if (e.gamma === null || e.gamma === undefined) return; // 値が無いイベントは無視（hasReadingも立てない）
    tilt.value = e.gamma;
    tilt.hasReading = true;
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
