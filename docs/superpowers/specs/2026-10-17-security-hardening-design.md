# Endurecimento de segurança de autenticação e mídia

## Objetivo

Corrigir os quatro riscos encontrados na revisão de segurança: vínculo inseguro de contas Google, exposição de metadados de localização em imagens, ausência de proteção explícita contra CSRF entre subdomínios e consumo excessivo de recursos em uploads.

## Escopo

O backend concentra as regras de segurança. O frontend recebe apenas o ajuste necessário para continuar enviando mutações autorizadas. Não serão criados novos fluxos de interface nem alterações no schema do PostgreSQL.

## Vínculo Google

O ID token continuará exigindo assinatura, emissor, audiência, expiração, `nonce`, e-mail válido e `email_verified`. A identidade também passará a registrar se o Google é autoridade atual sobre o endereço: endereços `gmail.com` são autoritativos e contas Google Workspace exigem um claim `hd` válido e compatível com o domínio do e-mail.

Uma identidade ainda não vinculada poderá criar uma nova conta com qualquer e-mail verificado pelo Google. O vínculo automático com uma conta local existente ocorrerá somente para e-mails sobre os quais o Google é autoridade. Tentativas de vincular automaticamente um endereço externo não autoritativo serão recusadas sem alterar senha, sessões ou tokens da conta existente.

## Proteção de imagens

Imagens JPEG, PNG e WebP serão decodificadas e normalizadas antes do armazenamento. O processamento removerá EXIF, XMP, ICC e outros metadados, incluindo coordenadas GPS, e impedirá que um arquivo seja aceito apenas por possuir um cabeçalho compatível. O formato de saída será preservado.

Vídeos continuarão seguindo a validação atual, pois a vulnerabilidade comprovada e a regra de localização privada envolvem fotografias. A introdução de transcodificação de vídeo exigiria infraestrutura e custos fora deste escopo.

## CSRF

Toda requisição HTTP que altera estado (`POST`, `PUT`, `PATCH` e `DELETE`) deverá apresentar uma origem confiável. O backend aceitará a origem exata configurada em `FRONTEND_URL`. Requisições internas autenticadas pelo segredo entre frontend e backend poderão ser aceitas sem `Origin` quando necessário.

O frontend enviará um cabeçalho de proteção em suas mutações. Requisições simples originadas por outro subdomínio não poderão acionar controllers, mesmo quando o navegador anexar cookies `SameSite`.

Falhas responderão `403` sem revelar detalhes de configuração.

## Limites de upload

Uploads de avatar e fotos de quarto serão limitados a 10 MB no parser multipart. Uploads de imóvel manterão 100 MB porque aceitam vídeos. Todas as rotas de mídia receberão rate limit específico.

Antes de transferir o arquivo ao R2, os serviços consultarão a quantidade atual de mídias e recusarão pedidos que já excedam o limite. A verificação transacional com bloqueio continuará existindo para resolver concorrência e permanecerá como decisão final.

## Testes

Os testes de regressão cobrirão:

- recusa de vínculo automático para e-mail externo não autoritativo;
- vínculo permitido para Gmail e Google Workspace válido;
- preservação da conta local quando o vínculo for recusado;
- remoção de EXIF/GPS e rejeição de imagem inválida;
- bloqueio de mutações com origem não confiável;
- aceitação da origem configurada e do caminho interno autorizado;
- limites multipart específicos e rate limit das rotas;
- recusa antes do R2 quando a quantidade máxima já foi atingida.

Cada comportamento será implementado em ciclo RED, GREEN e refatoração. Ao final serão executados lint, typecheck, testes unitários e testes e2e relacionados nos dois projetos.

## Documentação

As decisões existentes sobre autenticação Google, upload de mídia e cabeçalhos de segurança serão atualizadas. As regras de mídia e o estado atual também registrarão o novo comportamento.
