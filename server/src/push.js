/* ==========================================================================
   push.js — Web Push para a app dos alunos.

   - As chaves VAPID são geradas na primeira utilização e guardadas na base de
     dados (Setting "_id: push"), por isso não é preciso configurar nada no
     Render. Se existirem VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY no ambiente,
     essas têm prioridade.
   - `sendToUser()` envia para todos os dispositivos subscritos desse aluno e
     apaga as subscrições que o browser já invalidou (404/410).
   - Sem chaves ou sem subscrições não faz nada: a app continua a funcionar
     com as notificações locais (polling) quando está aberta.
   ========================================================================== */

const webpush = require('web-push');
const { Setting, PushSubscription } = require('./models');

const SUBJECT = process.env.VAPID_SUBJECT || 'https://breakplus-one.vercel.app';

let keys = null;
let readyPromise = null;

/** Lê as chaves do ambiente ou da base de dados; gera-as na primeira vez. */
async function init() {
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;

  if (envPublic && envPrivate) {
    keys = { publicKey: envPublic, privateKey: envPrivate };
  } else {
    let doc = await Setting.findById('push');
    if (!doc || !doc.vapidPublicKey || !doc.vapidPrivateKey) {
      const generated = webpush.generateVAPIDKeys();
      doc = await Setting.findByIdAndUpdate(
        'push',
        { vapidPublicKey: generated.publicKey, vapidPrivateKey: generated.privateKey },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    keys = { publicKey: doc.vapidPublicKey, privateKey: doc.vapidPrivateKey };
  }

  webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
  return keys;
}

/** Garante que as chaves estão carregadas. Devolve null se o Web Push estiver indisponível. */
function ready() {
  if (keys) return Promise.resolve(keys);
  if (!readyPromise) {
    readyPromise = init().catch((error) => {
      console.warn('Web Push indisponível:', error.message);
      readyPromise = null;
      return null;
    });
  }
  return readyPromise;
}

/** Chave pública para o browser subscrever (null se ainda não estiver pronta). */
async function publicKey() {
  const k = await ready();
  return k ? k.publicKey : null;
}

/**
 * Envia uma notificação para todos os dispositivos do aluno.
 * `payload`: { title, body, tag, url } — ver o handler `push` em sw.js.
 * Devolve quantos dispositivos receberam o aviso.
 */
async function sendToUser(userId, payload) {
  if (!userId) return 0;
  const k = await ready();
  if (!k) return 0;

  const subscriptions = await PushSubscription.find({ user: userId });
  let sent = 0;
  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        JSON.stringify(payload),
        { TTL: 600, urgency: 'high' },
      );
      sent += 1;
    } catch (error) {
      // 404/410 = o browser desinstalou a app ou revogou a permissão: limpar.
      if (error.statusCode === 404 || error.statusCode === 410) {
        await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
      } else {
        console.warn('Push falhou:', error.statusCode || error.message);
      }
    }
  }));
  return sent;
}

/** Envia sem bloquear a resposta HTTP (o terminal não deve esperar pelo push). */
function notifyUser(userId, payload) {
  return sendToUser(userId, payload).catch((error) => console.warn('Push falhou:', error.message));
}

module.exports = { ready, publicKey, sendToUser, notifyUser };
