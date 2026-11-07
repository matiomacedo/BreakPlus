const { Schema, model } = require('mongoose');

const User = model('User', new Schema({
  name: { type: String, required: true },
  role: { type: String, enum: ['student', 'teacher'], default: 'student' },
  roleLabel: { type: String, default: 'Estudante' },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  pinHash: { type: String, required: true, select: false },   // PIN (4 dígitos) do cartão da escola
  failCount: { type: Number, default: 0, select: false },
  lockUntil: { type: Date, default: null, select: false },
  balance: { type: Number, default: 0, min: 0 },       // em euros, 2 casas
}, { timestamps: true }));

const Product = model('Product', new Schema({
  itemId: { type: Number, required: true, unique: true },  // id usado no front (ITEMS)
  name: String, price: Number, category: String, periods: [String], photo: String,
  stock: { type: Number, default: 0, min: 0 },
}));

const Order = model('Order', new Schema({
  number: { type: Number, unique: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  customer: String, role: String,
  type: { type: String, enum: ['now', 'reservation'] },
  status: { type: String, enum: ['reserved', 'received', 'preparing', 'ready', 'done', 'cancelled'] },
  items: { type: Schema.Types.Mixed },                     // { itemId: qty }
  total: Number,
  pickupKey: String, pickupTime: String,
  pickupAt: Number,                                         // hora de levantamento (ms), calculada no cliente
  queuedAt: Number, readyAt: Number, doneAt: Number, cancelledAt: Number,   // carimbos (ms) usados no terminal
  notifiedAt: { type: Number, default: 0 },
  cancelledBy: { type: String, enum: ['student', 'staff', null], default: null },
}, { timestamps: true }));

const Transaction = model('Transaction', new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  kind: { type: String, enum: ['topup', 'order', 'refund'] },
  amount: Number,                                           // + entra, − sai
  order: Number,
}, { timestamps: true }));

// Estado global do bar (pausa) + contador de senhas
const Setting = model('Setting', new Schema({
  _id: String, paused: { type: Boolean, default: false }, lastNumber: { type: Number, default: 100 },
}));

module.exports = { User, Product, Order, Transaction, Setting };
