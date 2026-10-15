// The email with the result: subject, plain text and HTML, built only from content.json and
// the checked fields of the submission. Pure functions. Table layout with inline styles so
// it survives Gmail, Apple Mail and Outlook (a conditional 600 px table for Outlook's Word
// engine, which ignores max-width); colours are solid (email clients ignore transparency),
// fonts are Georgia and Arial (web fonts are unreliable in email).

import { formatAverage, fillTemplate, growLineKind } from '../../src/app/scoring.js';

export const EMAIL_WIDTH = 600;

const RGB = {
  aubergine: [94, 26, 77],
  porcelain: [250, 248, 245],
  champagne: [239, 220, 172],
};
export const EMAIL_COLOURS = {
  aubergine: '#5E1A4D',
  navy: '#1E2A47',
  porcelain: '#FAF8F5',
  gold: '#B89B5E',
  warmGrey: '#E4E2DD',
  muted: '#545B70',
  onAubergine: '#F3E9EF',
  white: '#FFFFFF',
};

// Same numbers as TILE_HEIGHTS in src/app/mosaic.js; a test keeps them equal.
export const EMAIL_TILE_HEIGHTS = { F: [62, 46, 54, 50], P: [48, 60, 46, 58], V: [56, 50, 62, 44] };
const TILE_GAP = 6;

const HEADING_FONT = "Georgia, 'Times New Roman', serif";
const TEXT_FONT = 'Arial, Helvetica, sans-serif';

// Same formula as tileAlpha in src/app/mosaic.js; a test keeps them equal.
export function emailTileAlpha(score) {
  return 0.12 + (0.88 * (score - 1)) / 9;
}

function toHex(channel) {
  const value = Math.max(0, Math.min(255, Math.round(channel)));
  return (value < 16 ? '0' : '') + value.toString(16).toUpperCase();
}

// The colour of `rgb` drawn with opacity `alpha` over `base`, as a solid hex colour.
export function blend(rgb, base, alpha) {
  return '#' + rgb.map((channel, i) => toHex(base[i] + (channel - base[i]) * alpha)).join('');
}

export function tileHex(score) {
  return blend(RGB.aubergine, RGB.porcelain, emailTileAlpha(score));
}

export const NOTE_BACKGROUND = blend(RGB.champagne, RGB.porcelain, 0.5);

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Adds query parameters to a link without the URL class (not available in Apps Script).
export function withParams(base, params) {
  const pairs = Object.keys(params).map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
  if (!pairs.length) return base;
  const hashAt = base.indexOf('#');
  const link = hashAt >= 0 ? base.slice(0, hashAt) : base;
  const hash = hashAt >= 0 ? base.slice(hashAt) : '';
  return link + (link.indexOf('?') >= 0 ? '&' : '?') + pairs.join('&') + hash;
}

export function emailCalendlyLink(base, src, resultKey) {
  return withParams(base, {
    utm_source: 'mosaic-snapshot',
    utm_medium: 'email',
    utm_campaign: src || 'direct',
    utm_content: resultKey,
  });
}

export function pillarInText(content, key) {
  const pillar = content.pillars.filter((candidate) => candidate.key === key)[0];
  return pillar ? pillar.in_text : '';
}

export function pillarShort(content, key) {
  if (key === 'balanced') return 'Balanced';
  const pillar = content.pillars.filter((candidate) => candidate.key === key)[0];
  return pillar ? pillar.short : key;
}

// Everything the two renderers share, in the order of the email.
function emailParts(content, submission, evaluation) {
  const e = content.email;
  const r = content.result;
  const key = evaluation.result;
  const texts = content.results[key];
  const kind = growLineKind(key, submission.grow);
  const growLine = kind
    ? fillTemplate(kind === 'match' ? r.grow_match : r.grow_mismatch, {
      grow: pillarInText(content, submission.grow),
      focus: pillarInText(content, key),
    })
    : '';
  const sections = [
    { label: r.section_labels.what_it_means, paragraphs: [texts.what_it_means] },
    key === 'balanced'
      ? { label: r.section_labels.whats_next, paragraphs: texts.whats_next }
      : { label: r.section_labels.how_it_affects, paragraphs: texts.how_it_affects },
  ];
  return {
    key,
    texts,
    subject: fillTemplate(e.subject, { name: submission.name }),
    preheader: e.preheader,
    wordmark: content.intro.wordmark,
    greeting: fillTemplate(e.greeting, { name: submission.name }),
    intro: e.intro,
    scoresTitle: e.scores_title,
    focusLabel: r.focus_label,
    scoreSuffix: r.score_suffix,
    columns: content.pillars.map((pillar) => ({
      key: pillar.key,
      short: pillar.short,
      average: formatAverage(evaluation.averages[pillar.key]),
      scores: evaluation.grouped[pillar.key],
      isFocus: evaluation.focus === pillar.key,
    })),
    headline: texts.headline,
    growLine,
    sections,
    stepsLabel: r.section_labels.first_steps,
    steps: texts.steps,
    ctaQuestion: texts.cta_question,
    ctaButton: r.cta_button,
    ctaNote: r.cta_note,
    link: emailCalendlyLink(content.links.calendly, submission.src, key),
    closing: e.closing,
    signatureName: r.signature_name,
    signatureTitle: r.signature_title,
    mainSite: content.links.main_site,
    legalLine: r.legal_line,
    whyLine: e.why_line,
  };
}

export function renderText(content, submission, evaluation) {
  const p = emailParts(content, submission, evaluation);
  const lines = [p.preheader, p.wordmark, '', p.greeting, p.intro, '', p.scoresTitle];
  const focus = p.columns.filter((column) => column.isFocus)[0];
  if (focus) lines.push(`${p.focusLabel}: ${focus.short}`);
  p.columns.forEach((column) => lines.push(`${column.short}: ${column.average} ${p.scoreSuffix}`));
  lines.push('', p.headline);
  if (p.growLine) lines.push(p.growLine);
  p.sections.forEach((section) => {
    lines.push('', section.label);
    section.paragraphs.forEach((paragraph) => lines.push(paragraph));
  });
  lines.push('', p.stepsLabel);
  p.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  lines.push('', p.ctaQuestion, `${p.ctaButton}: ${p.link}`, p.ctaNote);
  lines.push('', p.closing, p.signatureName, p.signatureTitle, p.mainSite);
  lines.push('', p.legalLine, p.whyLine);
  return lines.join('\n');
}

const TEXT_STYLE = `font-family:${TEXT_FONT};font-size:16px;line-height:24px;color:${EMAIL_COLOURS.navy};`;
const SMALL_STYLE = `font-family:${TEXT_FONT};font-size:12px;line-height:18px;color:${EMAIL_COLOURS.muted};`;
const LABEL_STYLE = `font-family:${TEXT_FONT};font-size:12px;line-height:18px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${EMAIL_COLOURS.aubergine};`;

function cell(style, inner, attrs) {
  return `<td${attrs ? ` ${attrs}` : ''} style="${style}">${inner}</td>`;
}

function row(style, inner, attrs) {
  return `<tr>${cell(style, inner, attrs)}</tr>`;
}

function spacer(height) {
  return `<tr><td height="${height}" style="height:${height}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

function mosaicColumn(column, parts, showLabels) {
  const rows = [];
  if (showLabels) {
    const label = column.isFocus ? escapeHtml(parts.focusLabel) : '&nbsp;';
    rows.push(`<tr><td height="18" style="height:18px;font-family:${TEXT_FONT};font-size:11px;line-height:18px;font-weight:bold;letter-spacing:1px;color:${EMAIL_COLOURS.gold};">${label}</td></tr>`);
    rows.push(spacer(4));
  }
  column.scores.forEach((score, i) => {
    const height = EMAIL_TILE_HEIGHTS[column.key][i];
    const colour = tileHex(score);
    if (i > 0) rows.push(spacer(TILE_GAP));
    rows.push(`<tr><td height="${height}" bgcolor="${colour}" style="height:${height}px;background-color:${colour};border-radius:6px;font-size:0;line-height:0;">&nbsp;</td></tr>`);
  });
  rows.push(spacer(8));
  rows.push(row(`font-family:${TEXT_FONT};font-size:12px;line-height:18px;font-weight:bold;color:${EMAIL_COLOURS.navy};`, escapeHtml(column.short)));
  rows.push(row(`font-family:${HEADING_FONT};font-size:20px;line-height:26px;color:${EMAIL_COLOURS.aubergine};`,
    `${escapeHtml(column.average)} <span style="font-family:${TEXT_FONT};font-size:12px;color:${EMAIL_COLOURS.muted};">${escapeHtml(parts.scoreSuffix)}</span>`));
  return `<td width="33%" valign="top" style="padding:0 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table></td>`;
}

function sectionHtml(section) {
  const paragraphs = section.paragraphs
    .map((paragraph, i) => row(`${TEXT_STYLE}padding:${i ? 8 : 4}px 0 0;`, escapeHtml(paragraph)))
    .join('');
  return `<tr><td style="padding:20px 0 0;border-top:1px solid ${EMAIL_COLOURS.warmGrey};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row(LABEL_STYLE, escapeHtml(section.label))}${paragraphs}</table></td></tr>`;
}

export function renderHtml(content, submission, evaluation) {
  const p = emailParts(content, submission, evaluation);
  const showLabels = p.columns.some((column) => column.isFocus);
  const body = [];
  body.push(row(`font-family:${HEADING_FONT};font-size:12px;line-height:18px;letter-spacing:2px;color:${EMAIL_COLOURS.aubergine};padding:0 0 24px;`, escapeHtml(p.wordmark)));
  body.push(row(`${TEXT_STYLE}padding:0 0 8px;`, escapeHtml(p.greeting)));
  body.push(row(`${TEXT_STYLE}padding:0 0 24px;`, escapeHtml(p.intro)));
  body.push(row(`font-family:${HEADING_FONT};font-size:20px;line-height:26px;color:${EMAIL_COLOURS.navy};padding:0 0 12px;`, escapeHtml(p.scoresTitle)));
  body.push(`<tr><td style="padding:0 0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${p.columns.map((column) => mosaicColumn(column, p, showLabels)).join('')}</tr></table></td></tr>`);
  body.push(row(`font-family:${HEADING_FONT};font-size:24px;line-height:30px;color:${EMAIL_COLOURS.navy};padding:0 0 16px;`, escapeHtml(p.headline)));
  if (p.growLine) {
    body.push(`<tr><td style="padding:0 0 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${NOTE_BACKGROUND}" style="background-color:${NOTE_BACKGROUND};border-radius:10px;padding:14px 16px;font-family:${TEXT_FONT};font-size:15px;line-height:22px;color:${EMAIL_COLOURS.navy};">${escapeHtml(p.growLine)}</td></tr></table></td></tr>`);
  }
  p.sections.forEach((section) => body.push(sectionHtml(section)));
  const steps = p.steps.map((step) => `<li style="${TEXT_STYLE}padding:0 0 8px 4px;">${escapeHtml(step)}</li>`).join('');
  body.push(`<tr><td style="padding:20px 0 0;border-top:1px solid ${EMAIL_COLOURS.warmGrey};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row(LABEL_STYLE, escapeHtml(p.stepsLabel))}<tr><td style="padding:4px 0 0;"><ol style="margin:0;padding:0 0 0 22px;">${steps}</ol></td></tr></table></td></tr>`);
  body.push(`<tr><td style="padding:28px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLOURS.aubergine}" style="background-color:${EMAIL_COLOURS.aubergine};border-radius:12px;"><tr><td style="padding:24px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`
    + row(`font-family:${HEADING_FONT};font-size:20px;line-height:26px;color:${EMAIL_COLOURS.white};padding:0 0 16px;`, escapeHtml(p.ctaQuestion))
    + `<tr><td style="padding:0 0 12px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${EMAIL_COLOURS.gold}" style="background-color:${EMAIL_COLOURS.gold};border-radius:10px;padding:16px 28px;"><a href="${escapeHtml(p.link)}" style="display:inline-block;font-family:${TEXT_FONT};font-size:16px;font-weight:bold;color:${EMAIL_COLOURS.navy};text-decoration:none;">${escapeHtml(p.ctaButton)}</a></td></tr></table></td></tr>`
    + row(`font-family:${TEXT_FONT};font-size:13px;line-height:18px;color:${EMAIL_COLOURS.onAubergine};`, escapeHtml(p.ctaNote))
    + `</table></td></tr></table></td></tr>`);
  body.push(row(`${TEXT_STYLE}padding:28px 0 4px;`, escapeHtml(p.closing)));
  body.push(row(`${TEXT_STYLE}font-weight:bold;`, `<a href="${escapeHtml(p.mainSite)}" style="color:${EMAIL_COLOURS.navy};text-decoration:underline;">${escapeHtml(p.signatureName)}</a>`));
  body.push(row(`font-family:${TEXT_FONT};font-size:13px;line-height:20px;color:${EMAIL_COLOURS.muted};`, escapeHtml(p.signatureTitle)));
  body.push(row(`${SMALL_STYLE}padding:24px 0 0;border-top:1px solid ${EMAIL_COLOURS.warmGrey};`, escapeHtml(p.legalLine)));
  body.push(row(`${SMALL_STYLE}padding:4px 0 0;`, escapeHtml(p.whyLine)));

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(p.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLOURS.porcelain};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${EMAIL_COLOURS.porcelain};mso-hide:all;">${escapeHtml(p.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLOURS.porcelain}" style="background-color:${EMAIL_COLOURS.porcelain};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${EMAIL_WIDTH}px;">
${body.join('\n')}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

export function renderEmail(content, submission, evaluation) {
  const subject = fillTemplate(content.email.subject, { name: submission.name });
  return {
    subject,
    text: renderText(content, submission, evaluation),
    html: renderHtml(content, submission, evaluation),
  };
}

// The plain-text alert to Julia about one new response.
export function renderNotification(content, submission, evaluation) {
  const resultName = pillarShort(content, evaluation.result);
  const subject = fillTemplate(content.email.notify_subject, { name: submission.name, result: resultName });
  const lines = [
    `Name: ${submission.name}`,
    `Email: ${submission.email}`,
    `Result: ${resultName}`,
    `Priority: ${pillarShort(content, submission.grow)}`,
  ];
  content.pillars.forEach((pillar) => lines.push(`${pillar.short}: ${formatAverage(evaluation.averages[pillar.key])} ${content.result.score_suffix}`));
  lines.push(`Newsletter consent: ${submission.consent ? 'Yes' : 'No'}`);
  lines.push(`Source: ${submission.src || 'direct'}`);
  return { subject, text: lines.join('\n') };
}
