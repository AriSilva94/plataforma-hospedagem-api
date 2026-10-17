# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar os riscos de tomada de conta no vínculo Google, vazamento de GPS em imagens, CSRF entre subdomínios e abuso de recursos nos uploads.

**Architecture:** O NestJS continuará responsável por autenticação, autorização, sanitização e limites. Um middleware global validará origem de mutações, `GoogleAuthService` distinguirá e-mails autoritativos, e `MediaService` decodificará imagens com Sharp antes do R2. O frontend adicionará um cabeçalho explícito às mutações.

**Tech Stack:** NestJS 11, TypeScript strict, Prisma, Sharp, Jest, Supertest, Next.js 16.

---

### Task 1: Baseline e dependência de processamento de imagem

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

- [ ] **Step 1: Verificar o baseline do backend e frontend**

Run: `npm test -- --runInBand` e `npm run typecheck` no backend; `npm run lint` e `npm run typecheck` no frontend.
Expected: todos os comandos terminam com código 0.

- [ ] **Step 2: Instalar Sharp no backend**

Run: `npm install sharp`
Expected: `sharp` aparece em `dependencies` e o lockfile é atualizado.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add image processing dependency"
```

### Task 2: Restringir vínculo automático Google

**Files:**
- Modify: `backend/src/auth/google-auth.service.spec.ts`
- Modify: `backend/src/auth/google-auth.service.ts`
- Modify (workspace compartilhado, fora dos dois repositórios Git): `docs/decisions/ADR-011-google-federated-auth.md`

- [ ] **Step 1: Escrever testes que recusam e-mail externo e aceitam Gmail/Workspace**

Adicionar casos que criam ID tokens para `ana@example.com`, `ana@gmail.com` e `ana@empresa.com` com `hd: empresa.com`. Para conta local existente, o primeiro deve rejeitar sem executar `user.update`; os dois últimos devem vincular.

- [ ] **Step 2: Executar o teste e confirmar RED**

Run: `npm test -- google-auth.service.spec.ts --runInBand`
Expected: o caso de e-mail externo falha porque o serviço ainda vincula pela coincidência de endereço.

- [ ] **Step 3: Implementar autoridade do Google**

Estender `GoogleIdentity` com `emailAuthority: boolean`. Em `verifyIdToken`, calcular `emailDomain`, validar `hd` quando presente e definir autoridade quando o domínio for `gmail.com` ou `hd` corresponder ao domínio. Em `authenticateCallback`, lançar `UnauthorizedException` antes de alterar a conta local quando `existingUser && !identity.emailAuthority`.

- [ ] **Step 4: Executar teste e confirmar GREEN**

Run: `npm test -- google-auth.service.spec.ts --runInBand`
Expected: todos os testes passam.

- [ ] **Step 5: Atualizar ADR e commit**

Documentar que e-mails externos não autoritativos podem criar conta nova, mas não assumem conta local existente.

```bash
git add src/auth/google-auth.service.ts src/auth/google-auth.service.spec.ts
git commit -m "fix: restrict automatic Google account linking"
```

### Task 3: Sanitizar imagens e remover metadados

**Files:**
- Modify: `backend/src/media/media.service.spec.ts`
- Modify: `backend/src/media/media.service.ts`
- Modify: `backend/src/media/media-storage.ts`

- [ ] **Step 1: Escrever testes para GPS e conteúdo inválido**

Gerar JPEG real com EXIF GPS usando Sharp, chamar `MediaService.store` e reconstruir o corpo recebido pelo storage. Verificar que `sharp(stored).metadata().exif` está ausente. Criar também arquivo com cabeçalho JPEG e payload inválido e esperar `BadRequestException`.

- [ ] **Step 2: Executar o teste e confirmar RED**

Run: `npm test -- media.service.spec.ts --runInBand`
Expected: EXIF continua presente e o falso JPEG é aceito.

- [ ] **Step 3: Implementar normalização**

Para `MediaType.IMAGE`, decodificar o arquivo com `sharp(file.path, { animated: true })`, aplicar `rotate()` e produzir Buffer no formato detectado sem `withMetadata`. Comparar o formato decodificado com o cabeçalho, recusar falhas de decode e aplicar o limite de tamanho também ao resultado. Enviar `Readable.from(buffer)` ao storage e persistir o tamanho sanitizado.

- [ ] **Step 4: Executar teste e confirmar GREEN**

Run: `npm test -- media.service.spec.ts --runInBand`
Expected: testes passam e o storage recebe imagem válida sem EXIF.

- [ ] **Step 5: Commit**

```bash
git add src/media/media.service.ts src/media/media.service.spec.ts src/media/media-storage.ts
git commit -m "fix: strip metadata from uploaded images"
```

### Task 4: Bloquear CSRF entre subdomínios

**Files:**
- Create: `backend/src/infrastructure/security/csrf-protection.middleware.ts`
- Create: `backend/src/infrastructure/security/csrf-protection.middleware.spec.ts`
- Modify: `backend/src/app.config.ts`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/test/auth.spec.ts`

- [ ] **Step 1: Escrever testes unitários do middleware**

Cobrir: `POST` com `Origin` diferente responde 403; origem exata chama `next`; `Sec-Fetch-Site: cross-site` sem origem responde 403; chamadas sem cabeçalhos de navegador continuam disponíveis para integrações e testes; métodos seguros passam.

- [ ] **Step 2: Confirmar RED**

Run: `npm test -- csrf-protection.middleware.spec.ts --runInBand`
Expected: falha porque o middleware ainda não existe.

- [ ] **Step 3: Implementar e registrar middleware**

Criar `csrfProtection(frontendUrl)` para comparar `new URL(frontendUrl).origin` com `Origin`, rejeitar origens divergentes e `Sec-Fetch-Site: cross-site` em `POST`, `PUT`, `PATCH` e `DELETE`, e responder `403` com mensagem genérica. Registrar após `cookieParser` em `configureApplication`.

- [ ] **Step 4: Adicionar cabeçalho explícito no frontend**

Em `request`, incluir `X-CSRF-Protection: 1` para métodos mutáveis, mantendo `Content-Type` ausente em `FormData`. Adicionar teste Playwright/HTTP que observe o cabeçalho em login ou outra mutação.

- [ ] **Step 5: Confirmar GREEN**

Run backend: `npm test -- csrf-protection.middleware.spec.ts --runInBand`
Run frontend: `npx playwright test test/auth.spec.ts`
Expected: testes passam.

- [ ] **Step 6: Commit em cada repositório**

Backend: `git commit -m "fix: reject cross-origin state changes"`.
Frontend: `git commit -m "fix: mark API mutations for CSRF protection"`.

### Task 5: Reduzir custo e abuso de uploads

**Files:**
- Modify: `backend/src/media/upload-media.decorator.ts`
- Modify: `backend/src/users/users.controller.ts`
- Modify: `backend/src/properties/properties.controller.ts`
- Modify: `backend/src/rooms/rooms.controller.ts`
- Modify: `backend/src/properties/properties.service.ts`
- Modify: `backend/src/rooms/rooms.service.ts`
- Modify: `backend/test/properties.e2e-spec.ts`

- [ ] **Step 1: Escrever testes para limites por rota e pré-checagem**

Adicionar e2e que envia arquivo maior que 10 MB ao avatar/quarto e espera 413, mantendo vídeo de imóvel sob 100 MB aceito pela camada multipart. Adicionar teste de serviço que preenche o limite e verifica que `mediaService.store` não é chamado.

- [ ] **Step 2: Confirmar RED**

Run: `npm run test:e2e -- --runInBand properties.e2e-spec.ts auth-security.e2e-spec.ts`
Expected: upload de foto acima de 10 MB alcança o serviço ou a pré-checagem ainda chama o storage.

- [ ] **Step 3: Implementar decorators específicos**

Substituir `UploadMedia()` por `UploadImage()` com 10 MB em avatar e quarto, e `UploadPropertyMedia()` com 100 MB em imóvel. Aplicar `@Throttle` específico nas três rotas.

- [ ] **Step 4: Implementar pré-checagem de quantidade**

Antes de `MediaService.store`, verificar contagem atual. Quarto e avatar conhecem o tipo permitido; imóvel inspeciona o tipo antes da transferência e verifica o limite correspondente. Manter o bloqueio e a validação transacional existentes.

- [ ] **Step 5: Confirmar GREEN**

Run: `npm run test:e2e -- --runInBand properties.e2e-spec.ts auth-security.e2e-spec.ts`
Expected: testes passam sem chamada ao R2 em pedidos já acima do limite.

- [ ] **Step 6: Commit**

```bash
git add src/media src/users src/properties src/rooms test
git commit -m "fix: constrain media upload resource usage"
```

### Task 6: Atualizar documentação oficial

**Files:**
- Modify (workspace compartilhado, fora dos dois repositórios Git): `docs/decisions/ADR-014-media-upload-via-backend.md`
- Modify (workspace compartilhado, fora dos dois repositórios Git): `docs/decisions/ADR-016-security-headers.md`
- Modify (workspace compartilhado, fora dos dois repositórios Git): `docs/business-rules/properties-and-rooms.md`
- Modify (workspace compartilhado, fora dos dois repositórios Git): `docs/development/current-state.md`

- [ ] **Step 1: Registrar os comportamentos finais**

Documentar remoção de metadados, decode completo, limites por rota, pré-checagem, proteção de origem e cabeçalho do frontend. Atualizar `current-state.md` com data e resumo.

- [ ] **Step 2: Revisar consistência com código**

Run: `rg -n "metadados|CSRF|Origin|10 MB|100 MB" docs`
Expected: regras e ADRs descrevem exatamente o comportamento implementado.

Os documentos ficam no diretório compartilhado do workspace, que não pertence aos repositórios Git `backend` ou `frontend`; por isso serão atualizados e revisados, mas não entram nos commits dessas branches.

### Task 7: Verificação e revisão final

**Files:**
- Review: todos os arquivos alterados nas duas branches

- [ ] **Step 1: Executar validação completa do backend**

Run: `npm run lint`, `npm run typecheck`, `npm test -- --runInBand`, e os e2e relacionados.
Expected: código 0, sem falhas.

- [ ] **Step 2: Executar validação completa do frontend**

Run: `npm run lint`, `npm run typecheck`, e teste Playwright relacionado.
Expected: código 0, sem falhas.

- [ ] **Step 3: Revisar diff**

Run: `git diff release/separate-steps...HEAD --check`, procurar `console.log`, `TODO`, `any`, inline styles e mudanças fora do escopo.
Expected: nenhum resíduo ou alteração não relacionada.

- [ ] **Step 4: Confirmar estado das branches**

Run: `git status --short` nos dois worktrees.
Expected: árvores limpas e commits separados por responsabilidade.
