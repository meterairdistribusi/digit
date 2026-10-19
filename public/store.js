// Interaksi etalase: filter/urut produk, stepper jumlah, kupon langsung, salin. Semua tetap berfungsi tanpa JS (form biasa).
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const rp = (n) => 'Rp' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // Salin
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.getAttribute('data-copy')); const t = b.textContent; b.textContent = 'Tersalin ✓'; setTimeout(() => (b.textContent = t), 1600); } catch (e) { /* abaikan */ }
  }));

  // Beranda: cari + urut di sisi klien
  const grid = $('[data-grid]');
  if (grid) {
    const cards = $$('[data-card]', grid), search = $('[data-search]'), sort = $('[data-sort]'), empty = $('[data-empty]');
    const order = cards.map((c, i) => [c, i]);
    const apply = () => {
      const q = (search?.value || '').trim().toLowerCase();
      let n = 0;
      order.forEach(([c]) => { const ok = !q || c.dataset.name.includes(q); c.hidden = !ok; if (ok) n++; });
      const promo = $('[data-promo]'); if (promo) promo.hidden = Boolean(q); // saat mencari, tampilkan hanya hasil pencarian
      const by = sort?.value;
      const sorted = [...order].sort((a, b) => by === 'sold' ? b[0].dataset.sold - a[0].dataset.sold : by === 'low' ? a[0].dataset.price - b[0].dataset.price : by === 'high' ? b[0].dataset.price - a[0].dataset.price : a[1] - b[1]);
      sorted.forEach(([c]) => grid.appendChild(c));
      if (empty) empty.hidden = n > 0;
    };
    search?.addEventListener('input', apply); sort?.addEventListener('change', apply); if (search?.value) apply();
  }

  // Halaman produk: jumlah, total, kupon
  const form = $('#buy');
  if (form) {
    const price = +form.dataset.price, max = +form.dataset.max || 1, pid = form.dataset.pid;
    const qty = form.elements.qty, code = form.elements.coupon;
    const msg = $('[data-coupon-msg]'), discRow = $('[data-disc-row]'), disc = $('[data-disc]');
    let discount = 0, applied = '';
    const render = () => {
      const q = Math.min(max, Math.max(1, parseInt(qty.value, 10) || 1)), sub = price * q;
      $('[data-subtotal]').textContent = rp(sub);
      discRow.hidden = !discount; disc.textContent = '−' + rp(discount);
      const t = rp(sub - discount); $('[data-total]').textContent = t; const t2 = $('[data-total2]'); if (t2) t2.textContent = t;
    };
    const check = async (silent) => {
      const c = code.value.trim(); if (!c) { discount = 0; applied = ''; msg.textContent = ''; return render(); }
      try {
        const q = Math.min(max, Math.max(1, parseInt(qty.value, 10) || 1));
        const r = await (await fetch(`/coupon/check?product_id=${pid}&qty=${q}&code=${encodeURIComponent(c)}`)).json();
        if (r.ok) { discount = r.discount; applied = c; msg.className = 'msg ok'; msg.textContent = `Kupon dipakai, hemat ${rp(r.discount)} 🎉`; }
        else { discount = 0; applied = ''; if (!silent) { msg.className = 'msg err'; msg.textContent = r.message || 'Kupon tidak valid'; } }
      } catch (e) { discount = 0; }
      render();
    };
    $$('[data-q]', form).forEach((b) => b.addEventListener('click', () => { qty.value = Math.min(max, Math.max(1, (parseInt(qty.value, 10) || 1) + +b.dataset.q)); render(); if (applied) check(true); }));
    qty.addEventListener('change', () => { qty.value = Math.min(max, Math.max(1, parseInt(qty.value, 10) || 1)); render(); if (applied) check(true); });
    $('[data-coupon]').addEventListener('click', () => check(false));
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(false); } });
    render();
  }
})();
