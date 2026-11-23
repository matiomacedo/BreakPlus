const { Schema, model } = require('mongoose');

const User = model('User', new Schema({
  name: { type: String, required: true },
  role: { type: String, enum: ['student', 'teacher', 'staff'], default: 'student' },   // staff = funcionárias do bar (terminal)
  roleLabel: { type: String, default: 'Estudante' },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  avatar: { type: String, default: '', trim: true },   // URL ou nome do ficheiro em ProfilePictureUser/
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
  /* Informação de apresentação: passa a vir da BD como o resto. O arranque preenche
     só os campos que faltam, sem sobrescrever nomes/preços/fotos configurados no Atlas. */
  subtitle: String, description: String, priceLabel: String, meta: String,
  tag: String, tagStyle: String,
  complexity: Number, prepMin: Number,
  badges: [{ _id: false, text: String, style: String }],
  dietary: [String],
}));

const OrderSchema = new Schema({
  number: { type: Number, unique: true, index: true },    // identificador único e sequencial (interno)
  ticket: Number, ticketDay: String,                       // senha do dia (recomeça em 1 todos os dias, Lisboa)
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  customer: String, role: String,   // cópia no momento do pedido (fallback se a conta for apagada)
  type: { type: String, enum: ['now', 'reservation'] },
  status: { type: String, enum: ['reserved', 'received', 'preparing', 'ready', 'done', 'cancelled'] },
  items: { type: Schema.Types.Mixed },                     // { itemId: qty }
  total: Number,
  pickupKey: String, pickupTime: String,
  pickupAt: Number,                                         // hora de levantamento (ms), calculada no servidor (Lisboa)
  queuedAt: Number, readyAt: Number, doneAt: Number, cancelledAt: Number,   // carimbos (ms) usados no terminal
  notifiedAt: { type: Number, default: 0 },
  cancelledBy: { type: String, enum: ['student', 'staff', null], default: null },
  cancelledByName: { type: String, default: null },        // quem anulou (nome da funcionária ou do aluno)
  giftCode: String, giftFrom: String, giftFromName: String, giftMessage: String,  // pedido de uma oferta (0 €)
  actions: [{ _id: false, action: String, by: String, at: Number }],   // o que o bar fez ao pedido e quem
}, { timestamps: true });
OrderSchema.index({ createdAt: -1 });                      // "Mais pedido" lê os pedidos dos últimos dias
const Order = model('Order', OrderSchema);

/* Um café pago por um aluno e levantado por outro quando quiser.
   O saldo sai na criação; o stock e a senha só são alocados no levantamento.
   `status` usa compare-and-set (pending → claimed/refunded) para uma oferta
   nunca ser levantada duas vezes, mesmo com pedidos em simultâneo. */
const GiftSchema = new Schema({
  code: { type: String, required: true, unique: true, index: true },
  from: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fromName: String,
  to: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  toName: String,
  toEmail: { type: String, required: true, lowercase: true, trim: true },
  itemId: Number, productName: String, amount: Number,
  message: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'claimed', 'refunded'], default: 'pending' },
  expiresAt: { type: Number, required: true },             // ms; reembolso preguiçoso ao fim de GIFT.expireDays
  claimedAt: Number, refundedAt: Number, order: Number,    // senha do pedido criado no levantamento
}, { timestamps: true });
GiftSchema.index({ status: 1, expiresAt: 1 });
const Gift = model('Gift', GiftSchema);

const Transaction = model('Transaction', new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  kind: { type: String, enum: ['topup', 'order', 'refund', 'gift', 'gift_refund'] },
  amount: Number,                                           // + entra, − sai
  order: Number,
  ticket: Number,                                           // senha do pedido (para o texto do movimento)
  gift: String, giftName: String,                           // código e nome da outra pessoa (movimentos de oferta)
}, { timestamps: true }));

// Subscrição Web Push de um dispositivo (uma por endpoint; a mesma conta pode ter várias)
const PushSubscription = model('PushSubscription', new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  endpoint: { type: String, required: true, unique: true },
  keys: { p256dh: String, auth: String },
  createdAt: { type: Date, default: Date.now },
}));

// Ocupação de cada hora de levantamento (reservas ativas). O índice único evita duas contagens para a mesma hora.
const SlotSchema = new Schema({ key: String, time: String, count: { type: Number, default: 0 } });
SlotSchema.index({ key: 1, time: 1 }, { unique: true });
const Slot = model('Slot', SlotSchema);

// Estado global do bar (pausa) + contador de pedidos + senha do dia + chaves VAPID (geradas uma vez)
const Setting = model('Setting', new Schema({
  _id: String, paused: { type: Boolean, default: false }, lastNumber: { type: Number, default: 100 },
  ticketDay: String, lastTicket: { type: Number, default: 0 },
  vapidPublicKey: String, vapidPrivateKey: String,
}));

module.exports = { User, Product, Order, Gift, Transaction, PushSubscription, Setting, Slot };
