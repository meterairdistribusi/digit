const { loadGeneric, fromConfig } = require('./generic');
const presets = require('./presets');

// Urutan: bawaan → preset → SUPPLIERS_JSON (entri bernama sama menimpa yang sebelumnya)
const adapters = () => {
  const all = [require('./digiflazz'), require('./reloadly'), ...presets.map(fromConfig), ...loadGeneric()];
  return Object.fromEntries(all.map((a) => [a.name, a]));
};

// nama pemasok bawaan (bukan dari SUPPLIERS_JSON)
const builtin = (name) => ['digiflazz', 'reloadly', ...presets.map((p) => p.name)].includes(name);
const get = (name) => adapters()[name];
const enabled = () => Object.values(adapters()).filter((a) => a.enabled());

module.exports = { get, enabled, adapters, builtin };
