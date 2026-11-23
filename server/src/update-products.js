require('dotenv').config();
const mongoose = require('mongoose');
const { Product } = require('./models');
const { loadSharedData } = require('./shared-data');

async function updateProducts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const { ITEMS } = loadSharedData();
    const result = await Product.bulkWrite(ITEMS.map((item) => ({
      updateOne: {
        filter: { itemId: item.id },
        update: {
          $set: {
            name: item.name,
            price: item.price,
            category: item.category,
            periods: item.periods,
            photo: item.image || '',
          },
          $setOnInsert: { stock: item.stock ?? 20 },
        },
        upsert: true,
      },
    })));

    console.log(`Produtos atualizados: ${result.modifiedCount}; criados: ${result.upsertedCount}.`);
  } catch (error) {
    console.error('Não foi possível atualizar os produtos:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

updateProducts();