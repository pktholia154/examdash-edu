import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';

function getAdminApp() {
  if (getApps().length > 0) {
    return getApp();
  }
  return initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

/**
 * Verifies a Firebase ID token from Authorization: Bearer <token>.
 * Uses local Google public key verification (requires zero IAM permissions on any project).
 */
export async function verifyBearerIdToken(
  authHeader: string | null
): Promise<DecodedIdToken | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  try {
    const adminAuth = getAuth(getAdminApp());
    return await adminAuth.verifyIdToken(token);
  } catch {
    return null;
  }
}
