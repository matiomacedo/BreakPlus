/* Catálogo partilhado entre a BD e as duas apps.

   O arranque garante que existe um Produto por cada item de shared/data.js e
   preenche só os campos de apresentação que faltam no Atlas. Nunca sobrescreve
   aquilo que já está configurado (nome, preço, foto, categoria, períodos,
   stock, etiquetas...): se o documento existe, só recebe o valor do catálogo
   local quando o campo está vazio/ausente. Assim, alterações feitas à mão no
   MongoDB continuam a mandar e a app passa a ler tudo da API. */
const { Product } = require('./models');
const { loadSharedData } = require('./shared-data');

const r2 = (n) => Math.round(n * 100) / 100;

/** Valores que a app precisa de mostrar e que podem vir do catálogo local. */
function catalogueFields(item) {
  const fields = {
    name: item.name || '',
    price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
    category: item.category || '',
    periods: Array.isArray(item.periods) ? item.periods : [],
    photo: item.image || '',
    stock: Number.isFinite(Number(item.stock)) ? Number(item.stock) : 20,
    subtitle: item.subtitle || '',
    description: item.description || '',
    priceLabel: item.priceLabel || '',
    meta: item.meta || '',
    tag: item.tag || '',
    tagStyle: item.tagStyle || '',
    badges: Array.isArray(item.badges) ? item.badges : [],
    dietary: Array.isArray(item.dietary) ? item.dietary : [],
  };
  if (Number.isFinite(Number(item.complexity))) fields.complexity = Number(item.complexity);
  if (Number.isFinite(Number(item.prepMin))) fields.prepMin = Number(item.prepMin);
  return fields;
}

/** Um campo configurado no Atlas vale mais do que o valor de shared/data.js. */
const isMissing = (value) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

async function ensureCatalogue() {
  const { ITEMS } = loadSharedData();
  if (!ITEMS.length) return 0;

  // find().lean() não aplica os defaults do Mongoose: sabemos quais os campos
  // que realmente faltam na base de dados (importantíssimo para arrays vazios).
  const existing = await Product.find({ itemId: { $in: ITEMS.map((i) => i.id) } }).lean();
  const byId = new Map(existing.map((p) => [p.itemId, p]));
  const writes = [];

  for (const item of ITEMS) {
    const fields = catalogueFields(item);
    const current = byId.get(item.id);
    if (!current) {
      writes.push({ updateOne: {
        filter: { itemId: item.id },
        update: { $setOnInsert: { itemId: item.id, ...fields } },
        upsert: true,
      } });
      continue;
    }
    const set = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && isMissing(current[key]) && value !== current[key]) set[key] = value;
    }
    if (Object.keys(set).length) writes.push({ updateOne: { filter: { itemId: item.id }, update: { $set: set } } });
  }
  if (!writes.length) return 0;

  const result = await Product.bulkWrite(writes, { ordered: false });
  return result.upsertedCount || 0;
}

/** Formato único enviado ao aluno e ao terminal: sem _id, com todos os dados visíveis. */
function productOut(p) {
  const price = Number(p.price);
  const stock = Number(p.stock);
  const complexity = Number(p.complexity);
  const prepMin = Number(p.prepMin);
  return {
    itemId: p.itemId,
    name: p.name || '',
    price: Number.isFinite(price) ? r2(price) : 0,
    category: p.category || '',
    periods: Array.isArray(p.periods) ? p.periods : [],
    photo: p.photo || '',
    stock: Number.isFinite(stock) ? stock : 0,
    subtitle: p.subtitle || '',
    description: p.description || '',
    priceLabel: p.priceLabel || '',
    meta: p.meta || '',
    tag: p.tag || '',
    tagStyle: p.tagStyle || '',
    ...(Number.isFinite(complexity) ? { complexity } : {}),
    ...(Number.isFinite(prepMin) ? { prepMin } : {}),
    badges: Array.isArray(p.badges) ? p.badges.map((b) => (
      typeof b === 'object' ? { text: b.text || '', style: b.style || '' } : { text: String(b), style: '' }
    )) : [],
    dietary: Array.isArray(p.dietary) ? p.dietary : [],
  };
}

module.exports = { ensureCatalogue, productOut };
