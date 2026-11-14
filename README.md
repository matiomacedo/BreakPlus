# Break+ · SIR

Duas apps que falam com a mesma API (Express + MongoDB, em `server/`):

| App | Quem usa | Abrir | Acesso |
|---|---|---|---|
| **Alunos / docentes** | telemóvel | `http://localhost:8000/` | login: email + password, depois o PIN do cartão |
| **Terminal do bar** | funcionárias, no balcão (tablet/PC) | `http://localhost:8000/terminal/` | sem login: chave do terminal em `terminal/config.js` |

## Como pôr a funcionar

1. **API** (ver também `server/README.md`):
   ```sh
   cd server
   cp .env.example .env        # preenche MONGODB_URI, JWT_SECRET, TERMINAL_KEY, CORS_ORIGINS
   npm install
   npm run seed                # APAGA a base de dados e cria produtos + contas de demonstração
   npm run dev                 # API em http://localhost:3000
   ```
2. **Chave do terminal:** `cp terminal/config.example.js terminal/config.js` e cola lá o mesmo valor de `TERMINAL_KEY` do `server/.env`.
3. **Páginas:** serve a pasta do projeto (a raiz, não `server/`) num servidor estático, por exemplo:
   - na raiz do projeto: `python3 -m http.server 8000`, ou
   - VS Code → extensão *Live Server* → "Go Live" (porta 5500).

   A origem das páginas (ex.: `http://localhost:8000`) tem de estar em `CORS_ORIGINS` no `server/.env`.
4. Abre as duas apps (ver a tabela acima). Contas de demonstração: `aluno@demo.pt` / `demo1234` / PIN `1234` e `ana@demo.pt` / `demo1234` / PIN `4321`.
5. Faz um pedido na app dos alunos: aparece no terminal em ~2,5 s. No terminal avança o pedido (Recebido → A preparar → Pronto → Entregue): o aluno recebe os avisos.

> Não abras os ficheiros com duplo clique (`file://`): a API só aceita pedidos das origens em `CORS_ORIGINS`.
> O terminal acrescenta sozinho a `/` final se o abrires como `/terminal` (sem ela, os caminhos relativos do CSS/JS apontavam para a raiz).

### Arranque rápido (Windows)

Depois de configurares `server/.env` e `terminal/config.js` (passos 1 e 2), faz duplo clique em **`start.bat`** na raiz do projeto. O script abre duas janelas — API e páginas — e abre as duas apps no browser. Para arrancar sem abrir o browser: `start.bat /nobrowser`.

## Configuração

| Ficheiro | O quê | No git? |
|---|---|---|
| `server/.env` | `MONGODB_URI`, `JWT_SECRET`, `TERMINAL_KEY`, `CORS_ORIGINS`, `PORT`, `DATA_JS` (ver `server/.env.example`) | **não** |
| `terminal/config.js` | `terminalKey` (= `TERMINAL_KEY`) e `apiUrl` opcional | **não** (modelo: `config.example.js`) |
| `js/config.js` | `apiUrl` da app dos alunos (vazio = mesmo computador, porta 3000) | sim |
| variáveis da Vercel | `BREAKPLUS_API_URL` e `TERMINAL_KEY` → geram `dist/js/config.js` e `dist/terminal/config.js` no build | — (só no deploy) |

O servidor recusa arrancar se faltar `MONGODB_URI`, `JWT_SECRET` ou `TERMINAL_KEY`, ou se o MongoDB não for um replica set.

> A chave do terminal está num ficheiro estático: quem conseguir abrir `/terminal/config.js` consegue lê-la.
> Serve a pasta `terminal/` só no computador do balcão (ou na rede interna), não no mesmo servidor público da app dos alunos.

## Publicar online (Render + Vercel)

A API fica no **Render** e o frontend estático na **Vercel**. O `terminal/config.js` continua fora do git: na Vercel é **gerado no build** a partir de variáveis de ambiente.

### 1. API no Render (Web Service)

| Campo | Valor |
|---|---|
| **Root Directory** | `server` |
| **Build Command** | `npm ci --omit=dev` (ou `npm install --omit=dev`) |
| **Start Command** | `npm start` |
| **Health Check Path** | vazio |
| **Instance Type** | Free (sofre cold starts: a primeira chamada pode demorar ~5 s) |

Variáveis de ambiente:

| Nome | Valor |
|---|---|
| `MONGODB_URI` | connection string do MongoDB Atlas |
| `JWT_SECRET` | segredo aleatório novo |
| `TERMINAL_KEY` | chave aleatória nova (a mesma que a Vercel vai receber) |
| `CORS_ORIGINS` | `https://breakplus-one.vercel.app` (o domínio da Vercel; aceita vários separados por vírgula) |
| `NODE_ENV` | `production` |

Não definir `PORT` (o Render atribui) nem `DATA_JS` (o default `../shared/data.js` funciona porque o repositório completo é clonado).

Gerar segredos:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

No MongoDB Atlas, **Network Access** tem de permitir o Render. No plano free os IPs de saída não são fixos, por isso usa `0.0.0.0/0` (mantém uma password forte no utilizador da BD).

### 2. Frontend na Vercel

O `vercel.json` já define o build (`node scripts/build-config.js`) e a pasta publicada (`dist/`). Em **Settings → Environment Variables** define:

| Nome | Valor |
|---|---|
| `BREAKPLUS_API_URL` | `https://breakplus.onrender.com` (o URL do Render, sem `/` no fim) |
| `TERMINAL_KEY` | exatamente o mesmo valor de `TERMINAL_KEY` do Render |

O script copia o frontend para `dist/` e gera:

- `dist/js/config.js` → `apiUrl`
- `dist/terminal/config.js` → `apiUrl` + `terminalKey`

Assim o `/terminal` funciona online sem nenhuma chave no repositório. Se mudares `TERMINAL_KEY` no Render, atualiza a variável na Vercel e faz **Redeploy**; senão o terminal fica com `401 terminal_key`.

Em desenvolvimento local nada disto é preciso: continua a usar `terminal/config.js` e `js/config.js` como antes.

> A chave gerada para o terminal fica visível no JavaScript servido ao browser. Como o terminal não tem login, qualquer pessoa com o URL poderia chamar a API do terminal. Para uso real, protege o `/terminal` (Vercel Password Protection, rede interna ou um proxy com autenticação).

### 3. Ordem recomendada

1. Atlas → permitir o Render em Network Access.
2. Render → criar o serviço e copiar o URL público.
3. Vercel → definir `BREAKPLUS_API_URL` e `TERMINAL_KEY` e fazer deploy.
4. Copiar o domínio final da Vercel para `CORS_ORIGINS` no Render e guardar (o Render reinicia).
5. Abrir a app, entrar e confirmar na consola do browser que não há erros de CORS.
6. Se o domínio da API ou a chave mudarem, sobe `CACHE_VERSION` em `sw.js` para as PWAs instaladas não continuarem com a configuração antiga em cache.

## O que cada uma faz

- **Alunos:** menu, carrinho, *pedir agora* ou *reservar* (só para o dia de hoje, até às **18:00**), saldo, cancelar reservas (até 30 min antes), avisos quando o pedido fica pronto. Depois das 18:00 já não há reservas nesse dia.
- **Terminal:** fila de pedidos (avançar por botão ou barra), reservas por hora de levantamento, stock com +/−, anular pedidos (devolve o saldo e repõe o stock), pausar pedidos na hora.

A interface usa transições suaves em botões, chips, cartões e painéis (entrada em cascata, brilho ao pairar, resposta ao toque). Com **movimento reduzido** ativo no sistema, as animações são desligadas automaticamente.

## App instalável (PWA)

A app dos alunos pode ser instalada no ecrã principal e abre em ecrã completo (`display: standalone`).

- `manifest.webmanifest` — nome, ícones (gerados a partir de `icons/icon-300.png`, em `icons/`), cores de `shared/tokens.css` e `start_url`.
- `sw.js` — service worker que guarda a casca da app (HTML, CSS, JS, imagens) para abrir depressa e sem rede. As chamadas a `/api/` **não** são guardadas: os dados continuam a vir do servidor.
- `js/pwa.js` — regista o service worker e guarda o evento de instalação para o botão “Instalar no ecrã principal” (ecrã **Mais**, quando o browser o disponibiliza).
- Sem rede, a app abre a última cópia e mostra o aviso fixo **“Sem ligação · a mostrar os últimos dados”**. A última resposta boa de `/api/state` fica em `localStorage` para o ecrã não aparecer vazio.
- A sessão também fica guardada: sem rede a app abre com a última conta conhecida e **só volta ao login se o servidor recusar mesmo o token (401)**. Se ainda não houver conta guardada, mostra “Sem ligação ao servidor” com **Tentar outra vez** e volta a tentar sozinha quando a rede regressa.

### Testar a instalação

- **Android (Chrome):** abrir a app em `http(s)://…`, menu ⋮ → **Instalar app** (ou **Adicionar ao ecrã principal**). Confirmar que abre sem barra de endereço e com o ícone do Break+.
- **iOS (Safari):** **Partilhar** → **Adicionar ao ecrã principal**. Abre a partir do ícone em ecrã completo.
- O service worker e a instalação exigem `http://localhost` ou HTTPS; por `file://` a app funciona, mas sem cache offline.
- No telemóvel a app mantém o zoom fixo: o pinch e o duplo-toque estão desativados (`shared/nozoom.js` + `touch-action`), e os campos de login usam 16px para o iOS não ampliar ao focar.

> Ao alterar ficheiros da app, sobe `CACHE_VERSION` em `sw.js` para os clientes antigos receberem a versão nova.

## Fotografia de perfil

O avatar do ecrã **Mais** mostra a fotografia do utilizador quando existe; sem imagem, mostra a inicial do nome.

- A base de dados guarda o URL no campo `avatar` do utilizador (`server/src/models.js`). Pode ser um path completo (`/ProfilePictureUser/ana.svg`) ou só o nome do ficheiro (`ana.svg`); o cliente completa os nomes com `/ProfilePictureUser/`.
- As imagens ficam em `ProfilePictureUser/` (ver o README da pasta). Os ficheiros de demonstração são `goncalo.svg` e `ana.svg`.
- O campo é devolvido por `publicUser()` no login, no PIN e em `GET /api/auth/me`, por isso a app já o tem ao entrar e também o guarda na conta em cache para abrir sem rede.
- Se a imagem falhar, o `<img>` é removido e a inicial continua visível como fallback.

## Avisos do pedido como notificação do sistema

O toast dentro da app continua a existir, mas quando a app está noutro separador ou em segundo plano o aluno recebe uma **notificação do sistema** (Notification API + service worker).

- A preferência **Aviso de pedido pronto** (ecrã **Mais**) fica guardada em `localStorage` e já não se perde ao recarregar; controla também os avisos de senha chamada, reserva a preparar e anulação.
- Ao ligar a preferência, o browser pede permissão. Se a preferência já vinha ligada, o pedido é feito no primeiro toque na app.
- Avisos: pedido **pronto**, bar a **chamar a senha**, reserva a começar a ser **preparada** e pedido **anulado pelo bar** (com o valor devolvido).
- Os avisos reagem às atualizações da `Store` (`shared/api.js`). Hoje a Store atualiza por polling de 2,5 s; quando o [#1 — Atualização em tempo real com WebSockets (Socket.IO)] estiver ligado, os mesmos eventos disparam as notificações sem alterar esta lógica.

### Limitação: app fechada (Web Push)

Enquanto a app estiver aberta/em segundo plano, as notificações funcionam. Com a app **fechada**, seria preciso **Web Push** com um servidor de push (VAPID) e subscrições guardadas no backend — isso está fora do âmbito atual. O handler `push` do `sw.js` já está preparado para quando essa parte existir.

### Testar com dois separadores

1. Abrir a app, iniciar sessão e ligar **Aviso de pedido pronto** em **Mais** (aceitar a permissão).
2. Deixar a app noutro separador (ou minimizar a janela).
3. No terminal do bar, avançar um pedido até **Pronto**.
4. Confirmar que aparece a notificação do sistema com o número do pedido.

## Estrutura

```
index.html            app dos alunos
manifest.webmanifest  nome, ícones e cores da PWA
sw.js                 service worker: cache da app e base das notificações
icons/                ícones da PWA (fonte: icons/icon-300.png)
js/                   app dos alunos: config, login (auth.js), store.js, estado, UI,
                      notificações do sistema (notifications.js), PWA (pwa.js), eventos
css/                  estilos da app dos alunos (styles.css, auth.css)
terminal/index.html   app do terminal
terminal/js/          store.js (chave do terminal + ações do balcão), ui.js, app.js
terminal/css/         estilos do terminal
shared/
  data.js             pratos, bar e regras das reservas (o servidor também lê este ficheiro)
  util.js             funções puras (formatação, datas, totais)
  api.js              requestJson() + createStore(): estado do servidor, atualizado de 2,5 em 2,5 s
  tokens.css          cores e sombras comuns às duas apps
  boot.css            ecrã de carregamento inicial (spinner) das duas apps
  nozoom.js           bloqueia o zoom por gesto nas duas apps (telemóvel/PWA)
scripts/
  build-config.js     build da Vercel: copia o frontend para dist/ e gera os config.js
vercel.json           build e pasta publicada na Vercel
server/               API (ver server/README.md)
images/               logótipo e fotos dos pratos (nomes em shared/data.js)
ProfilePictureUser/   fotografias de perfil (avatar dos utilizadores)
```

Cada app cria a sua `Store` com `createStore()` (`shared/api.js`), injetando a forma de falar com o servidor
(o aluno com o token de sessão, o terminal com a chave) e as suas ações de escrita. As vistas só falam com `Store`.

Estados de um pedido: `reserved` → `received` → `preparing` → `ready` → `done` (ou `cancelled`).
