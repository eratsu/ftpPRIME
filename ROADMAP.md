# ftpPRIME — Roadmap / Próximas etapas

Lista consolidada de melhorias e features candidatas a serem desenvolvidas, agrupadas por área e com indicação de prioridade.

Legenda de prioridade:

- **P0** — crítica (segurança / correção importante)
- **P1** — alto impacto, recomendada em curto prazo
- **P2** — melhoria relevante
- **P3** — nice-to-have

---

## 1. Segurança

- [ ] **P0 — Criptografar credenciais** usando `safeStorage` do Electron (nativo) ou `keytar`. Hoje `projects.json` fica em texto claro em `%APPDATA%/ftpsender/`.
- [ ] **P1 — Export com senha opcional** — criptografar o JSON exportado com passphrase (AES-GCM).
- [ ] **P1 — Host key verification (SFTP)** — hoje qualquer host key é aceita. Implementar TOFU + fingerprint salvo por projeto com aviso em mudança.
- [ ] **P2 — Auto-update** via `electron-updater` + assinatura de binários (code signing Windows/macOS).
- [ ] **P2 — Audit log** local (quem fez upload de quê e quando) separado dos logs voláteis da UI.

## 2. Confiabilidade do sync

- [ ] **P1 — Comparação por hash/tamanho antes de enviar** — evita uploads desnecessários mesmo após "touch" no arquivo (hoje o critério é apenas `mtime`).
- [ ] **P1 — Watch de deletes/renames** — atualmente o watcher só envia `create`/`change`. Replicar `unlink` e rename no servidor (com confirmação opcional).
- [ ] **P1 — Retry com backoff exponencial** e fila persistida em disco (sobreviver a restart com uploads pendentes).
- [ ] **P2 — Sync bidirecional / merge** com detecção de conflitos quando o arquivo remoto é mais novo.
- [ ] **P2 — Paralelismo configurável** no upload/download (hoje é sequencial).
- [ ] **P2 — Progresso por arquivo grande** (bytes transferidos / total, velocidade).
- [ ] **P3 — Resume de uploads interrompidos** quando o servidor suporta `REST` (FTP) / offsets (SFTP).

## 3. UX / UI

- [ ] **P1 — Busca e filtro** na lista de arquivos.
- [ ] **P1 — Ordenação** da lista (nome, tamanho, data do último upload, status).
- [ ] **P1 — Árvore de pastas** colapsável em vez da lista flat atual.
- [ ] **P2 — Diff viewer** entre versões (hoje só é possível ver o conteúdo de uma versão por vez).
- [ ] **P2 — Notificações nativas** do SO em uploads concluídos/falhas (além dos toasts e balão da tray).
- [ ] **P2 — Drag-and-drop** de pastas na janela para criar projeto.
- [ ] **P2 — Indicador visual** na tray quando há upload em andamento.
- [ ] **P3 — Dark / Light theme toggle** nas configurações.
- [ ] **P3 — Atalhos de teclado globais** (ex.: `Ctrl+U` = upload all, `Ctrl+T` = terminal, `Ctrl+F` = busca).
- [ ] **P3 — Traduzir logs internos** (atualmente só strings da UI são i18n).

## 4. Projetos / organização

- [ ] **P2 — Grupos / tags** de projetos na sidebar.
- [ ] **P2 — Duplicar projeto** (copiar config com novo nome).
- [ ] **P2 — Perfis de conexão reutilizáveis** (mesmo servidor, múltiplos projetos apontando para subpastas diferentes).
- [ ] **P3 — Variáveis de ambiente por projeto** injetadas no terminal integrado.
- [ ] **P3 — Reordenar projetos** via drag-and-drop na sidebar.

## 5. Terminal

- [ ] **P2 — Múltiplas abas / splits** de terminal por projeto.
- [ ] **P2 — Escolha do shell** nas configurações (hoje detecta automaticamente).
- [ ] **P3 — Salvar histórico** do terminal entre sessões.
- [ ] **P3 — Busca dentro do buffer** do xterm (`Ctrl+F` no terminal).

## 6. Versionamento local

- [ ] **P2 — Limite configurável** de versões por arquivo (hoje fixo em 50).
- [ ] **P2 — Purge / limpeza** manual do `.ftpsender/versions` pela UI com indicação de espaço em disco.
- [ ] **P3 — Commit message / label** opcional ao fazer upload manual, exibida na lista de versões.
- [ ] **P3 — Compressão** (gzip) dos snapshots antigos.

## 7. Qualidade de código

- [ ] **P1 — Testes automatizados** — atualmente não há nenhum. Sugestão: **Vitest** para unidade (`sync-engine`, `version-manager`, `watcher`) + **Playwright** para E2E.
- [ ] **P1 — ESLint + Prettier** com CI (GitHub Actions) rodando lint e testes em cada PR.
- [ ] **P2 — TypeScript** ou **JSDoc tipado** para `ftp-service`, `sync-engine`, `version-manager`, `store`.
- [ ] **P2 — Extrair constantes** mágicas (timeouts, limites, tolerâncias) para um `src/config.js`.
- [ ] **P3 — Logger estruturado** (substituir `console.log` esparsos) com níveis e rotação de arquivo.

## 8. Distribuição

- [ ] **P1 — `electron-builder`** para gerar instaladores reais.
- [ ] **P1 — Instalador Windows (NSIS)** assinado.
- [ ] **P2 — Build para macOS** (`.dmg`) e **Linux** (`.AppImage` / `.deb`). O código já é cross-platform.
- [ ] **P2 — Portable build** (zip, sem instalação).
- [ ] **P3 — Publicação via GitHub Releases** com changelog automático.

---

## Sugestão de próxima sprint (maior ROI imediato)

1. **`safeStorage` para credenciais** — ganho grande de segurança com pouquíssimo código.
2. **Hash/tamanho antes de upload** — elimina reenvios desnecessários e melhora muito o comportamento do auto-upload.
3. **Watch de deletes + sync bidirecional básico** — fecha o loop do "sync de verdade".
4. **`electron-builder` + instalador assinado** — permite distribuir o app para usuários finais.
