/**
 * Capacitor Hybrid Configuration — Origin-Locked Static Shell Contract
 * Web compiles as Next.js SSR/ISR; Native wraps embedded static shell calling /api/v1/* via Bearer tokens.
 */
const capacitorConfig = {
  appId: 'app.examdash.ed',
  appName: 'ExamDash',
  webDir: 'dist-mobile',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
    hostname: 'localhost',
    allowNavigation: [] as string[],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#F0F0F0',
      darkBackgroundColor: '#141514',
    },
  },
};

export default capacitorConfig;
