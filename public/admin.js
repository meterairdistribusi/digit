// Interaksi kecil panel admin: tooltip, unggah gambar (diperkecil di browser), hitung diskon, salin, filter cepat, konfirmasi.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Tooltip: elemen [data-tip] (teks biasa; baris pertama ditebalkan)
  const tip = $('#tip');
  if (tip) {
    const show = (el, x, y) => {
      const [a, ...b] = el.getAttribute('data-tip').split('\n');
      tip.innerHTML = '';
      const t = document.createElement('b'); t.textContent = a; tip.appendChild(t);
      if (b.length) tip.appendChild(document.createTextNode(b.join(' · ')));
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      tip.style.left = Math.min(innerWidth - r.width - 8, Math.max(8, x + 12)) + 'px';
      tip.style.top = Math.max(8, y - r.height - 12) + 'px';
    };
    document.addEventListener('pointermove', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else tip.hidden = true; });
    document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); } });
    document.addEventListener('focusout', () => (tip.hidden = true));
  }

  // Unggah gambar: perkecil ke maks. 800px & JPEG di browser lalu kirim sebagai data URL (server tetap memvalidasi isi berkas)
  $$('[data-image-field]').forEach((box) => {
    const file = $('input[type=file]', box), data = $('input[name=image_data]', box), url = $('input[name=image_url]', box), clear = $('input[name=image_remove]', box);
    const img = $('img', box), msg = $('.msg', box);
    const say = (t, bad) => { if (msg) { msg.textContent = t || ''; msg.className = 'msg hint ' + (bad ? 'err' : ''); } };
    file.addEventListener('change', () => {
      const f = file.files[0]; if (!f) return;
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return say('Pilih gambar JPG, PNG, atau WebP', true);
      const r = new FileReader();
      r.onload = () => {
        const im = new Image();
        im.onload = () => {
          const k = Math.min(1, 800 / Math.max(im.width, im.height));
          const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
          const out = c.toDataURL('image/jpeg', 0.86);
          data.value = out; if (clear) clear.value = ''; if (url) url.value = ''; img.src = out; img.hidden = false;
          say(`Siap diunggah (${Math.round(out.length * 0.75 / 1024)} KB). Klik Simpan.`);
        };
        im.onerror = () => say('Gambar tidak bisa dibaca', true);
        im.src = r.result;
      };
      r.readAsDataURL(f);
    });
    const rm = $('[data-image-clear]', box);
    if (rm) rm.addEventListener('click', () => { data.value = ''; if (url) url.value = ''; if (clear) clear.value = '1'; img.hidden = true; say('Gambar akan dihapus saat disimpan (sampul otomatis dipakai).'); });
    if (url) url.addEventListener('input', () => { if (/^https:\/\//.test(url.value)) { img.src = url.value; img.hidden = false; data.value = ''; if (clear) clear.value = ''; } });
  });

  // Harga coret → persen diskon langsung
  const price = $('[name=price]'), cmp = $('[name=compare_at]'), out = $('#discount-preview');
  if (price && cmp && out) {
    const upd = () => { const p = +price.value, c = +cmp.value; out.textContent = c > p && p > 0 ? `Diskon ${Math.round((1 - p / c) * 100)}% tampil di toko` : c && c <= p ? 'Harga coret harus lebih besar dari harga jual' : ''; };
    price.addEventListener('input', upd); cmp.addEventListener('input', upd); upd();
  }

  // Salin
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.getAttribute('data-copy')); const t = b.textContent; b.textContent = 'Tersalin ✓'; setTimeout(() => (b.textContent = t), 1500); } catch (e) { /* abaikan */ } }));

  // Filter cepat di sisi klien: input[data-filter] menyaring [data-row] berdasarkan teksnya
  $$('input[data-filter]').forEach((inp) => {
    const rows = $$(inp.getAttribute('data-filter'));
    const empty = $('#filter-empty');
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase(); let n = 0;
      rows.forEach((r) => { const ok = !q || r.textContent.toLowerCase().includes(q); r.hidden = !ok; if (ok) n++; });
      if (empty) empty.hidden = n > 0;
    });
  });

  // Konfirmasi untuk tindakan berisiko
  $$('form[data-confirm]').forEach((f) => f.addEventListener('submit', (e) => { if (!confirm(f.getAttribute('data-confirm'))) e.preventDefault(); }));
  // Pesan sukses hilang sendiri
  $$('.flash.ok').forEach((f) => setTimeout(() => { f.style.transition = 'opacity .4s'; f.style.opacity = 0; setTimeout(() => f.remove(), 450); }, 5000));
})();
