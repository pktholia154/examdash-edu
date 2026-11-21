/**
 * Lazy Platform-Aware Authentication Adapter
 * - Zero top-level `firebase/auth` imports (prevents gapi.js & __/auth/iframe on anonymous loads)
 * - Web: `signInWithPopup`
 * - Capacitor Native: Native OS Credential Manager (Google) + Sign in with Apple (`signInWithCredential`)
 */
import { isCapacitorNative } from '../platform/capacitor-bridge';

export interface AppAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

interface NativeAuthPlugins {
  FirebaseAuthentication?: {
    signInWithGoogle?: () => Promise<{ credential?: { idToken?: string; accessToken?: string } }>;
    signInWithApple?: () => Promise<{ credential?: { idToken?: string; rawNonce?: string } }>;
    signOut?: () => Promise<void>;
  };
  GoogleAuth?: {
    signIn?: () => Promise<{ authentication?: { idToken?: string; accessToken?: string }; idToken?: string }>;
    signOut?: () => Promise<void>;
  };
  SignInWithApple?: {
    authorize?: (opts?: Record<string, unknown>) => Promise<{
      response?: { identityToken?: string; nonce?: string };
    }>;
  };
}

function getNativeAuthPlugins(): NativeAuthPlugins {
  if (typeof window === 'undefined') return {};
  const win = window as unknown as {
    Capacitor?: { Plugins?: NativeAuthPlugins };
  };
  return win.Capacitor?.Plugins ?? {};
}

export async function subscribeLazyAuthState(
  onUserChange: (user: AppAuthUser | null) => void
): Promise<() => void> {
  const [{ onAuthStateChanged }, { getFirebaseAuth }] = await Promise.all([
    import('firebase/auth'),
    import('../firebase/client'),
  ]);
  const auth = getFirebaseAuth();
  return onAuthStateChanged(auth, (firebaseUser) => {
    onUserChange(firebaseUser);
  });
}

export async function getActiveAuthUser(): Promise<AppAuthUser | null> {
  const { getFirebaseAuth } = await import('../firebase/client');
  return getFirebaseAuth().currentUser;
}

export async function signInWithGoogleAdapter(): Promise<AppAuthUser | null> {
  const [authMod, { getFirebaseAuth, getGoogleProvider }] = await Promise.all([
    import('firebase/auth'),
    import('../firebase/client'),
  ]);
  const auth = getFirebaseAuth();

  if (isCapacitorNative()) {
    const plugins = getNativeAuthPlugins();

    // 1. Native OS Credential Manager via Capacitor FirebaseAuthentication plugin
    if (plugins.FirebaseAuthentication?.signInWithGoogle) {
      const result = await plugins.FirebaseAuthentication.signInWithGoogle();
      const idToken = result?.credential?.idToken;
      const accessToken = result?.credential?.accessToken;
      if (!idToken && !accessToken) {
        throw new Error('Native Google Credential Manager returned no token.');
      }
      const credential = authMod.GoogleAuthProvider.credential(
        idToken ?? null,
        accessToken
      );
      const userCred = await authMod.signInWithCredential(auth, credential);
      return userCred.user;
    }

    // 2. Fallback Native GoogleAuth plugin
    if (plugins.GoogleAuth?.signIn) {
      const res = await plugins.GoogleAuth.signIn();
      const idToken = res?.authentication?.idToken || res?.idToken;
      const accessToken = res?.authentication?.accessToken;
      if (!idToken && !accessToken) {
        throw new Error('Native Google Sign-In returned no ID token.');
      }
      const credential = authMod.GoogleAuthProvider.credential(
        idToken ?? null,
        accessToken
      );
      const userCred = await authMod.signInWithCredential(auth, credential);
      return userCred.user;
    }

    throw new Error('Native OS Credential Manager is not available in this build.');
  }

  // Web: Popup OAuth flow (allowed in iframe preview & production HTTPS)
  const cred = await authMod.signInWithPopup(auth, getGoogleProvider());
  return cred.user;
}

export async function signInWithAppleAdapter(): Promise<AppAuthUser | null> {
  const [authMod, { getFirebaseAuth }] = await Promise.all([
    import('firebase/auth'),
    import('../firebase/client'),
  ]);
  const auth = getFirebaseAuth();

  if (isCapacitorNative()) {
    const plugins = getNativeAuthPlugins();

    if (plugins.FirebaseAuthentication?.signInWithApple) {
      const res = await plugins.FirebaseAuthentication.signInWithApple();
      const idToken = res?.credential?.idToken;
      if (!idToken) {
        throw new Error('Sign in with Apple returned no identity token.');
      }
      const provider = new authMod.OAuthProvider('apple.com');
      const credential = provider.credential({
        idToken,
        rawNonce: res?.credential?.rawNonce,
      });
      const userCred = await authMod.signInWithCredential(auth, credential);
      return userCred.user;
    }

    if (plugins.SignInWithApple?.authorize) {
      const res = await plugins.SignInWithApple.authorize({
        scopes: 'email name',
      });
      const idToken = res?.response?.identityToken;
      if (!idToken) {
        throw new Error('Sign in with Apple returned no identity token.');
      }
      const provider = new authMod.OAuthProvider('apple.com');
      const credential = provider.credential({
        idToken,
        rawNonce: res?.response?.nonce,
      });
      const userCred = await authMod.signInWithCredential(auth, credential);
      return userCred.user;
    }

    throw new Error('Native Sign in with Apple is not available on this device.');
  }

  const appleProvider = new authMod.OAuthProvider('apple.com');
  appleProvider.addScope('email');
  appleProvider.addScope('name');
  const cred = await authMod.signInWithPopup(auth, appleProvider);
  return cred.user;
}

export async function signOutPlatformAdapter(): Promise<void> {
  const [{ signOut }, { getFirebaseAuth }] = await Promise.all([
    import('firebase/auth'),
    import('../firebase/client'),
  ]);

  if (isCapacitorNative()) {
    const plugins = getNativeAuthPlugins();
    await plugins.FirebaseAuthentication?.signOut?.().catch(() => {});
    await plugins.GoogleAuth?.signOut?.().catch(() => {});
  }

  await signOut(getFirebaseAuth());
}

export async function deleteCurrentAuthUserAdapter(): Promise<void> {
  const [{ deleteUser }, { getFirebaseAuth }] = await Promise.all([
    import('firebase/auth'),
    import('../firebase/client'),
  ]);
  const active = getFirebaseAuth().currentUser;
  if (!active) {
    throw new Error('No signed-in user session.');
  }
  await deleteUser(active);
}
