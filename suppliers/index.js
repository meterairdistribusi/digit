const { loadGeneric } = require('./generic');

const adapters = () => {
  const all = [require('./digiflazz'), ...loadGeneric()];
  return Object.fromEntries(all.map((a) => [a.name, a]));
};

const get = (name) => adapters()[name];
const enabled = () => Object.values(adapters()).filter((a) => a.enabled());

module.exports = { get, enabled, adapters };
