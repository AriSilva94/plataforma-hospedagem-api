# Plataforma de Hospedagem — Backend

API NestJS do marketplace de hospedagem. Este repositório também contém as migrations Prisma, a infraestrutura local e a documentação oficial do projeto.

## Documentação

Consulte `docs/` antes de implementar funcionalidades. Ela contém escopo, regras de negócio, arquitetura, decisões e estado atual.

## Setup local

```bash
cp .env.example .env
docker compose up -d
npm install
npx prisma migrate deploy
npm run start:dev
```

Veja instruções completas em `docs/development/local-setup.md`.

## Qualidade

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:e2e
```
