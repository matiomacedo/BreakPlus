# Break+ server

API Express + Mongoose para a app dos alunos (`/api/*`) e para o terminal do bar (`/api/terminal/*`).

## Arrancar

1. MongoDB (**tem de ser um replica set**, ver abaixo). Atlas: cluster gratuito → Database Access (utilizador) → Network Access (o teu IP) → Connect → copiar a connection string.
2. `cp .env.example .env` e preenche:
   - `MONGODB_URI`: a connection string.
   - `JWT_SECRET` e `TERMINAL_KEY`: valores aleatórios (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   - `CORS_ORIGINS`: de onde abres as páginas, ex.: `http://localhost:8000,http://localhost:5500`.
3. `npm install && npm run seed && npm run dev`
   - ⚠️ `npm run seed` **apaga** todas as coleções da base de dados indicada em `MONGODB_URI`.
4. Copia `TERMINAL_KEY` para `terminal/config.js` (a partir de `terminal/config.example.js`).
5. Testar: `curl -H "X-Terminal-Key: <a chave>" localhost:3000/api/terminal/state`

O servidor recusa arrancar (com a razão na consola) se faltar `MONGODB_URI`, `JWT_SECRET` ou `TERMINAL_KEY`, ou se o MongoDB não for um replica set.

## Porque é que preciso de um replica set?

Os pedidos e os cancelamentos mexem no stock, no saldo e no histórico numa **transação**, e o MongoDB só tem transações num replica set.
- **Atlas:** já é um replica set, não tens de fazer nada.
- **mongod local:** arranca-o com `mongod --replSet rs0 --dbpath <pasta>` e corre uma vez `rs.initiate()` no `mongosh`. Depois usa `MONGODB_URI=mongodb://127.0.0.1:27017/breakplus?replicaSet=rs0`.

## Rotas

| Quem | Rotas | Proteção |
|---|---|---|
| Alunos/docentes | `POST /api/auth/login`, `POST /api/auth/pin`, `GET /api/auth/me`, `GET /api/state`, `POST /api/orders`, `POST /api/orders/:n/cancel`, `POST /api/wallet/topup`, `GET /api/menu`, `GET /api/orders/mine` | token de sessão (password + PIN) |
| Terminal | `GET /api/terminal/state`, `POST /api/terminal/orders/:n/status`, `.../notify`, `.../cancel`, `POST /api/terminal/stock/:id`, `POST /api/terminal/paused` | cabeçalho `X-Terminal-Key` = `TERMINAL_KEY` |

## Código

```
src/index.js      arranque: configuração, ligação ao MongoDB, verificação do replica set
src/config.js     variáveis de ambiente (falha logo se faltar alguma obrigatória)
src/app.js        monta a API (CORS, JSON, routers)
src/student.js    rotas da app dos alunos (login em 2 passos, estado, pedidos, saldo)
src/terminal.js   rotas do terminal (chave partilhada)
src/orders.js     regras partilhadas: cancelar (reembolso + stock), fila, definições do bar
src/auth.js       hashes, tokens e middleware de sessão
src/db.js         transações e verificação do replica set
src/shared-data.js  lê shared/data.js (produtos e regras das reservas)
src/models.js, src/seed.js
```

## Testes

`npm test`: usa um MongoDB em memória (`mongodb-memory-server`, replica set), nunca a base de dados do `.env`.
Na primeira vez descarrega o binário do MongoDB (~66 MB).
