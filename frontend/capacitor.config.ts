import type { CapacitorConfig } from '@capacitor/cli';

// Native shells (Android/iOS) around the same Vite build. The API origin for
// native builds comes from VITE_API_BASE at build time (see README).
const config: CapacitorConfig = {
  appId: 'app.lovevectorspace.demo',
  appName: 'LoveVectorSpace',
  webDir: 'dist',
  backgroundColor: '#101114',
  android: { allowMixedContent: false },
  ios: { contentInset: 'never', scheme: 'LoveVectorSpace' },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: false, // hidden by the app once the boot intro is mounted
      backgroundColor: '#101114',
      showSpinner: false,
    },
    StatusBar: { overlaysWebView: false, style: 'DARK', backgroundColor: '#101114' },
    CapacitorShareTarget: { appGroupId: 'group.app.lovevectorspace.demo' },
    SocialLogin: { google: true, apple: true, facebook: false, twitter: false },
  },
};

export default config;
