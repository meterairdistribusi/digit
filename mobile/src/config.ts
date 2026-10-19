// URL backend. Diisi saat build lewat EXPO_PUBLIC_API_URL (lihat eas.json). Produksi WAJIB https.
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
export const APP_VERSION = '1.0.0';
