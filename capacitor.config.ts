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
      backgroundColor: '#F8FAFC',
      darkBackgroundColor: '#090D16',
    },
  },
};

export default capacitorConfig;
