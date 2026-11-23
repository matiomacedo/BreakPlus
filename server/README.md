# Break+ server

API Express + Mongoose para a app dos alunos (`/api/*`) e para o terminal do bar (`/api/terminal/*`).

## Arrancar

1. MongoDB (**tem de ser um replica set**, ver abaixo). Atlas: cluster gratuito → Database Access (utilizador) → Network Access (o teu IP) → Connect → copiar a connection string.
2. `cp .env.example .env` e preenche:
   - `MONGODB_URI`: a connection string.
   - `JWT_SECRET`: valor aleatório (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   - `CORS_ORIGINS`: de onde abres as páginas, ex.: `http://localhost:8000,http://localhost:5500`.
3. `npm install && npm run seed && npm run dev`
   - ⚠️ `npm run seed` **apaga** todas as coleções da base de dados indicada em `MONGODB_URI`.
   - `npm run create-staff` só acrescenta a conta do terminal (`bar@demo.pt` / `demo1234` / PIN `9999`, ou `-- <email> <nome> <password> <pin>`), sem apagar nada.
4. Testar: `curl localhost:3000/api/version`. O terminal usa o login de uma conta com o papel `staff` (o seed cria `bar@demo.pt` / `demo1234` / PIN `9999`).

5. Atualizar/Adicionar Produtos: Para atualizar ou adicionar produtos a partir de shared/data.js sem apagar pedidos, utilizadores ou outras coleções, executa npm run products:update na pasta server. O stock dos produtos existentes é preservado; produtos novos começam com stock 20, salvo se shared/data.js definir outro valor.

O servidor recusa arrancar (com a razão na consola) se faltar `MONGODB_URI` ou `JWT_SECRET`, ou se o MongoDB não for um replica set.

## Porque é que preciso de um replica set?

Os pedidos e os cancelamentos mexem no stock, no saldo e no histórico numa **transação**, e o MongoDB só tem transações num replica set.
- **Atlas:** já é um replica set, não tens de fazer nada.
- **mongod local:** arranca-o com `mongod --replSet rs0 --dbpath <pasta>` e corre uma vez `rs.initiate()` no `mongosh`. Depois usa `MONGODB_URI=mongodb://127.0.0.1:27017/breakplus?replicaSet=rs0`.

## Rotas

| Quem | Rotas | Proteção |
|---|---|---|
| Alunos/docentes | `POST /api/auth/login`, `POST /api/auth/pin`, `GET /api/auth/me`, `GET /api/state`, `POST /api/orders`, `POST /api/orders/:id/cancel`, `GET /api/slots`, `POST /api/wallet/topup`, `GET /api/menu`, `GET /api/orders/mine` | token de sessão (password + PIN) de um aluno/docente; `GET /api/auth/me` aceita qualquer papel |
| Terminal | `GET /api/terminal/state`, `POST /api/terminal/orders/:id/status`, `.../notify`, `.../cancel`, `POST /api/terminal/stock/:id`, `POST /api/terminal/paused` | token de sessão de uma conta `staff` (outro papel → 403) |
| Tempo real | Socket.IO em `/socket.io/`: evento `changed` `{ type }` depois de cada escrita (a app volta a pedir o seu `/state`). Sala por aluno (só os seus pedidos/saldo) e sala do terminal (todos) | `auth: { token }` (sessão completa; contas `staff` entram na sala do terminal). Pedidos: `order` ao dono e ao terminal, `queue` (sem dados) aos outros |

`:id` é o identificador único do pedido (`_id`). A senha mostrada ao aluno e no balcão (`ticket`) recomeça em 1 todos os dias (Europe/Lisbon), por isso repete-se entre dias e nunca é usada nas rotas.

## Código

```
src/index.js      arranque: configuração, ligação ao MongoDB, verificação do replica set
src/config.js     variáveis de ambiente (falha logo se faltar alguma obrigatória)
src/app.js        monta a API (CORS, JSON, routers)
src/student.js    rotas da app dos alunos (login em 2 passos, estado, pedidos, saldo)
src/terminal.js   rotas do terminal (sessão staff; regista quem fez cada ação)
src/realtime.js   Socket.IO: autenticação das ligações, salas e avisos de mudança
src/orders.js     regras partilhadas: cancelar (reembolso + stock), fila, definições do bar
src/auth.js       hashes, tokens e middleware de sessão
src/db.js         transações e verificação do replica set
src/shared-data.js  lê shared/data.js (produtos e regras das reservas)
src/models.js, src/seed.js
```

## Testes

`npm test`: usa um MongoDB em memória (`mongodb-memory-server`, replica set), nunca a base de dados do `.env`.
Na primeira vez descarrega o binário do MongoDB (~66 MB).
