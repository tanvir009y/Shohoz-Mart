import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getAnalytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: 'AIzaSyAgKhx9LQgEDp_iLE21AWsHOrAkOjfKAYU',
  authDomain: 'shohoz-mart.firebaseapp.com',
  databaseURL: 'https://shohoz-mart-default-rtdb.firebaseio.com',
  projectId: 'shohoz-mart',
  storageBucket: 'shohoz-mart.firebasestorage.app',
  messagingSenderId: '833771978275',
  appId: '1:833771978275:web:a22a8db703f2c7a52e3b96',
  measurementId: 'G-NY8LPB2GVE',
};

const app = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);
export const googleProvider = new GoogleAuthProvider();

export const ADMIN_EMAIL = 'shohozmart247@gmail.com';

export async function initializeAnalytics() {
  if (typeof window === 'undefined') return null;

  try {
    if (await isSupported()) {
      return getAnalytics(app);
    }
  } catch (error) {
    console.warn('Firebase Analytics initialization failed:', error);
  }

  return null;
}

export { app };