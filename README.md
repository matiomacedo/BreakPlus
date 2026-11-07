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

- **Alunos:** menu, carrinho, *pedir agora* ou *reservar* (dia + hora), saldo, cancelar reservas (até 30 min antes), avisos quando o pedido fica pronto.
- **Terminal:** fila de pedidos (avançar por botão ou barra), reservas por hora de levantamento, stock com +/−, anular pedidos (devolve o saldo e repõe o stock), pausar pedidos na hora.

## Estrutura

```
index.html            app dos alunos
js/                   app dos alunos: config, login (auth.js), store.js, estado, UI, eventos
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
