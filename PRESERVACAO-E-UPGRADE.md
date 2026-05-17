# Migração para Docker (home lab) + preservação — orkut-bsky

> Status: plano para revisão. Nada executado na VM nem no home lab.
> Objetivo real: **sair da VM free-tier e rodar em Docker no home lab**, mantendo
> as versões antigas (está tudo funcionando — sem upgrade de dependências),
> com backup confiável e as regras de rotulagem melhor documentadas/escritas.
> Premissa inegociável: **continuar funcionando, zero perda de labels**.

## 1. O que é a aplicação (regras, em linguagem clara)

Labeler do Bluesky. Escuta o firehose e reage a **likes** em dois posts fixos do
próprio labeler (rkeys em `src/constants.ts`):

- Like no post **`RUN`** (`3l3ny5yrbif2p`) → aplica labels no autor do like.
- Like no post **`DELETE`** (`3l3nxu2d67x2r`) → remove (nega) todos os labels do autor.

Regras de quais labels aplicar no `RUN` (estado atual de `src/label.ts`, já com
suas edições locais ainda **não** publicadas na VM):

| Quem | Labels aplicados |
|---|---|
| Está em `STARS` **ou** DID `…awzk6kvwtzhvr2bk3sinxwe2` | `fa` |
| Está em `STARS` **ou** DID `…6objvq5gprmuleio2qudohtn` | `superconfiavel`, `superlegal`, `supersexy` |
| DID `…awzk6kvwtzhvr2bk3sinxwe2` (e não caiu acima) | `superconfiavel`, `superlegal`, `syngred` |
| Qualquer outro | `{"" \| muito \| super}confiavel`, `…legal`, `…sexy` (prefixos sorteados aleatoriamente) |

`STARS` = 4 DIDs em `constants.ts`. **Confirmar se esta tabela bate com a intenção**
antes de qualquer limpeza de código (a refatoração será feita contra esta tabela).

## 2. Estado e o que não pode ser perdido

Esta pasta (macOS) é **clone de trabalho**. Produção roda **só na VM** (`/root/orkut`, PM2 `orkut`).

| Item | Crítico | Original | Backup hoje |
|---|---|---|---|
| Código | sim | GitHub `breakzplatform/orkut` `main` | Sim (git). Edições locais novas pendentes |
| `.env` (`SIGNING_KEY`) | **MÁXIMO** | VM + backup local (Mac) | Parcial — falta cópia off-machine (cofre/senha) |
| `labels.db` (+`-wal`/`-shm`) | **MÁXIMO** | VM + cópia local (Mac, 3 arquivos) | OK (app parada → consistente). Verificar count |
| `cursor.txt` | não | VM | Irrelevante (zerado 4h via `cleaner.sh`) |

## 3. Fase 0 — Salvaguarda imediata (antes de tudo, na VM — você executa)

1. `cat /root/orkut/.env` → guardar `SIGNING_KEY` em 2 locais fora da VM
   (gerenciador de senhas + cofre offline). Não colar em chat/repo em texto puro.
2. Backup consistente do banco (sem isso, perde dados — o `-wal` fica grande):
   ```sh
   sqlite3 /root/orkut/labels.db ".backup '/root/orkut/labels-backup.db'"
   ```
   Baixar `labels-backup.db` para fora da VM.

## 4. Fase 1 — Containerizar (sem mudar dependências)

- **Pinar versões exatas** no `package.json` (remover `^`) nas versões que
  funcionam hoje (`@atproto/api 0.13.35`, `@skyware/firehose 0.3.2`,
  `@skyware/labeler 0.1.13`, `dotenv 16.5.0`, `tsx 4.20.3`, `typescript 5.8.3`);
  commitar `package-lock.json`. Imagem usa `npm ci` → build reprodutível.
- **Base image**: Node LTS 20 (era das libs; `@types/node ^20`). Importante:
  `@skyware/labeler` puxa `better-sqlite3` (módulo **nativo**) — precisa compilar
  para a arquitetura do home lab (amd64 vs arm64). Build multi-stage com
  `python3`/`make`/`g++` no stage de build.
- **Volume persistente** para o estado mutável: `labels.db*` e `cursor.txt`
  vivem num volume nomeado (ex.: montar `/data`), não dentro da imagem. App grava
  no cwd → ou ajustar paths para `/data`, ou montar o volume no workdir.
- **Segredo**: `.env` montado via `--env-file`/secret, **nunca** no `Dockerfile`/imagem.
- **`cleaner.sh` / reset diário do cursor**: hoje faz `pm2 stop/start` + zera
  `cursor.txt`. Em Docker não há PM2. Provável motivo do reset: evitar replay de
  backlog gigante / cursor preso após queda. Opções: (a) replicar — cron no host
  fazendo `truncate cursor.txt && docker restart orkut` às 4h; (b) entrypoint que
  zera `cursor.txt` no start + `docker restart` diário; (c) **questionar se ainda
  é necessário**. Decidir na revisão.
- `restart: unless-stopped` no compose para resiliência (substitui o papel do PM2).
- Healthcheck opcional batendo na porta `4001`.

## 5. Fase 2 — TROCAR o endpoint do labeler no DID (ponto mais delicado)

O domínio antigo não será renovado → a URL pública **muda**. O documento DID do
labeler tem um serviço `#atproto_labeler` com um `serviceEndpoint`; o Bluesky
busca os labels nessa URL. É preciso **atualizar esse endpoint no DID doc** para
um domínio novo apontando ao home lab.

### 5.1 Acesso — RESOLVIDO ✅

Confirmado: acesso total à conta Bluesky (handle, senha, e-mail). A troca do
`serviceEndpoint` será feita via **operação PLC mediada pelo PDS** (a senha
autoriza; o e-mail recebe o token de confirmação da operação PLC). A expiração
do domínio antigo **não** trava nada enquanto você controla a conta.

**Foot-gun crítico — NÃO rotacionar a `SIGNING_KEY`:**
`SIGNING_KEY` (`.env`) assina os labels e está publicada no DID doc como
verification method. A operação PLC deve mudar **somente** o `serviceEndpoint`
do serviço `#atproto_labeler`, mantendo idênticos os `verificationMethods`
(a signing key atual) e as `rotationKeys`. Se a signing key mudar, as
assinaturas dos labels já emitidos deixam de validar → labels existentes
"somem" para os clientes. Por isso o backup externo da `SIGNING_KEY` (Fase 0)
continua urgente mesmo com acesso à conta: perdê-la é praticamente
irreversível, recriar invalidaria o histórico.

### 5.1b Procedimento de troca (esboço — ensaiar antes do corte)

Fluxo PLC oficial com a conta (e-mail recebe token):
1. Resolver e **salvar o DID doc atual** (`curl https://plc.directory/<DID>`).
2. `com.atproto.identity.requestPlcOperationSignature` → token por e-mail.
3. Montar a operação alterando **só** `services["atproto_labeler"].endpoint`
   para o domínio novo; copiar o resto do doc sem alterar.
4. `com.atproto.identity.signPlcOperation` (com o token) →
   `com.atproto.identity.submitPlcOperation`.
5. Conferir `plc.directory/<DID>` refletindo a URL nova.

Script pronto: `scripts/change-labeler-endpoint.ts` (usa `@atproto/api`,
fluxo PLC em 2 fases — pede token por e-mail, depois `--token=... --commit`;
muda **só** `#atproto_labeler.endpoint`, mantém PDS/`atproto_label`/rotation/
handle; verifica no `plc.directory` ao final; aborta se `atproto_label` sumir).
Endpoint alvo: `https://orkut.xn--wg8h.joseli.to` (sem barra final). Não
testado ao vivo — ensaiar na janela de corte. Não re-rodar `@skyware/labeler
setup` (geraria signing key nova).

### 5.2 Estado atual — RESOLVIDO ✅

- DID: `did:plc:3gtp7uvt63bwostaypbcb7ur`
- Handle: `etiquetasdoorkut.bsky.social`
- PDS: `https://chaga.us-west.host.bsky.network` (bsky.social → PLC via senha+e-mail)
- Endpoint labeler atual: `https://orkut.joselito.pw` (**vai morrer** — trocar)
- Verification methods no DID doc: `#atproto` e `#atproto_label`. O
  `#atproto_label` corresponde à `SIGNING_KEY` → **manter idêntico** na operação.

Domínio novo definido: **`orkut.xn--wg8h.joseli.to`** (forma punycode — é a
que vai no DID doc e no certificado). Endpoint alvo:
`https://orkut.xn--wg8h.joseli.to`. Exposição via **Cloudflare Tunnel**
(sem port-forward, sem Caddy).

### 5.3 Trocar (sequência segura)

1. Novo domínio (que você vá manter) → DNS A record → IP do home lab; reverse
   proxy (Caddy) com HTTPS, `reverse_proxy 127.0.0.1:4001`; port-forward 443.
2. Container no ar no home lab servindo nesse domínio (com cópia do `labels.db`).
3. Atualizar o `serviceEndpoint` do labeler no DID doc para o novo domínio. O
   mecanismo exato depende de §5.1 (PDS vs rotation key) — **a verificar**; o
   `@skyware/labeler` tem fluxo de setup que grava o endpoint, mas confirmar se
   suporta troca no caso desta conta.
4. Aguardar propagação do DID, verificar `plc.directory/<DID>` refletindo a URL nova.

Se isto não for resolvido, os labels param mesmo com o container saudável.
**Pré-requisito absoluto da migração.**

## 6. Fase 3 — Cutover sem perda

1. Fases 0, 1 e 2 prontas; container validado no home lab com **cópia** do
   `labels.db` (sobe, lê o banco, aplica/nega um label de teste).
2. Janela: `pm2 stop orkut` na VM → `.backup` final do `labels.db` → transferir
   para o volume do container → subir container → repontar DNS/proxy para o home lab.
3. Verificar ponta a ponta (like no post `RUN` → label aparece). Só então
   desligar/decommissionar a VM. Manter VM desligada (não destruída) por alguns
   dias como rollback.

## 7. Refactor do código — FEITO (validar na VM antes do Docker)

Concluído nesta branch (mesmas versões de libs, sem upgrade):

- DIDs hardcoded e `STARS` → `supporters.json` (mapa `DID → [labels]`, editável
  sem rebuild; relido a cada evento — efeito imediato, ideal p/ vender acesso).
- `label.ts` reescrito: apoiador recebe lista do JSON; não-apoiador cai no
  caminho padrão isolado. Trio aleatório de **primeira vez idêntico** ao atual.
- **Bug corrigido**: `RUN` agora é idempotente. Curtir o post N vezes não
  empilha mais labels (antes acumulava, principalmente os aleatórios).
- `DELETE` inalterado. `constants.ts` perdeu `STARS` e o `LABEL_LIMIT` morto.
- `tsc` limpo em `src/` (erros restantes são de `node_modules`, pré-existentes,
  irrelevantes pois roda via `tsx`).

**Validado** localmente via `scripts/validate-refactor.ts` contra cópia da
`labels.db` de produção (20.639 labels) + `SIGNING_KEY` real, sem rede/VM:
5/5 cenários PASS (trio aleatório, idempotência do RUN/bug, DELETE,
lista de apoiador, re-like de apoiador). O mesmo harness serve para testar a
imagem Docker depois. Modelo de tiers: adiar (decisão futura).

## 9. Validar o refactor na VM sem perder dados (passo a passo)

Arquivos alterados: `src/label.ts`, `src/constants.ts`, **novo** `supporters.json`.
`supporters.json` precisa ficar em `/root/orkut/supporters.json` (mesmo cwd que
`cursor.txt`). Dependências NÃO mudaram → não precisa reinstalar.

**1. Backup obrigatório (consistente) antes de tocar em qualquer coisa:**
```sh
mkdir -p /root/orkut/backups
sqlite3 /root/orkut/labels.db ".backup '/root/orkut/backups/labels-pre-refactor.db'"
cp /root/orkut/src/label.ts /root/orkut/backups/label.ts.bak
cp /root/orkut/src/constants.ts /root/orkut/backups/constants.ts.bak
```

**2. Levar o código novo para a VM** (escolha um):
- Via git: commitar+push deste clone, e na VM `git stash` (se houver alterações
  locais lá) → `git pull`. Confirme que `supporters.json` veio (não está no
  `.gitignore`).
- Manual: copiar os 3 arquivos para a VM (`src/label.ts`, `src/constants.ts`,
  `/root/orkut/supporters.json`).

**3. Reiniciar e olhar o log:**
```sh
pm2 restart orkut
pm2 logs orkut --lines 30   # deve aparecer "Labeler server listening on ..."
```
Se aparecer `Could not read supporters.json` → o arquivo não está em
`/root/orkut/`. Corrija o local.

**4. Teste funcional** (use uma conta de teste / alt que NÃO esteja no
`supporters.json`, para validar o caminho aleatório e o bug):
- Curta o post `RUN` com a conta de teste.
- Verifique os labels aplicados:
  ```sh
  sqlite3 /root/orkut/labels.db \
    "SELECT val,neg FROM labels WHERE uri='<DID_DA_CONTA_TESTE>' ORDER BY id;"
  ```
  Esperado: exatamente 3 (`?confiavel`, `?legal`, `?sexy`).
- **Curta o `RUN` de novo** com a mesma conta. Rode a query outra vez.
  Esperado: **continua 3** (antes do fix, aumentaria). Esse é o teste do bug.
- Curta o post `DELETE`. Query de novo: devem aparecer linhas `neg=1`
  negando os labels (sumem no cliente).
- Opcional: repita com um DID listado no `supporters.json` → recebe exatamente
  a lista dele, e re-curtir não duplica.

**5. Rollback (se algo der errado):**
```sh
cp /root/orkut/backups/label.ts.bak /root/orkut/src/label.ts
cp /root/orkut/backups/constants.ts.bak /root/orkut/src/constants.ts
# labels.db só se ele tiver sido corrompido (improvável — código só lê + insere):
# pm2 stop orkut && cp backups/labels-pre-refactor.db labels.db && pm2 start orkut
pm2 restart orkut
```
O reset diário das 4h (`cleaner.sh`) não interfere — só zera o `cursor.txt`.

## 10. Docker — arquivos prontos (build no home lab)

Criados: `Dockerfile` (multi-stage, Node 20, `npm ci`, mesmas versões),
`docker-compose.yml`, `docker-entrypoint.sh`, `.dockerignore`,
`cleaner-docker.sh`, `Caddyfile.example`. **Não buildado/testado no Mac**
(sem Docker aqui) — build e validação no home lab amd64.

Estado mutável + segredo ficam em `./data` (volume), nunca na imagem:
`.env`, `supporters.json`, `cursor.txt`, `labels.db*`.

Deploy no home lab:
```sh
git clone <repo> orkut && cd orkut
mkdir -p data
cp /caminho/orkut-bkp/env-orkut            data/.env
cp /caminho/orkut-bkp/labels.db            data/labels.db
cp /caminho/orkut-bkp/labels.db-wal        data/labels.db-wal
cp /caminho/orkut-bkp/labels.db-shm        data/labels.db-shm
cp supporters.json                         data/supporters.json
docker compose up -d --build
docker compose logs -f orkut   # esperar "Labeler server listening on ..."
```
Reset diário (substitui o `cleaner.sh`): `crontab -e` →
`0 4 * * * /caminho/orkut/cleaner-docker.sh >> /var/log/orkut-cleaner.log 2>&1`

Exposição: **Cloudflare Tunnel rodando no HOST** do home lab (cloudflared como
serviço/systemd no host, **não** no compose). O container publica a porta só no
loopback do host: `127.0.0.1:41401 -> 4001` (porta alta/incomum, nada na
LAN/internet). O cloudflared do host alcança via `http://127.0.0.1:41401`.
Cloudflare termina o TLS e suporta o WebSocket de `subscribeLabels`.

Setup do tunnel (no host): criar em Cloudflare Zero Trust > Networks > Tunnels;
rodar o `cloudflared` do host com o token; Public Hostname
`orkut.xn--wg8h.joseli.to` → `http://127.0.0.1:41401`. A URL
`https://orkut.xn--wg8h.joseli.to` tem que virar o `#atproto_labeler` no DID
(§5.3).

Healthcheck: bate em `com.atproto.label.queryLabels` (qualquer resposta = up;
skyware 0.1.13 não tem rota `_health`).

## 11. Mover para o home lab e retomar a sessão

O que viaja por git vs. fora dele:
- **Git** (push → clone): código, Docker, `supporters.json`, este plano.
- **NÃO git** (gitignored, mover à parte): `.env`/`SIGNING_KEY` e `labels.db*`
  → já estão em `../orkut-bkp`. Transferir por scp/rsync, nunca por git.

### 11.1 No Mac (origem)
```sh
# revisar o diff antes
git status && git diff
git add -A && git commit -m "feat: dockerize + supporters.json + RUN idempotente"
git push origin main
```
(Arquivos gitignored não vão no push — é esperado e correto.)

### 11.2 Transferir o estado sensível para o home lab
```sh
# do Mac, ajuste user@homelab e caminho
rsync -av ../orkut-bkp/ user@homelab:/srv/orkut-bkp/
```

### 11.3 No home lab (destino)
```sh
# requisitos: git, docker, docker compose
git clone git@github.com:breakzplatform/orkut.git && cd orkut
mkdir -p data
cp /srv/orkut-bkp/env-orkut     data/.env
cp /srv/orkut-bkp/labels.db     data/labels.db
cp /srv/orkut-bkp/labels.db-wal data/labels.db-wal
cp /srv/orkut-bkp/labels.db-shm data/labels.db-shm
cp supporters.json              data/supporters.json
docker compose up -d --build
docker compose logs -f orkut    # "Labeler server listening on ..."
```
Tunnel (no host, fora do compose): instalar `cloudflared`, autenticar, criar o
tunnel, Public Hostname `orkut.xn--wg8h.joseli.to` → `http://127.0.0.1:41401`,
rodar como serviço (`cloudflared service install`).

Cron do reset diário: `0 4 * * * /caminho/orkut/cleaner-docker.sh >> /var/log/orkut-cleaner.log 2>&1`

NÃO trocar o endpoint no DID (§5.3) até o container de pé E o tunnel
respondendo em `https://orkut.xn--wg8h.joseli.to`.

### 11.4 Retomar o contexto desta sessão no home lab
Sessão Claude não migra entre máquinas nativamente. Caminho confiável:
1. Instalar o Claude Code no home lab, `cd` no repo clonado.
2. Primeiro prompt: *"Leia PRESERVACAO-E-UPGRADE.md e continue de onde paramos."*
   Este doc é o estado de verdade (decisões, o que falta, §8).
3. (Opcional, histórico literal) copiar a pasta de sessão do Mac
   `~/.claude/projects/<hash-do-projeto>/` para o mesmo caminho no home lab —
   não é suportado oficialmente, o handoff por doc é o método recomendado.

## 8. Próximos passos

- [x] Fase 0 — backup em `../orkut-bkp`: `env-orkut` + `labels.db`(+wal/shm).
      Verificado: 20.639 labels / 4.119 DIDs. Falta só 1 cópia fora do Mac
      (cofre/nuvem, baixa urgência)
- [x] Acesso à conta do labeler confirmado — §5.1
- [x] DID/handle/PDS/endpoint atual resolvidos — §5.2
      (endpoint atual: `https://orkut.joselito.pw`)
- [ ] (Revisão) Confirmar tabela de regras §1
- [ ] (Você) Definir o novo domínio (que será mantido) para o home lab
- [x] Refactor feito e validado localmente (§7)
- [x] Dockerfile + compose + entrypoint + cleaner + Caddyfile (§10) — falta
      buildar/testar no home lab amd64
- [x] Domínio novo definido: `orkut.xn--wg8h.joseli.to` (Cloudflare Tunnel)
- [x] Compose: porta só em `127.0.0.1:41401` (tunnel é no HOST, não no compose)
- [x] Cloudflared no host (tunnel remoto, hostname `orkut.xn--wg8h.joseli.to`
      → `127.0.0.1:41401`); queryLabels + subscribeLabels validados via edge
- [x] Script da troca de endpoint pronto e **corrigido** — montava a operação
      a partir de `getRecommendedDidCredentials` (que omite `atproto_label` e
      `atproto_labeler` → orfanaria todos os labels); agora usa o DID doc real
- [x] **Cutover CONCLUÍDO** — `#atproto_labeler` no DID doc trocado para
      `https://orkut.xn--wg8h.joseli.to`; `atproto_label`/rotation/PDS/handle
      idênticos; rodando em Docker no home lab. VM parada como rollback.
- [x] Supervisor de reconexão do firehose em `src/main.ts` (substitui o cron)

Decisões já fechadas: host amd64. **Reset diário por cron REMOVIDO** — a causa
raiz era o auto-reconnect quebrado do `@skyware/firehose` 0.3.2 (watchdog
preso ao handler de `message`, que se autodesarma após uma reconexão sem
tráfego; o evento `close` não reconecta). `src/main.ts` agora é um supervisor:
`autoReconnect:false` + reconexão própria em `close`/`websocketError`/stall
(sem eventos por 45s) a partir do cursor salvo, com backoff. Reconecta em
segundos com o cursor preservado → o relay reenvia o backlog → **zero perda**
em quedas transitórias (o cron antigo zerava o cursor e perdia ~1 min de likes
todo dia às 4h). Não instalar o cron; `cleaner-docker.sh` fica como
ferramenta manual de emergência apenas.
