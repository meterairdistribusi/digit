const { AsyncLocalStorage } = require('node:async_hooks');
// Konteks per permintaan (admin yang sedang masuk + path) agar tampilan bisa menandai menu aktif & menyembunyikan menu Pemilik
// tanpa harus menyerahkan argumen ke setiap fungsi tampilan.
module.exports = { als: new AsyncLocalStorage(), get: () => module.exports.als.getStore() || {} };
