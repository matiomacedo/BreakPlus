require('dotenv').config();
const mongoose = require('mongoose');
const { User, Product, Order, Transaction, Setting } = require('./models');
const { hash } = require('./auth');
const { loadSharedData } = require('./shared-data');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { ITEMS } = loadSharedData();
  await Promise.all([User, Product, Order, Transaction, Setting].map((m) => m.deleteMany({})));
  await Product.insertMany(ITEMS.map((i) => ({
    itemId: i.id, name: i.name, price: i.price, category: i.category,
    periods: i.periods, photo: i.image || '', stock: i.stock ?? 20,
  })));
  // Contas de demonstração (muda as passwords/PINs antes de qualquer deploy)
  await User.create([
    { name: 'Gonçalo Silva', role: 'student', roleLabel: 'Estudante', email: 'aluno@demo.pt', passwordHash: hash('demo1234'), pinHash: hash('1234'), balance: 12.5, avatar: '/ProfilePictureUser/goncalo.svg' },
    { name: 'Ana Costa', role: 'student', roleLabel: 'Estudante', email: 'ana@demo.pt', passwordHash: hash('demo1234'), pinHash: hash('4321'), balance: 8, avatar: '/ProfilePictureUser/ana.svg' },
  ]);
  await Setting.create({ _id: 'bar', paused: false, lastNumber: 100 });
  console.log(`Seed ok: ${ITEMS.length} produtos, 2 utilizadores`);
  console.log('Login: aluno@demo.pt / demo1234 / PIN 1234  ·  ana@demo.pt / demo1234 / PIN 4321');
  await mongoose.disconnect();
})();
