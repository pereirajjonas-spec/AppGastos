# Despesas de Viagem — Grupo MSA

> Referência completa (uso, administração, arquitetura, API, operação): [DOCUMENTACAO.md](DOCUMENTACAO.md)

Aplicativo para registrar as despesas de viagens corporativas a partir das notas fiscais.

- **No celular** (PWA, instalável pelo navegador): o colaborador fotografa a NFC-e ou envia o PDF da NF-e.
  O app lê o QR Code (chave de acesso) e usa IA (**Kimi K3** ou **Claude**) para ler o restante e **separar o gasto em categorias**:
  café da manhã, almoço, jantar, combustível (com litros), estacionamento, hospedagem e outros.
- **No navegador**: lista de viagens e de todos os lançamentos (com filtros), visualizar/imprimir/baixar a nota
  original e o **relatório de viagem** (resumo por categoria, quadro diário, detalhamento, acerto com adiantamento,
  campos de assinatura e comprovantes em anexo), com **Imprimir** e **Baixar PDF**. O detalhamento sempre começa em página nova.
  O campo **Comprovantes por página** (1, 2 ou 4) agrupa os comprovantes: 2 ficam lado a lado e 4 em grade 2×2; padrão é 1.
  Todos os comprovantes entram no relatório, em qualquer formato enviado: foto (imagem), PDF (cada página vira imagem; até 6 páginas por nota)
  e XML (documento legível gerado a partir do XML, "DANFE simplificado" — não é o DANFE oficial do emissor).
- **Acesso** só para usuários cadastrados pelo administrador. Login = e-mail da empresa. Convite e
  "Esqueci minha senha" por e-mail (link de uso único: 1 h para redefinição, 72 h para convite).

## Como funciona a leitura da nota

O app aceita **XML**, **PDF** e **foto** da NF-e (modelo 55) e da NFC-e (modelo 65). Do mais ao menos preciso:

| Formato | Como lê | Precisão |
|---|---|---|
| **XML** (nfeProc ou NFe) | Lê os campos direto do documento (emitente, data/hora, itens, total, pagamento, chave). A IA só **classifica os itens** em categorias. Confere se a nota foi autorizada (cStat 100). | Exata |
| **PDF** do DANFE | Extrai o **texto do PDF** localmente: a chave de acesso vem dele (sem IA) e a IA lê o **texto** (não o PDF inteiro), o que reduz o custo. PDF escaneado (sem texto) é enviado inteiro à IA. | Alta |
| **Foto** | QR Code (chave) + IA. | Boa (depende da foto) |

Peça o XML sempre que possível: fornecedores e hotéis costumam mandá-lo junto com o PDF.

1. **Chave de acesso** (QR Code na foto; texto do PDF no DANFE): a chave de acesso de 44 dígitos fornece número, série, CNPJ, UF e mês de emissão sem erro de OCR.
2. **IA** (foto ou PDF): estabelecimento, data/hora, valor, forma de pagamento e os **lançamentos por categoria**.
   Refeição é classificada pelo horário (café até ~10h30, almoço até ~15h30, jantar à noite).
   Uma nota de posto com diesel + água vira 2 lançamentos (combustível + outros).
3. **Conferências automáticas** (aparecem como alerta na nota): soma dos lançamentos ≠ total, chave inválida,
   data fora do período da viagem, data diferente da competência da chave, leitura com baixa confiança.
4. **Antiduplicidade**: a mesma chave de acesso ou o mesmo arquivo não entram duas vezes (nem por pessoas diferentes).

O colaborador pode corrigir categoria, descrição e valor de cada lançamento, separar um item em outro lançamento
e editar os dados da nota. Ao **fechar a viagem**, ela fica travada; só o administrador reabre.

## Instalação (desenvolvimento)

```bat
cd "D:\OneDrive - Grupo MSA\Claude\Code\AppGastos"
npm install
copy .env.example .env
notepad .env          REM JWT_SECRET, ANTHROPIC_API_KEY, SMTP_*, APP_URL
npm run criar-admin -- jonas.pereira@grupomsa.com.br "Jonas Pereira"
npm start             REM http://localhost:3100
```

Testar a leitura de uma nota sem o app: `npm run testar-nota -- "C:\caminho\nota.jpg"`

## Produção (Windows + NSSM, mesmo padrão do Portal IA)

1. Copie a pasta (sem `node_modules`, `data`, `.env`) para o servidor, ex.: `D:\claude-project\app-gastos`.
2. No servidor: `npm install`, crie o `.env` (gere um `JWT_SECRET` novo) e rode `npm run criar-admin`.
3. Serviço:
   ```powershell
   cd C:\nssm\win64
   .\nssm.exe install DespesasViagem "C:\Program Files\nodejs\node.exe" "D:\claude-project\app-gastos\server.js"
   .\nssm.exe set DespesasViagem AppDirectory D:\claude-project\app-gastos
   .\nssm.exe set DespesasViagem AppStdout D:\claude-project\app-gastos\logs\out.log
   .\nssm.exe set DespesasViagem AppStderr D:\claude-project\app-gastos\logs\erro.log
   .\nssm.exe start DespesasViagem
   ```
4. **HTTPS é obrigatório para usar no celular** (instalar o PWA e abrir a câmera exigem HTTPS fora do localhost).
   Publique atrás do IIS (ARR/URL Rewrite) ou outro proxy com certificado, e no `.env` use
   `APP_URL=https://...`, `COOKIE_SECURE=true` e `TRUST_PROXY=true`.
   Para uso fora da rede da empresa, o endereço precisa ser acessível pela internet (ou via VPN).
5. **Backup**: tudo fica em um único arquivo, `data\gastos.db` (dados **e** fotos/PDFs das notas). Use `npm run backup` (copia com o app rodando, sem corromper) em uma tarefa agendada diária, apontando para outra unidade: `npm run backup -- "E:\backup-msa"`. Não copie o `.db` solto enquanto o app roda.

### E-mail (Office 365)

`SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, usuário/senha de uma caixa com
**SMTP AUTH habilitado** (Admin do Microsoft 365 → usuário → E-mail → Gerenciar aplicativos de e-mail).
Sem SMTP configurado o app continua funcionando: ao cadastrar um usuário ou pedir link de senha,
o administrador vê o link na tela para repassar.

### Provedores de IA

| | Kimi K3 (Moonshot) | Claude (Anthropic) |
|---|---|---|
| Chave no .env | `MOONSHOT_API_KEY` (`KIMI_MODEL=kimi-k3`) | `ANTHROPIC_API_KEY` (`ANTHROPIC_MODEL`) |
| Foto | lê a imagem direto (~25–50 s) | lê a imagem direto (~20–25 s) |
| PDF com texto | lê o texto extraído pelo app | lê o texto extraído pelo app |
| PDF escaneado | extração de arquivos da Moonshot (faz OCR; testado e funcionou, ~50 s) | lê o PDF nativamente (~8 s) |
| Formato da resposta | JSON mode + validação no app | structured outputs (formato garantido) |

- Provedor principal: `IA_PROVEDOR` no .env ou, pelo administrador, em **Usuários → Leitura das notas (IA)**.
- Se o principal falhar e o outro tiver chave, o app usa o outro e avisa na nota.
- **Ler novamente** (em cada nota) relê com o provedor escolhido — use para comparar os dois em notas reais.

## Estrutura

```
server.js              rotas da API + estáticos
src/db.js              SQLite (usuarios, tokens_senha, viagens, notas, arquivos [fotos/PDFs], lancamentos)
src/auth.js            sessão (cookie httpOnly + JWT), senhas bcrypt, tokens de redefinição
src/email.js           e-mails de convite e redefinição (nodemailer)
src/extrair/           QR Code, chave de acesso, leitor de XML e leitura/classificação por IA (Kimi ou Claude)
public/                PWA: login, redefinir senha, app, relatório
scripts/               criar-admin, testar-nota
```

## Perfis

| Perfil | Pode |
|---|---|
| Usuário | Criar viagens, enviar notas, corrigir os próprios lançamentos, gerar o relatório, fechar a viagem |
| Administrador | Tudo acima para todas as viagens + cadastrar/desativar usuários, reabrir viagens fechadas |
