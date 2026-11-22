/* Cria uma conta de funcionária do bar (papel "staff") sem apagar nada da base de dados.
   Uso: npm run create-staff [-- <email> <nome> <password> <pin>]
   Sem argumentos cria a conta de demonstração bar@demo.pt / demo1234 / PIN 9999 (ver README). */
require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('./models');
const { hash } = require('./auth');

const [email = 'bar@demo.pt', name = 'Rosa Ferreira', password = 'demo1234', pin = '9999'] = process.argv.slice(2);

(async () => {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI (server/.env ou variável de ambiente).');
  if (!/^\d{4}$/.test(pin)) throw new Error('O PIN tem de ter 4 dígitos.');
  await mongoose.connect(process.env.MONGODB_URI);
  if (await User.exists({ email: email.toLowerCase().trim() })) {
    console.log(`Já existe uma conta com ${email}: nada foi alterado.`);
  } else {
    await User.create({ name, role: 'staff', roleLabel: 'Funcionária', email, passwordHash: hash(password), pinHash: hash(pin) });
    console.log(`Conta de funcionária criada: ${email} (PIN de 4 dígitos definido).`);
  }
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e.message); await mongoose.disconnect(); process.exit(1); });
