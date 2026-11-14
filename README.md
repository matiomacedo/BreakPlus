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

O servidor recusa arrancar se faltar `MONGODB_URI`, `JWT_SECRET` ou `TERMINAL_KEY`, ou se o MongoDB não for um replica set.

> A chave do terminal está num ficheiro estático: quem conseguir abrir `/terminal/config.js` consegue lê-la.
> Serve a pasta `terminal/` só no computador do balcão (ou na rede interna), não no mesmo servidor público da app dos alunos.

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

> Ao alterar ficheiros da app, sobe `CACHE_VERSION` em `sw.js` para os clientes antigos receberem a versão nova.

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
server/               API (ver server/README.md)
images/               logótipo e fotos dos pratos (nomes em shared/data.js)
```

Cada app cria a sua `Store` com `createStore()` (`shared/api.js`), injetando a forma de falar com o servidor
(o aluno com o token de sessão, o terminal com a chave) e as suas ações de escrita. As vistas só falam com `Store`.

Estados de um pedido: `reserved` → `received` → `preparing` → `ready` → `done` (ou `cancelled`).
