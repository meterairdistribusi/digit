// Klien API Toko Digital (/api/v1). Murni TypeScript tanpa dependensi React Native,
// sehingga bisa diuji langsung terhadap backend asli (lihat test/mobile-api.test.js di root repo).

export type Product = {
  id: number;
  name: string;
  category: string;
  description: string;
  price: number;
  orderable: boolean;
  in_stock: boolean;
  max_qty: number;
};

export type OrderStatus = 'pending' | 'paid' | 'paid_nostock' | 'paid_sourcing' | 'failed' | 'refunded';

export type Order = {
  id: string;
  product: string;
  qty: number;
  amount: number;
  discount: number;
  coupon: string | null;
  status: OrderStatus;
  created_at: string;
  order_url: string;
  items?: string[];
  pay_url?: string | null;
};

export type User = { id: number; email: string; name: string; phone: string };
export type Session = { token: string; user: User };
export type LegalMeta = { name: string; title: string; updated: string };
export type LegalDoc = LegalMeta & { markdown: string };
export type AppConfig = { store_name: string; whatsapp: string; payments_enabled: boolean };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type ClientOptions = {
  baseUrl: string;
  getToken: () => string | null | Promise<string | null>;
  /** dipanggil saat server menjawab 401 untuk permintaan yang membawa token (sesi habis/dicabut) */
  onUnauthorized?: () => void;
  timeoutMs?: number;
};

export function createClient(opts: ClientOptions) {
  const base = opts.baseUrl.replace(/\/+$/, '') + '/api/v1';

  async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const token = auth ? await opts.getToken() : null;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;

    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
      });
    } catch {
      throw new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
    }
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* respons non-JSON */
    }
    if (!res.ok) {
      if (res.status === 401 && token) opts.onUnauthorized?.();
      throw new ApiError(res.status, data?.error || `Terjadi kesalahan (${res.status})`);
    }
    return data as T;
  }

  return {
    config: () => request<AppConfig>('GET', '/config', undefined, false),
    legalList: () => request<LegalMeta[]>('GET', '/legal', undefined, false),
    legal: (name: string) => request<LegalDoc>('GET', '/legal/' + encodeURIComponent(name), undefined, false),

    register: (v: { email: string; name: string; phone?: string; password: string; device?: string }) =>
      request<Session>('POST', '/auth/register', { ...v, accept_terms: true }, false),
    login: (email: string, password: string, device?: string) =>
      request<Session>('POST', '/auth/login', { email, password, device }, false),
    logout: () => request<{ ok: true }>('POST', '/auth/logout'),
    me: () => request<{ user: User }>('GET', '/me'),
    changePassword: (oldPassword: string, newPassword: string) =>
      request<{ token: string }>('POST', '/me/password', { old_password: oldPassword, new_password: newPassword }),
    exportData: () => request<unknown>('GET', '/me/export'),
    deleteAccount: (password: string) => request<{ ok: true }>('DELETE', '/me', { password }),

    categories: () => request<string[]>('GET', '/categories', undefined, false),
    products: (category?: string) =>
      request<Product[]>('GET', '/products' + (category ? '?category=' + encodeURIComponent(category) : ''), undefined, false),
    product: (id: number) => request<Product>('GET', '/products/' + id, undefined, false),
    checkCoupon: (productId: number, qty: number, code: string) =>
      request<{ discount: number; total: number }>('POST', '/coupons/check', { product_id: productId, qty, code }, false),

    createOrder: (v: { productId: number; qty: number; coupon?: string; contact?: string }) =>
      request<{ order: Order; pay_url: string | null; demo: boolean }>('POST', '/orders', {
        product_id: v.productId,
        qty: v.qty,
        coupon: v.coupon || undefined,
        contact: v.contact || undefined,
      }),
    orders: () => request<Order[]>('GET', '/orders'),
    order: (id: string) => request<Order>('GET', '/orders/' + encodeURIComponent(id)),
    newPayment: (id: string) => request<{ pay_url: string }>('POST', `/orders/${encodeURIComponent(id)}/pay`),
  };
}

export type Api = ReturnType<typeof createClient>;

// ---------- Util tampilan (tanpa Intl: Hermes di sebagian perangkat tidak punya locale id-ID) ----------
export const rupiah = (n: number) => 'Rp' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Menunggu pembayaran',
  paid: 'Lunas',
  paid_nostock: 'Lunas · menunggu stok',
  paid_sourcing: 'Lunas · produk disiapkan',
  failed: 'Gagal / kedaluwarsa',
  refunded: 'Dana dikembalikan',
};
export const STATUS_TONE: Record<OrderStatus, 'ok' | 'warn' | 'bad'> = {
  pending: 'warn', paid: 'ok', paid_nostock: 'warn', paid_sourcing: 'warn', failed: 'bad', refunded: 'warn',
};
/** status yang perlu dipantau berkala sampai berubah */
export const isOpen = (s: OrderStatus) => s === 'pending' || s === 'paid_sourcing' || s === 'paid_nostock';
