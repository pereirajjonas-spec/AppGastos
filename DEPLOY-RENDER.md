# Deploy de teste no Render

O `render.yaml` na raiz do projeto já descreve o serviço (Docker, health check em `/health`, cookie seguro, proxy, `JWT_SECRET` gerado automaticamente).

> **Plano gratuito = banco volátil.** Sem disco persistente, o banco (usuários, viagens, notas) volta ao zero quando o serviço reinicia, é reimplantado ou "dorme" por inatividade. Serve para teste. Para manter dados, use um plano pago com disco (veja o final).

## 1. Subir o código para o GitHub
O Render lê o código de um repositório. Use um repositório **privado**.
```bash
git init
git add .
git status        # confira: NÃO podem aparecer .env, data/, *.db, node_modules/
git commit -m "Despesas de Viagem - Grupo MSA"
git remote add origin https://github.com/SEU_USUARIO/despesas-viagem.git
git push -u origin main
```
O `.gitignore` já exclui `.env`, `data/` e bancos. Se `.env` aparecer no `git status`, pare e me avise.

## 2. Criar o serviço
1. Em render.com: **New > Blueprint** e escolha o repositório.
2. O Render lê o `render.yaml` e pede os valores marcados como `sync: false`:

| Variável | O que informar |
|---|---|
| `APP_URL` | O endereço do serviço, ex.: `https://despesas-viagem-msa.onrender.com` (o nome definitivo aparece depois de criar; se mudar, edite aqui) |
| `ANTHROPIC_API_KEY` | Chave da Anthropic. Prefira uma chave só para este teste, com limite de gasto |
| `ADMIN_EMAIL` | E-mail do administrador (domínio `grupomsa.com.br`) |
| `ADMIN_NOME` | Nome do administrador |
| `ADMIN_SENHA` | Senha inicial (mín. 8, letras e números). Depois do primeiro acesso, troque-a pelo app |

3. Clique em **Apply**. O primeiro build leva alguns minutos.

O administrador é criado automaticamente no primeiro start, só se ainda não existir nenhum. Depois disso, `ADMIN_*` é ignorado.

## 3. Conferir
- `https://SEU-SERVICO.onrender.com/health` deve responder `{"ok":true}`.
- Entre com `ADMIN_EMAIL` / `ADMIN_SENHA`, cadastre um usuário de teste e envie uma nota.
- No celular: abra o endereço e use "Adicionar à tela inicial".

## 4. E-mail (opcional)
Sem SMTP, o app mostra o link de definição de senha na tela do administrador, o que basta para teste. Para enviar e-mail, adicione no painel `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` (Office 365: `smtp.office365.com`, 587, `false`).

## Limitações do plano gratuito
- O serviço dorme após alguns minutos sem acesso; o primeiro acesso depois demora (cerca de 1 minuto).
- Dados perdidos a cada reinício (ver acima).
- Não há terminal; por isso o administrador sai das variáveis de ambiente.

## Cuidados
- Não envie notas fiscais reais nem crie usuários reais no teste.
- O endereço é público: use senhas fortes e defina limite de gasto na conta da Anthropic (o app também limita 50 leituras por usuário por dia).
- Nunca coloque chaves no repositório; elas ficam só no painel do Render.

## Para manter os dados (plano pago)
No `render.yaml`, troque `plan: free` por `plan: starter` e descomente o bloco `disk` (montado em `/data`, onde fica o banco). Reaplique o Blueprint. Faça backup periódico com `npm run backup` ou copiando `gastos.db`.
