# Fotografias de perfil

Imagens usadas no avatar da app dos alunos (ecrã **Mais**).

- O campo `avatar` do utilizador na base de dados guarda **um URL/path completo**
  (`/ProfilePictureUser/ana.svg`) **ou só o nome do ficheiro** (`ana.svg`).
- O cliente (`js/ui.js`) completa nomes sem barra com `/ProfilePictureUser/`.
- Formatos: SVG, PNG, JPG ou WebP. Para fotos reais, usa uma imagem quadrada
  (por exemplo 400×400) e substitui o ficheiro mantendo o mesmo nome, ou atualiza
  o campo `avatar` do utilizador.

## Ficheiros de demonstração

| Ficheiro      | Conta de demonstração |
| ------------- | --------------------- |
| `goncalo.svg` | `aluno@demo.pt`       |
| `ana.svg`     | `ana@demo.pt`         |

Para definir a imagem de um utilizador:

```js
// server/ (com MONGODB_URI definido)
await User.updateOne({ email: 'aluno@demo.pt' }, { avatar: '/ProfilePictureUser/goncalo.svg' });
```

O servidor devolve o campo em `publicUser()` (login, PIN e `GET /api/auth/me`),
por isso a app mostra a imagem sem pedidos adicionais.
