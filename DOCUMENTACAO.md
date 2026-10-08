# Despesas de Viagem — Documentação

Aplicativo do Grupo MSA para registrar as despesas de viagens corporativas a partir das notas fiscais,
classificar os gastos e gerar o relatório de viagem.

> **Versão da documentação:** outubro de 2026 · **Estado do projeto:** validado em ambiente de desenvolvimento;
> ainda **não publicado em produção**. O `README.md` é o guia rápido de instalação; este documento é a referência completa.

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Perfis e regras de acesso](#2-perfis-e-regras-de-acesso)
3. [Guia do usuário](#3-guia-do-usuário)
4. [Guia do administrador](#4-guia-do-administrador)
5. [Categorias de despesa](#5-categorias-de-despesa)
6. [Como as notas são lidas](#6-como-as-notas-são-lidas)
7. [O relatório de viagem](#7-o-relatório-de-viagem)
8. [Arquitetura técnica](#8-arquitetura-técnica)
9. [Banco de dados](#9-banco-de-dados)
10. [API](#10-api)
11. [Segurança](#11-segurança)
12. [Configuração (.env)](#12-configuração-env)
13. [Instalação e operação](#13-instalação-e-operação)
14. [Limitações conhecidas e pendências](#14-limitações-conhecidas-e-pendências)
15. [Solução de problemas](#15-solução-de-problemas)

---

## 1. Visão geral

**Problema que resolve:** o colaborador fotografa (ou envia o PDF/XML de) cada nota fiscal da viagem; o app lê os
dados, separa o gasto por categoria e, no fim, gera o relatório de viagem pronto para imprimir ou baixar em PDF,
com o comprovante de cada nota em anexo.

**Componentes:**

| Parte | Descrição |
|---|---|
| Aplicativo web (PWA) | Telas de login, viagens, lançamentos, administração e relatório. Instalável no celular pelo navegador. |
| Servidor | Node.js + Express. Autenticação, regras de negócio, leitura das notas, API. |
| Banco de dados | SQLite, em um único arquivo (`data/gastos.db`). Guarda **tudo**, inclusive as fotos/PDFs/XMLs das notas. |
| Leitura de notas | Chave de acesso (QR Code ou texto do PDF) + leitor de XML + IA (Kimi K3 ou Claude). |
| E-mail | Convites e redefinição de senha via SMTP (Office 365). |

**Formatos de nota aceitos:** foto (JPG/PNG), PDF e XML, de NF-e (modelo 55) e NFC-e (modelo 65), além de cupons
fiscais e recibos simples (leitura por IA). Limite de 15 MB por arquivo; fotos em JPG, PNG, WebP ou GIF (SVG, TIFF e outros formatos são recusados) e até 80 megapixels.

---

## 2. Perfis e regras de acesso

O acesso é **somente para usuários cadastrados pelo administrador**. O login é o **e-mail da empresa**
(domínios aceitos definidos em `EMAIL_DOMINIOS`).

| Ação | Usuário | Administrador |
|---|:---:|:---:|
| Ver e alterar as **próprias** viagens, notas e lançamentos | ✅ | ✅ |
| Ver viagens de **outros** colaboradores | ❌ | ✅ |
| Cadastrar, editar, desativar usuários e reenviar link de senha | ❌ | ✅ |
| Escolher o provedor de IA (Kimi/Claude) | ❌ | ✅ |
| Fechar uma viagem | ✅ (as próprias) | ✅ |
| **Reabrir** uma viagem fechada | ❌ | ✅ |
| Alterar lançamentos de viagem **fechada** | ❌ | ✅ |

Regras adicionais:

- Um usuário **desativado** perde o acesso imediatamente, mesmo com sessão aberta.
- O administrador não pode desativar a si mesmo nem retirar o próprio perfil de administrador.
- Viagem fechada fica travada: não aceita novas notas, edição ou exclusão por usuário comum.
- O banco diferencia o dono da viagem do administrador que a abre: as notas ficam sempre no nome do dono.

---

## 3. Guia do usuário

### 3.1 Entrar e recuperar a senha

1. Acesse o endereço do app e entre com o **e-mail da empresa** e a senha.
2. A sessão dura 30 dias (configurável) no mesmo navegador.
3. **Esqueci minha senha:** informe o e-mail; chega uma mensagem com um link de uso único, válido por **1 hora**.
   A resposta na tela é sempre a mesma, exista ou não o e-mail, para não revelar quem tem cadastro.
4. **Primeiro acesso:** o administrador cadastra o usuário e o app envia um convite por e-mail com link para definir
   a senha (válido por **72 horas**).
5. A senha deve ter no mínimo 8 caracteres, com letras e números. Pode ser trocada em **Minha conta**.

Bloqueio contra tentativas: 10 logins errados por 15 minutos e 5 pedidos de redefinição por 15 minutos.

### 3.2 Criar uma viagem

**Viagens → Nova viagem.**

| Campo | Observação |
|---|---|
| Título (obrigatório) | Ex.: "Visita a clientes — Curitiba" |
| **Destino (Cidade/UF)** | Ao digitar, aparecem as cidades da lista oficial do IBGE (5.571 municípios). Escolha uma opção para evitar erro de digitação. Texto livre também é aceito (ex.: destino no exterior), com um aviso. Grava como `Cidade/UF`. |
| Início e fim | A data final não pode ser anterior à inicial. Notas fora do período geram alerta. |
| **Conta/Centro de Custo** | Vem preenchido com o do cadastro do usuário; pode ser alterado por viagem. |
| Adiantamento recebido | Usado no acerto do relatório. |
| Motivo | Texto livre. |

### 3.3 Lançar notas

Na tela da viagem:

- **Fotografar nota** (celular): abre a câmera.
- **Enviar foto, PDF ou XML:** escolhe arquivos (vários de uma vez). No computador também dá para arrastar para a área tracejada.

O app lê a nota (de 5 a 50 segundos, conforme o formato e o provedor) e mostra um cartão com estabelecimento, data, valor,
forma de pagamento e os **lançamentos por categoria**. Cada lançamento pode ser corrigido na hora:

- trocar a **categoria**, a **descrição** e o **valor** (salva ao sair do campo);
- **+ Lançamento** para separar um item que a IA juntou (lembre de reduzir o valor do lançamento original);
- **Dados da nota** para corrigir estabelecimento, data e forma de pagamento;
- **Ver nota** abre o comprovante original (imagem, PDF ou visualização do XML), com Imprimir e Baixar;
- **Ler novamente** relê o arquivo com o provedor de IA escolhido. **Substitui os lançamentos da nota e apaga correções manuais feitas nela**;
- **Excluir** remove a nota, os lançamentos e o arquivo.

**Avisos (⚠) que o app mostra na nota:** soma dos lançamentos diferente do total; chave de acesso inválida; data fora do
período da viagem; data diferente da competência da chave; leitura com baixa confiança; nota não autorizada na SEFAZ (XML);
IA principal indisponível (usou a alternativa). Eles pedem conferência; não impedem o lançamento.

**Duplicidade:** o app recusa a mesma nota enviada duas vezes, pela chave de acesso (inclusive se uma pessoa enviou o XML e
outra o PDF) ou pelo mesmo arquivo.

### 3.4 Conferir lançamentos

**Lançamentos** lista todos os gastos, com filtros por viagem, categoria e período (e por colaborador, para o administrador).
Clicar em "Nota" abre o comprovante.

### 3.5 Fechar a viagem e gerar o relatório

1. Confira os lançamentos e avisos.
2. **Relatório** abre o relatório em uma nova aba (ver [seção 7](#7-o-relatório-de-viagem)): **Imprimir** ou **Baixar PDF**.
3. **Fechar viagem** trava as alterações. Só o administrador reabre.

### 3.6 Instalar no celular

- **Android (Chrome):** menu ⋮ → Instalar aplicativo.
- **iPhone (Safari):** Compartilhar → Adicionar à Tela de Início.

A câmera e a instalação exigem que o app esteja em **HTTPS** (ver [seção 13](#13-instalação-e-operação)).

---

## 4. Guia do administrador

### 4.1 Usuários

**Usuários → Novo usuário:** informe nome, e-mail da empresa, Conta/Centro de Custo e perfil. O usuário recebe o convite por e-mail.
Se o envio de e-mail não estiver configurado ou falhar, o app **mostra o link na tela** para você repassar.

Na lista: **Editar** (nome, centro de custo, perfil, ativar/desativar) e **Enviar link de senha** (gera novo link, 72 h).
Situações: *ativo*, *aguardando senha* (ainda não definiu), *inativo*.

### 4.2 Provedor de IA

**Usuários → Leitura das notas (IA):** escolha entre **Claude (Anthropic)** e **Kimi (Moonshot)** para as notas novas.
Só aparece habilitado o provedor que tem chave no `.env`. A escolha vale na hora, sem reiniciar, e tem prioridade sobre `IA_PROVEDOR`.
Se o principal falhar, o app tenta o outro automaticamente (quando houver chave) e avisa na nota.

### 4.3 Viagens de outros colaboradores

O administrador vê todas as viagens (filtro por colaborador na tela inicial), pode corrigir lançamentos, gerar relatórios e
**reabrir** viagens fechadas.

### 4.4 Primeiro administrador

```bat
npm run criar-admin -- jonas.pereira@grupomsa.com.br "Jonas Pereira"
```

O terminal pede a senha (não fica no histórico). Se o e-mail já existir, o usuário é promovido a administrador.

---

## 5. Categorias de despesa

| Categoria | Quando se aplica |
|---|---|
| Café da manhã | Alimentação até ~10h30 |
| Almoço | Alimentação entre ~10h30 e ~15h30 |
| Jantar | Alimentação a partir de ~17h |
| Combustível | Gasolina, etanol, diesel, GNV, ARLA 32 (guarda os litros) |
| Estacionamento | Estacionamento, valet, zona azul |
| Hospedagem | Diárias de hotel, pousada, hostel, taxa de turismo/ISS da hospedagem |
| Uber/Táxi | Corridas de aplicativo (Uber, 99, Cabify, inDrive) e táxi |
| Outros | Todo o resto (conveniência, pedágio, lavagem, farmácia, material…) |

Regras usadas pela IA: refeição inclui o restaurante do hotel; café da manhã incluso na diária fica na hospedagem; itens avulsos comprados
em posto/conveniência (água, café, salgado) vão em **Outros**; itens da mesma categoria são agrupados em um lançamento; a soma dos lançamentos
deve bater com o total da nota (descontos e acréscimos são rateados).

As categorias ficam em `src/extrair/ia.js` (regras e lista), `server.js` (lista permitida), `src/db.js` (restrição do banco, com migração automática)
e `public/js/comum.js` (nome e cor na tela).

---

## 6. Como as notas são lidas

### 6.1 Por formato (do mais ao menos preciso)

| Formato | Como lê | Precisão |
|---|---|---|
| **XML** da NF-e/NFC-e | Campos lidos direto do XML (emitente, CNPJ, número, série, data/hora, itens, total, pagamento, chave). **Confere o protocolo de autorização** (cStat 100). A IA só classifica os itens. | Exata |
| **PDF** do DANFE | O texto do PDF é extraído **localmente**; a chave de acesso vem dele (sem IA) e a IA lê o **texto** (não o PDF inteiro). PDF escaneado (sem texto) é enviado inteiro à IA. | Alta |
| **Foto** | QR Code (chave de acesso) + IA lendo a imagem. | Boa; depende da qualidade da foto |

Peça o **XML** sempre que possível: fornecedores e hotéis costumam mandá-lo junto com o PDF. É o caminho mais preciso e o mais barato.

### 6.2 Pipeline

1. **Chave de acesso (44 dígitos):** do QR Code (foto) ou do texto do PDF. O dígito verificador é validado. Da chave saem número, série, CNPJ, UF, modelo (55/65)
   e mês/ano de emissão, **sem risco de erro de leitura**. Quando a chave existe, ela prevalece sobre a IA.
2. **IA:** lê estabelecimento, cidade, data/hora, valor total, forma de pagamento e já devolve os **lançamentos por categoria**.
3. **Conferências automáticas** (viram avisos na nota): soma × total, chave válida, competência da chave × data, período da viagem, confiança da leitura.
4. **Antiduplicidade** pela chave de acesso e pelo hash do arquivo.
5. **Gravação:** a nota, os lançamentos e o arquivo original vão ao banco na mesma transação.

### 6.3 Provedores de IA

| | Kimi K3 (Moonshot) | Claude (Anthropic) |
|---|---|---|
| Chave | `MOONSHOT_API_KEY`, modelo `KIMI_MODEL` | `ANTHROPIC_API_KEY`, modelo `ANTHROPIC_MODEL` |
| Foto | lê a imagem direto | lê a imagem direto |
| PDF com texto | lê o texto extraído pelo app | lê o texto extraído pelo app |
| PDF escaneado | extração de arquivos da Moonshot (faz OCR) | lê o PDF nativamente |
| Formato da resposta | JSON mode + validação no app | *structured outputs* (formato garantido) |
| Tempo (testes) | 25 a 50 s | 4 a 25 s |

**Terceiro provedor, em avaliação — DeepSeek Flash** (`DEEPSEEK_API_KEY`, modelo `deepseek-flash`, API compatível com a da OpenAI em `api.deepseek.com`).
Lê foto (imagem), PDF com texto (texto extraído pelo app) e PDF escaneado (o app renderiza as páginas como imagem). Por ser experimental, **não entra como alternativa automática**:
só é usado quando escolhido na tela de Usuários ou em "Ler novamente".

Medições feitas com notas de teste geradas para o projeto; **confirme com notas reais** antes de decidir o provedor principal.
Em testes, o Claude Sonnet 5.5 leu uma nota de PDF com ~37% menos tokens de entrada usando o texto extraído em vez do PDF inteiro.

Para comparar os dois em uma nota: **Ler novamente** (escolhe o provedor). Pelo terminal:

```bat
npm run testar-nota -- "C:\caminho\nota.pdf" --comparar
npm run testar-nota -- "C:\caminho\nota.jpg" --provedor=kimi
```

### 6.4 Quando a IA não está disponível

- XML: a nota entra com todos os dados exatos e um único lançamento "Outros", com aviso para revisar a categoria.
- Foto/PDF: a leitura falha com mensagem; tente outra foto ou **Ler novamente** com o outro provedor.

---

## 7. O relatório de viagem

Aberto em `Viagem → Relatório`. Estrutura, na ordem:

1. **Cabeçalho** com logo e data/hora de emissão.
2. **Dados da viagem:** colaborador, e-mail, viagem, destino, Conta/Centro de Custo, período, quantidade de notas e lançamentos, motivo.
3. **Resumo por categoria** (quantidade e valor) e **Acerto** (total das despesas × adiantamento → "a reembolsar" ou "a devolver").
4. **Despesas por dia:** uma linha por lançamento, com **Data, Nº doc, Tipo doc (55 ou 65), Tipo de despesa e Valor**. O modelo vem da chave de acesso;
   para recibos e documentos sem modelo aparece o tipo escrito.
5. **Assinaturas** (colaborador, gestor imediato, financeiro) e, logo abaixo, **cidade e data de geração** ("Francisco Beltrão - PR, <data>").
6. **Detalhamento dos lançamentos** (estabelecimento, CNPJ, documento, categoria, descrição, valor). **Começa sempre em uma nova página.**
7. **Comprovantes** (uma página por nota, ou agrupados).

**Opções na barra do relatório:**

| Opção | Efeito |
|---|---|
| Incluir detalhamento | Mostra/oculta o item 6 |
| Incluir fotos das notas | Mostra/oculta os comprovantes |
| **Comprovantes por página** (1, 2 ou 4) | 1 = um por folha; 2 = dois lado a lado; 4 = grade 2×2. Padrão 1; a escolha fica lembrada no navegador. Com 4, o texto de PDFs de DANFE e de XML fica pequeno. |
| Imprimir / Baixar PDF | Impressão do navegador / PDF gerado no navegador |

**Comprovantes em qualquer formato:** foto aparece como imagem; PDF aparece como imagem de cada página (até 6 páginas por nota);
XML aparece como uma **visualização legível gerada a partir do XML** (não é o DANFE oficial do emissor, e o relatório informa isso).

O relatório é montado na hora a partir do banco; mudanças de layout valem para **todas** as viagens, antigas ou novas.
A data e a cidade do rodapé de assinatura são as de geração; a data vem do relógio do computador de quem gera.

---

## 8. Arquitetura técnica

```
Navegador (PWA)  ──HTTPS──▶  Express (server.js)  ──▶  SQLite (data/gastos.db)
  public/*                      │    └─ cookies httpOnly + JWT
                                ├─▶ src/extrair  ──▶ IA: Kimi (Moonshot) / Claude (Anthropic)
                                └─▶ src/email    ──▶ SMTP (Office 365)
```

**Stack:** Node.js ≥ 18 (a imagem Docker usa Node 22), Express 4, better-sqlite3, sharp, pdf-parse, fast-xml-parser, jsQR/qrcode-reader,
nodemailer, bcryptjs, jsonwebtoken, helmet, express-rate-limit, multer, SDKs `@anthropic-ai/sdk` e `openai` (este para a API compatível da Moonshot).
Front-end em HTML/CSS/JS puro (sem framework); o PDF do relatório é gerado com html2pdf.js.

**Estrutura de pastas:**

| Caminho | Conteúdo |
|---|---|
| `server.js` | Rotas da API, regras de negócio, arquivos estáticos |
| `src/db.js` | Esquema do banco e migrações automáticas |
| `src/auth.js` | Sessão, senhas, tokens de redefinição |
| `src/email.js` | E-mails de convite e redefinição |
| `src/extrair/index.js` | Orquestra a leitura: chave → XML/PDF/foto → IA → conferências |
| `src/extrair/chave.js` | Chave de acesso: decodificação, dígito verificador, busca em texto |
| `src/extrair/qrcode.js` | Leitura do QR Code com várias versões da imagem (escala, rotação, binarização) |
| `src/extrair/xml.js` | Leitor do XML da NF-e/NFC-e |
| `src/extrair/ia.js` | Prompts, schema e chamadas aos provedores; escolha e alternativa de provedor |
| `public/` | Telas: `index.html` (login), `app.html` (app), `relatorio.html`, `redefinir.html`; `js/`, `css/`, `img/`, `data/municipios.json`, `sw.js`, `manifest.webmanifest` |
| `scripts/` | `criar-admin.js`, `backup.js`, `testar-nota.js` |
| `Dockerfile`, `.dockerignore` | Empacotamento (não testado — ver limitações) |

**Decisões de projeto relevantes:**

- **Tudo no banco:** fotos, PDFs e XMLs ficam numa tabela à parte (`arquivos`) para as listagens não carregarem os arquivos. Um único arquivo de backup guarda tudo.
- **Foto é reduzida** para no máximo 2000 px (JPEG) ao ser guardada; PDF e XML ficam como vieram.
- **XML nunca é servido como XML** para visualização no mesmo domínio (vai como texto puro), para evitar que um arquivo malicioso execute código.
- **Migrações automáticas:** ao subir, `src/db.js` cria tabelas novas, acrescenta colunas e recria a tabela de lançamentos quando uma categoria nova é adicionada, preservando os dados.
- **Nome interno do campo** "Conta/Centro de Custo" continua `centro_custo` no banco e na API.
- **Rotas por hash** no front (`#/viagem/12`), sem servidor de rotas.
- **PWA:** `sw.js` guarda a "casca" do app e usa a rede primeiro; a API nunca é cacheada.

---

## 9. Banco de dados

SQLite em `data/gastos.db` (ou `DB_PATH`). Modo WAL, chaves estrangeiras ligadas.

| Tabela | Finalidade | Campos principais |
|---|---|---|
| `usuarios` | Cadastro de acesso | `email` (único), `nome`, `senha_hash` (bcrypt), `perfil` (`admin`/`usuario`), `centro_custo`, `ativo`, `ultimo_login` |
| `tokens_senha` | Links de convite/redefinição | `token_hash` (SHA-256; o token em si nunca é gravado), `usuario_id`, `expira_em`, `usado` |
| `viagens` | Viagens | `usuario_id`, `titulo`, `destino`, `motivo`, `centro_custo`, `data_inicio`, `data_fim`, `adiantamento`, `status` (`aberta`/`fechada`) |
| `notas` | Uma por documento fiscal | dados da nota (tipo, número, série, `chave`, data/hora, CNPJ, estabelecimento, cidade, UF, `valor_total`, forma de pagamento), `mimetype`, `hash_arquivo`, `confianca`, `origem`, `alertas` (JSON), `modelo_ia`, `provedor_ia` |
| `arquivos` | Arquivo original da nota | `nota_id` (chave), `dados` (BLOB) |
| `lancamentos` | Gastos por categoria | `nota_id`, `viagem_id`, `data`, `categoria`, `descricao`, `valor`, `litros` |
| `config` | Configurações salvas pelo admin | `chave`/`valor` (hoje: `ia_provedor`) |

Relações: excluir uma viagem remove suas notas, arquivos e lançamentos (cascata); excluir uma nota remove seu arquivo e lançamentos.

**Tamanho esperado:** em média 50 a 150 KB por nota (fotos de 20 a 130 KB). Para 3 mil notas, algo entre 150 e 500 MB. O SQLite suporta isso sem ajuste.

---

## 10. API

Todas as rotas `/api/*` (exceto autenticação) exigem sessão. Respostas e erros em JSON (`{ "erro": "mensagem" }`).

**Autenticação**

| Método e rota | Função |
|---|---|
| `POST /api/auth/login` | Entra (e-mail, senha) |
| `POST /api/auth/logout` | Sai |
| `GET /api/auth/eu` | Dados do usuário logado |
| `POST /api/auth/esqueci` | Pede link de redefinição (resposta sempre igual) |
| `GET /api/auth/token?token=…` | Valida o link |
| `POST /api/auth/redefinir` | Define nova senha com o link |
| `POST /api/auth/alterar-senha` | Troca a senha (logado) |

**Administração** (somente administrador)

| Método e rota | Função |
|---|---|
| `GET /api/admin/usuarios` | Lista usuários |
| `POST /api/admin/usuarios` | Cadastra e envia o convite |
| `PATCH /api/admin/usuarios/:id` | Edita, ativa ou desativa |
| `POST /api/admin/usuarios/:id/enviar-senha` | Gera novo link de senha |
| `GET /api/admin/ia` · `PUT /api/admin/ia` | Lê / define o provedor de IA |

**Viagens, notas e lançamentos**

| Método e rota | Função |
|---|---|
| `GET /api/ia` | Provedores de IA e quais têm chave |
| `GET /api/viagens` | Lista (admin: filtros `usuario`, `status`) |
| `POST /api/viagens` · `GET/PATCH/DELETE /api/viagens/:id` | Cria / lê (com notas e lançamentos) / altera ou muda status / exclui |
| `POST /api/viagens/:id/notas` | Envia uma nota (`multipart`, campo `arquivo`) e já lê |
| `GET /api/notas/:id/arquivo` | Arquivo original (`?download=1` baixa) |
| `POST /api/notas/:id/reler` | Lê de novo (`{ "provedor": "kimi" \| "anthropic" }`) |
| `GET /api/notas/:id/paginas` · `GET /api/notas/:id/pagina/:n` | Nº de páginas de um PDF / página como imagem JPEG |
| `PATCH /api/notas/:id` · `DELETE /api/notas/:id` | Corrige dados da nota / exclui |
| `GET /api/lancamentos` | Lista com filtros `viagem`, `categoria`, `de`, `ate`, `usuario` (admin) |
| `POST /api/notas/:id/lancamentos` | Novo lançamento numa nota |
| `PATCH` · `DELETE /api/lancamentos/:id` | Altera / remove |

**Outras:** `GET /health` → `{ "ok": true }` (verificação de saúde, sem login).

Limite de envio: 120 notas por hora por usuário e **50 leituras por IA por dia** (janela de 24 h, configurável em `LIMITE_LEITURAS_DIA`; 0 desliga; o administrador não tem teto). Conta cada novo envio e cada "Ler novamente"; arquivos recusados por formato ou por duplicidade não consomem o teto.

---

## 11. Segurança

Auditoria de outubro de 2026 (revisão do código + 68 testes automatizados contra uma cópia do app). Resumo do que o app faz:

- **Senhas:** bcrypt; mínimo de 8 caracteres com letras e números. A conferência gasta o mesmo tempo para e-mail existente ou não (não dá para descobrir quem tem cadastro pelo tempo de resposta).
- **Sessão:** cookie `httpOnly`, `SameSite=Lax`, `Secure` quando `COOKIE_SECURE=true`; JWT assinado com `JWT_SECRET` (mín. 32 caracteres; o app **não sobe** sem ele). **Trocar ou redefinir a senha encerra as outras sessões abertas** (a de quem trocou continua).
- **Limites de tentativa:** login (10 por 15 min por IP), redefinição de senha (5 por 15 min), **alterar senha (5 erros por 15 min por usuário)**, envio/leitura de notas (120 por hora e 50 por dia por usuário) e páginas de PDF (600 por hora por usuário).
- **Tokens de senha:** uso único, expiram, e só o hash fica no banco.
- **Controle de acesso:** cada rota confere o dono da viagem/nota; administrador é exceção. Usuário desativado perde a sessão na hora. Testado: um usuário comum não lê, altera, exclui nem fecha dados de outro, e não se promove a administrador.
- **Cabeçalhos:** `helmet` com política de conteúdo (CSP) restritiva: scripts, estilos e fontes **só do próprio app** (o gerador de PDF e as fontes ficam em `public/vendor` e `public/fonts`; nada vem de CDN ou do Google).
- **Arquivos enviados:** só formatos de foto de nota; o **conteúdo real** é conferido (um texto disfarçado de JPG ou PDF é recusado); imagens acima de 80 megapixels são recusadas (proteção contra "imagem bomba"); XML nunca é servido como XML renderizável (vai como texto puro) e a visualização é montada com `textContent`.
- **Chaves de API e SMTP** ficam só no `.env` (fora do repositório e fora da imagem Docker). Nunca vão ao navegador.
- **Dependências:** `npm audit --omit=dev` sem vulnerabilidades (sharp 0.35 e nodemailer 10). Rode `npm audit` de tempos em tempos.
- **Docker:** o app roda como usuário comum (`node`), não como administrador do sistema (build ainda não testado).
- **Privacidade das notas:** o conteúdo da nota (foto, texto do PDF ou itens do XML) é enviado ao provedor de IA escolhido (Moonshot, Anthropic ou DeepSeek) para leitura. Verifique nos termos de cada provedor onde os dados são processados e se são retidos, e avalie com a área de segurança/jurídico (LGPD) qual provedor a empresa aceita.
- **Antes de produção:**
  1. Apague `data/credenciais-teste.txt` e desative os usuários de teste (`admin.teste@…`, `maria.souza@…`).
  2. Gere um `JWT_SECRET` novo e use **chaves de API próprias deste app**.
  3. **Não mantenha o `.env` nem o banco em pasta sincronizada pelo OneDrive** (copiam chaves e dados de funcionários para a nuvem); em produção use pasta do servidor com permissão restrita e `DB_PATH` fora do OneDrive.
  4. `COOKIE_SECURE=true` e `TRUST_PROXY=true` atrás de HTTPS.
  5. O banco não é criptografado em disco: proteja o servidor e os backups (LGPD).

---

## 12. Configuração (.env)

Copie `.env.example` para `.env`. Reinicie o serviço depois de alterar.

| Variável | Para que serve | Padrão / exemplo |
|---|---|---|
| `PORT` | Porta do servidor | `3100` |
| `APP_URL` | Endereço público (vai nos links de e-mail), sem barra no final | `http://localhost:3100` |
| `JWT_SECRET` | Segredo da sessão, ≥ 32 caracteres aleatórios (obrigatório) | gere com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `SESSAO_DIAS` | Duração da sessão | `30` |
| `COOKIE_SECURE` | `true` quando em HTTPS | `false` |
| `TRUST_PROXY` | `true` atrás de proxy reverso (IIS/nginx) | vazio |
| `EMAIL_DOMINIOS` | Domínios aceitos no cadastro (vírgula); vazio = qualquer | `grupomsa.com.br` |
| `IA_PROVEDOR` | Provedor principal inicial: `anthropic` ou `kimi` (o admin pode trocar na tela) | `anthropic` |
| `ANTHROPIC_API_KEY` · `ANTHROPIC_MODEL` | Claude | modelo padrão `claude-opus-5-5`; em uso nos testes: `claude-sonnet-5-5` |
| `MOONSHOT_API_KEY` · `KIMI_MODEL` · `MOONSHOT_BASE_URL` | Kimi | modelo `kimi-k3`; URL `https://api.moonshot.ai/v1` |
| `DEEPSEEK_API_KEY` · `DEEPSEEK_MODEL` · `DEEPSEEK_BASE_URL` | DeepSeek (em avaliação) | modelo `deepseek-flash`; URL `https://api.deepseek.com` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | E-mail. Office 365: `smtp.office365.com`, `587`, `SMTP_SECURE=false`; a conta precisa de **SMTP AUTH** habilitado e o remetente deve ser o mesmo endereço da conta | — |
| `DB_PATH` | Local do banco (opcional) | `data/gastos.db` |

Sem SMTP o app funciona: os links de senha aparecem na tela do administrador.

---

## 13. Instalação e operação

### 13.1 Desenvolvimento

```bat
cd "D:\OneDrive - Grupo MSA\Claude\Code\AppGastos"
npm install
copy .env.example .env
notepad .env
npm run criar-admin -- jonas.pereira@grupomsa.com.br "Jonas Pereira"
npm start          REM http://localhost:3100
```

Ao subir, o terminal mostra os provedores de IA configurados (`IA: Claude [modelo] ok · Kimi [modelo] ok — principal: …`) e avisa se faltar administrador ou chave.
Para recomeçar do zero em desenvolvimento, pare o servidor e apague a pasta `data\`.

### 13.2 Produção (Windows + NSSM, mesmo padrão do Portal IA)

1. Copie a pasta (sem `node_modules`, `data`, `.env`) para o servidor, ex.: `D:\claude-project\app-gastos`.
2. No servidor: `npm install`, crie o `.env` (com `JWT_SECRET` novo) e rode `npm run criar-admin`.
3. Crie o serviço:

```powershell
cd C:\nssm\win64
.\nssm.exe install DespesasViagem "C:\Program Files\nodejs\node.exe" "D:\claude-project\app-gastos\server.js"
.\nssm.exe set DespesasViagem AppDirectory D:\claude-project\app-gastos
.\nssm.exe set DespesasViagem AppStdout D:\claude-project\app-gastos\logs\out.log
.\nssm.exe set DespesasViagem AppStderr D:\claude-project\app-gastos\logs\erro.log
.\nssm.exe start DespesasViagem
```

4. **HTTPS é obrigatório para o celular** (câmera e instalação do app exigem HTTPS fora do `localhost`). Publique atrás do IIS (ARR + URL Rewrite) ou outro proxy com certificado e ajuste o `.env`:
   `APP_URL=https://…`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`. Para uso fora da rede da empresa, o endereço precisa ser alcançável pela internet (ou por VPN).
5. **Atualizar a versão:** pare o serviço, copie os arquivos alterados (não sobrescreva `data\` nem `.env`), rode `npm install` se o `package.json` mudou, inicie o serviço. As migrações do banco rodam sozinhas na subida.

### 13.3 Docker (alternativa)

O `Dockerfile` usa `node:22-slim`, guarda o banco em `/data/gastos.db` (monte um disco persistente em `/data`) e declara verificação de saúde em `/health`.
Serviços como Render, Railway ou Fly.io exigem **disco persistente** (plano gratuito sem disco perderia o banco). Variáveis do `.env` entram como variáveis de ambiente do serviço.
**Não foi feito build do Docker nem publicação até aqui.**

### 13.4 Backup

Tudo está em um arquivo. **Não copie o `.db` solto com o app rodando** (modo WAL pode gerar cópia inconsistente). Use:

```bat
npm run backup                       REM backups\gastos-AAAA-MM-DD.db
npm run backup -- "E:\backup-msa"    REM em outra pasta/unidade
```

Mantém os 30 mais recentes da pasta. Agende no Agendador de Tarefas do Windows (diário) apontando para **outra unidade**; periodicamente copie os backups para fora do servidor.

### 13.5 Monitoramento e logs

- `GET /health` responde `{"ok":true}` quando o servidor está de pé.
- O servidor registra no console/arquivo de log do NSSM a leitura de cada nota (`[ia] provedor (modelo) leu a nota em N s`), falhas de IA e de e-mail.
- O custo por nota (tokens) pode ser visto com `npm run testar-nota`.

### 13.6 Custo de IA

Uma nota usa em média cerca de 2.500 tokens de entrada e 300 a 1.000 de saída. O custo depende do provedor/modelo escolhido; consulte os preços atuais nos painéis da Anthropic e da Moonshot.
XML e PDF com texto custam menos que foto (menos tokens, e o XML só usa IA para classificar os itens).

---

## 14. Limitações conhecidas e pendências

- **Não publicado em produção.** O projeto foi validado em desenvolvimento, com uso do navegador e de notas de teste geradas para o projeto; **falta validar com notas reais** (cupom amassado, pouca luz, DANFE real, XML real de hotel/restaurante/posto).
- **Sem suíte de testes automatizados.** A validação foi manual e por scripts (`testar-nota`).
- **Docker não foi construído/testado**, e a renderização das páginas de PDF depende de uma biblioteca nativa (`@napi-rs/canvas`) cuja versão para Linux consta no `package-lock.json`, mas não foi exercitada.
- **Relatório em PDF:** o gerador (html2pdf.js) e as fontes agora são hospedados no próprio app, sem depender de internet externa.
- **PDF baixado não foi inspecionado visualmente página a página;** a conferência foi feita pela tela e pela contagem de páginas.
- **NFS-e (nota de serviço)** não tem leitor de XML; use PDF ou foto.
- **PDF escaneado** com o Kimi leva cerca de 50 s; com o Claude, menos de 10 s (testes).
- **XML na visualização/relatório** não é o DANFE oficial: é uma visualização simplificada dos mesmos dados.
- **4 comprovantes por página** deixa PDF de DANFE e XML com texto pequeno (decisão de layout a validar).
- **Lista de municípios** é uma cópia do IBGE de outubro de 2026; precisa ser baixada de novo se surgirem municípios novos.
- **E-mail:** o envio real pelo Office 365 foi verificado só na conexão/autenticação; a entrega de um convite real deve ser conferida na primeira instalação.
- **Consulta à SEFAZ pela chave** não está implementada (exige certificado digital A1 e só devolve notas em que o CNPJ da empresa é destinatário).

**Evoluções possíveis:** exportação para o ERP (Focco), aprovação do gestor, alerta de teto por categoria, painel de gastos por colaborador/centro de custo, suporte a NFS-e.

---

## 15. Solução de problemas

| Sintoma | Causa provável e o que fazer |
|---|---|
| O app não sobe: "JWT_SECRET ausente ou curto" | Defina `JWT_SECRET` com 32+ caracteres no `.env` |
| "Porta em uso" | Há outro processo na porta; feche-o ou mude `PORT` (e `APP_URL`) |
| Aviso "nenhuma chave de IA" | Preencha `ANTHROPIC_API_KEY` e/ou `MOONSHOT_API_KEY` e reinicie |
| "Não consegui ler esta nota" | Foto cortada/borrada, ou falha do provedor. Refaça a foto (nota inteira, sem reflexo) ou use **Ler novamente** com o outro provedor; veja o log |
| Nota lida com valor/categoria errados | Corrija o lançamento na tela; confira os avisos ⚠ da nota |
| "Esta nota já foi lançada" | Antiduplicidade: mesma chave de acesso ou mesmo arquivo já existe (veja a viagem citada na mensagem) |
| Convite/senha não chega por e-mail | Confira caixa de spam e as variáveis `SMTP_*` (porta 587 com `SMTP_SECURE=false`; SMTP AUTH liberado; remetente igual à conta). Enquanto isso, use o link mostrado na tela do administrador |
| Câmera não abre no celular | Falta HTTPS. Use "Enviar foto…" (galeria) até publicar com HTTPS |
| "Baixar PDF" não funciona | Sem acesso à internet para carregar o gerador; use Imprimir → Salvar como PDF |
| Usuário não consegue entrar | Confira se está ativo (tela Usuários) e se o e-mail está no domínio permitido; use "Esqueci minha senha" |
| Quero apagar dados de teste | Pare o serviço e apague a pasta `data\` (apaga **todo** o banco, inclusive as notas) e recrie o administrador |
| Nota antiga com categoria "Outros" que deveria ser Hospedagem/Uber/Táxi | Mudanças na leitura valem só para notas novas. Edite o lançamento ou use **Ler novamente** |
