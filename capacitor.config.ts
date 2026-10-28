import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fitora.app',
  appName: 'Fitora',
  webDir: 'www',
  server: process.env.FITORA_NATIVE_REMOTE === '1'
    ? { url: 'https://fitora.fitsystem.com.ar', cleartext: false }
    : undefined,
  ios: { contentInset: 'automatic' },
  android: { allowMixedContent: false }
};

export default config;
