/* Garante que o catálogo do Mongo tem um Produto por cada item de shared/data.js.

   A app e o terminal leem os nomes/fotos de ITEMS (shared/data.js), mas o stock
   e o preço vêm da base de dados. Um "Café" inserido à mão no Atlas não aparecia
   porque não existia nesse ficheiro; agora o item é canónico e este arranque
   cria o documento que falta. `$setOnInsert` não mexe em preços, nomes nem stock
   já configurados à mão (incluindo um Café antigo com outro itemId). */
const { Product } = require('./models');
const { loadSharedData } = require('./shared-data');

async function ensureCatalogue() {
  const { ITEMS } = loadSharedData();
  if (!ITEMS.length) return 0;
  const result = await Product.bulkWrite(ITEMS.map((item) => ({
    updateOne: {
      filter: { itemId: item.id },
      update: { $setOnInsert: {
        itemId: item.id, name: item.name, price: item.price, category: item.category,
        periods: item.periods, photo: item.image || '', stock: item.stock ?? 20,
      } },
      upsert: true,
    },
  })), { ordered: false });
  return result.upsertedCount || 0;
}

module.exports = { ensureCatalogue };
