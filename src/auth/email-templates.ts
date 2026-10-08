export type EmailMessage = {
  subject: string;
  text: string;
  html: string;
};

const BRAND = 'DOMUS X';
const BRAND_NOWRAP = 'DOMUS\u00a0X';
const TAGLINE = 'Seu espaço, do seu jeito.';
const NOT_YOU = 'Não foi você?';

const color = {
  navy: '#031128',
  surface: '#0f1f39',
  line: '#22324d',
  blue: '#0b63e3',
  blueLight: '#3a83f0',
  white: '#f4f6f8',
  gray: '#b2bbc8',
  muted: '#9aabc1',
  tagline: '#b6d1ff',
};

const font = {
  sans: "'Plus Jakarta Sans','Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function heading(text: string): string {
  return `<h1 class="title" style="margin:0 0 14px;font-family:${font.serif};font-size:30px;line-height:1.15;font-weight:400;letter-spacing:-0.02em;color:${color.white};">${escapeHtml(text)}</h1>`;
}

function paragraph(html: string, marginBottom = 0): string {
  return `<p style="margin:0 0 ${marginBottom}px;font-family:${font.sans};font-size:16px;line-height:1.6;color:${color.gray};">${html}</p>`;
}

function finePrint(html: string, marginBottom = 0): string {
  return `<p style="margin:0 0 ${marginBottom}px;font-family:${font.sans};font-size:14px;line-height:1.55;color:${color.gray};">${html}</p>`;
}

function strong(text: string): string {
  return `<strong style="font-weight:700;color:${color.white};">${escapeHtml(text)}</strong>`;
}

function button(label: string, url: string): string {
  return `<table role="presentation" class="action" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
<tr>
<td align="center" bgcolor="${color.blue}" style="border-radius:12px;background-color:${color.blue};">
<a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${font.sans};font-size:16px;line-height:1.25;font-weight:800;color:${color.white};text-decoration:none;border-radius:12px;">${escapeHtml(label)}</a>
</td>
</tr>
</table>`;
}

function divider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 24px;">
<tr><td style="height:1px;line-height:1px;font-size:1px;background-color:${color.line};">&nbsp;</td></tr>
</table>`;
}

function link(label: string, url: string): string {
  return `<a href="${escapeHtml(url)}" target="_blank" style="color:${color.blueLight};text-decoration:underline;">${escapeHtml(label)}</a>`;
}

function fallbackLink(url: string): string {
  return `${finePrint('Se o botão não abrir, copie e cole este endereço no navegador:', 6)}
<p style="margin:0;font-family:${font.sans};font-size:14px;line-height:1.55;word-break:break-all;">${link(url, url)}</p>`;
}

function layout(options: {
  title: string;
  preheader: string;
  content: string;
  reason: string;
}): string {
  const year = new Date().getFullYear();

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(options.title)}</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; padding: 0; }
@media (max-width: 620px) {
  .shell { padding: 24px 12px !important; }
  .card { padding: 28px 22px !important; }
  .title { font-size: 26px !important; }
  .action { width: 100% !important; }
  .action a { display: block !important; padding-left: 16px !important; padding-right: 16px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${color.navy};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${color.navy};">${escapeHtml(options.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${color.navy}" style="background-color:${color.navy};">
<tr>
<td class="shell" align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr>
<td style="padding:0 4px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td width="32" height="32" align="center" valign="middle" bgcolor="${color.blue}" style="width:32px;height:32px;border-radius:10px;background-color:${color.blue};font-family:${font.sans};font-size:14px;line-height:32px;font-weight:800;color:#ffffff;">D</td>
<td valign="middle" style="padding-left:10px;font-family:${font.sans};font-size:16px;line-height:32px;font-weight:800;color:#ffffff;">${BRAND}</td>
</tr>
</table>
</td>
</tr>
<tr>
<td class="card" bgcolor="${color.surface}" style="padding:40px;border:1px solid ${color.line};border-radius:16px;background-color:${color.surface};">
${options.content}
</td>
</tr>
<tr>
<td style="padding:28px 4px 0;">
<p style="margin:0 0 12px;font-family:${font.serif};font-size:16px;line-height:1.4;color:${color.tagline};">${TAGLINE}</p>
<p style="margin:0 0 6px;font-family:${font.sans};font-size:12px;line-height:1.6;color:${color.muted};">${escapeHtml(options.reason)}</p>
<p style="margin:0;font-family:${font.sans};font-size:12px;line-height:1.6;color:${color.muted};">&copy; ${year} ${BRAND_NOWRAP}. Todos os direitos reservados.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

function formatValidity(minutes: number): string {
  if (minutes % 60 !== 0) {
    return `${minutes} minutos`;
  }
  const hours = minutes / 60;
  return hours === 1 ? '1 hora' : `${hours} horas`;
}

function oneTimeLinkEmail(options: {
  subject: string;
  title: string;
  request: string;
  instruction?: string;
  action: string;
  url: string;
  validityMinutes: number;
  reassurance: string;
  reason: string;
}): EmailMessage {
  const validityNote = `O link vale por ${formatValidity(options.validityMinutes)} e só pode ser usado uma vez.`;
  const content = [
    heading(options.title),
    paragraph([options.request, options.instruction].filter(Boolean).join(' ')),
    button(options.action, options.url),
    `<div style="height:16px;line-height:16px;font-size:16px;">&nbsp;</div>`,
    finePrint(validityNote),
    divider(),
    finePrint(`${strong(NOT_YOU)} ${options.reassurance}`, 20),
    fallbackLink(options.url),
  ].join('\n');

  return {
    subject: options.subject,
    text: [
      options.request,
      '',
      `${options.action}: ${options.url}`,
      '',
      validityNote,
      `${NOT_YOU} ${options.reassurance}`,
    ].join('\n'),
    html: layout({
      title: options.title,
      preheader: validityNote,
      content,
      reason: options.reason,
    }),
  };
}

export function passwordResetEmail(
  resetUrl: string,
  validityMinutes: number,
): EmailMessage {
  return oneTimeLinkEmail({
    subject: `Redefina sua senha da ${BRAND}`,
    title: 'Redefina sua senha',
    request: `Recebemos um pedido para redefinir a senha da sua conta ${BRAND_NOWRAP}.`,
    instruction: 'Use o botão abaixo para escolher uma nova.',
    action: 'Redefinir senha',
    url: resetUrl,
    validityMinutes,
    reassurance: 'Ignore este e-mail. Sua senha continua a mesma.',
    reason: `Você recebeu este e-mail porque foi pedida a redefinição de senha de uma conta ${BRAND_NOWRAP} com este endereço.`,
  });
}

export function passwordChangedEmail(recoverUrl: string): EmailMessage {
  const summary = `A senha da sua conta ${BRAND_NOWRAP} acabou de ser alterada. Todas as sessões abertas foram encerradas.`;
  const recovery =
    'Alguém pode ter acesso ao seu e-mail. Redefina a senha agora e troque também a senha do seu e-mail.';
  const content = [
    heading('Sua senha foi alterada'),
    paragraph(summary),
    divider(),
    finePrint(`${strong(NOT_YOU)} ${recovery}`),
    button('Redefinir senha', recoverUrl),
  ].join('\n');

  return {
    subject: `Sua senha da ${BRAND} foi alterada`,
    text: [
      summary,
      '',
      `${NOT_YOU} ${recovery}`,
      `Redefinir senha: ${recoverUrl}`,
    ].join('\n'),
    html: layout({
      title: 'Sua senha foi alterada',
      preheader: 'Se não foi você, redefina a senha agora.',
      content,
      reason: `Você recebeu este e-mail porque a senha de uma conta ${BRAND_NOWRAP} com este endereço foi alterada.`,
    }),
  };
}

const PERSON_NAME = /^\p{L}[\p{L}'’-]{0,39}$/u;

export function welcomeEmail(name: string, profileUrl: string): EmailMessage {
  const firstName = name.trim().split(/\s+/)[0];
  const greeting = PERSON_NAME.test(firstName)
    ? `Boas-vindas, ${firstName}.`
    : 'Boas-vindas.';
  const intro = `Sua conta ${BRAND_NOWRAP} está criada. Falta só dizer como você vai usar a plataforma: como hóspede, como proprietário ou os dois.`;
  const content = [
    heading(greeting),
    paragraph(intro),
    button('Escolher meu perfil', profileUrl),
    divider(),
    finePrint(
      `${strong('Para se hospedar.')} Veja os quartos e suítes de cada imóvel e salve os que mais combinam com você.`,
      14,
    ),
    finePrint(
      `${strong('Para anunciar.')} Cadastre seu imóvel, adicione quartos com fotos e valores e publique quando estiver pronto.`,
    ),
  ].join('\n');

  return {
    subject: `Boas-vindas à ${BRAND}`,
    text: [greeting, '', intro, '', `Escolha seu perfil: ${profileUrl}`].join(
      '\n',
    ),
    html: layout({
      title: `Boas-vindas à ${BRAND}`,
      preheader:
        'Sua conta está criada. Escolha seu perfil para começar a usar.',
      content,
      reason: `Você recebeu este e-mail porque uma conta ${BRAND_NOWRAP} foi criada com este endereço.`,
    }),
  };
}

export function emailConfirmationEmail(
  confirmUrl: string,
  validityMinutes: number,
): EmailMessage {
  return oneTimeLinkEmail({
    subject: `Confirme seu e-mail na ${BRAND}`,
    title: 'Confirme seu e-mail',
    request: `Confirme que este e-mail é seu para usar a ${BRAND_NOWRAP}.`,
    action: 'Confirmar e-mail',
    url: confirmUrl,
    validityMinutes,
    reassurance:
      'Ignore este e-mail. Nada acontece com este endereço sem a confirmação.',
    reason: `Você recebeu este e-mail porque este endereço foi informado em um cadastro na ${BRAND_NOWRAP}.`,
  });
}

export function accountExistsEmail(
  loginUrl: string,
  recoverUrl: string,
): EmailMessage {
  const summary = `Alguém tentou criar uma conta ${BRAND_NOWRAP} com este e-mail, mas ele já tem uma conta. Nenhuma conta nova foi criada.`;
  const forgot = 'Esqueceu a senha?';
  const reassurance =
    'Ignore este e-mail. Sua conta e sua senha continuam as mesmas.';
  const content = [
    heading('Você já tem uma conta'),
    paragraph(summary),
    button('Entrar', loginUrl),
    divider(),
    finePrint(
      `${strong(forgot)} ${link('Redefina sua senha', recoverUrl)}.`,
      14,
    ),
    finePrint(`${strong(NOT_YOU)} ${reassurance}`),
  ].join('\n');

  return {
    subject: `Você já tem uma conta na ${BRAND}`,
    text: [
      summary,
      '',
      `Entrar: ${loginUrl}`,
      `${forgot} Redefina sua senha: ${recoverUrl}`,
      '',
      `${NOT_YOU} ${reassurance}`,
    ].join('\n'),
    html: layout({
      title: 'Você já tem uma conta',
      preheader: 'Nenhuma conta nova foi criada. Entre com a que você já tem.',
      content,
      reason: `Você recebeu este e-mail porque este endereço foi informado em um cadastro na ${BRAND_NOWRAP}.`,
    }),
  };
}
