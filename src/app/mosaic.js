// Draws the mosaic: three columns, four tiles each, one tile per question.
// Also the small 3x3 brand icon and the decorative teaser on the first screen.

import { el, append } from './dom.js';
import { formatAverage } from './scoring.js';

export const TILE_HEIGHTS = { F: [62, 46, 54, 50], P: [48, 60, 46, 58], V: [56, 50, 62, 44] };
export const TILE_RANKS = [0, 5, 2, 9, 4, 7, 1, 10, 3, 8, 6, 11];
export const TILE_DELAY_BASE_MS = 150;
export const TILE_DELAY_STEP_MS = 85;
export const ICON_ALPHAS = [1, 0.45, 0.8, 0.3, 0.9, 0.55, 0.7, 0.2, 1];
export const TEASER_SCORES = [[8, 4, 6, 5], [7, 9, 5, 6], [4, 6, 3, 7]];
export const TEASER_HEIGHTS = [[34, 24, 30, 26], [26, 34, 24, 30], [30, 26, 36, 22]];

// Opacity of the aubergine tile: 0.12 for a score of 1, 1 for a score of 10.
export function tileAlpha(score) {
  return 0.12 + (0.88 * (score - 1)) / 9;
}

export function tileDelay(questionIndex) {
  return TILE_DELAY_BASE_MS + TILE_RANKS[questionIndex] * TILE_DELAY_STEP_MS;
}

function tile(className, height, alpha) {
  const node = el('div', { class: className });
  node.style.height = `${height}px`;
  node.style.background = `rgba(var(--aubergine-rgb), ${alpha.toFixed(3)})`;
  return node;
}

// Same tile, but its height follows the --mosaic-scale token so CSS can resize the whole mosaic.
function scaledTile(className, height, alpha) {
  const node = el('div', { class: className });
  node.style.height = `calc(${height}px * var(--mosaic-scale, 1))`;
  if (alpha !== null) node.style.background = `rgba(var(--aubergine-rgb), ${alpha.toFixed(3)})`;
  return node;
}

export function renderIcon() {
  const icon = el('div', { class: 'brand__icon', 'aria-hidden': 'true' });
  for (const alpha of ICON_ALPHAS) {
    const cell = el('span');
    cell.style.background = `rgba(var(--aubergine-rgb), ${alpha})`;
    icon.append(cell);
  }
  return icon;
}

// The decorative mosaic of the first screen. The large variant (wide screens) scales with
// --mosaic-scale and assembles tile by tile with the same delays as the result.
export function renderTeaser({ large = false } = {}) {
  const teaser = el('div', { class: large ? 'teaser teaser--large' : 'teaser', 'aria-hidden': 'true' });
  let index = 0;
  TEASER_SCORES.forEach((scores, column) => {
    const col = el('div', { class: 'teaser__col' });
    scores.forEach((score, row) => {
      const height = TEASER_HEIGHTS[column][row];
      const node = large ? scaledTile('teaser__tile', height, tileAlpha(score)) : tile('teaser__tile', height, tileAlpha(score));
      if (large) node.style.animationDelay = `${tileDelay(index)}ms`;
      index += 1;
      col.append(node);
    });
    teaser.append(col);
  });
  return teaser;
}

// The live mosaic beside the questions on wide screens: twelve empty tiles that fill with one
// flat tone as the answers come in. Decorative only; the counter already tells the progress.
export function renderLiveMosaic(content) {
  const grid = el('div', { class: 'mosaic mosaic--live', 'aria-hidden': 'true' });
  const tiles = [];
  for (const pillar of content.pillars) {
    const column = el('div', { class: 'mosaic__col' });
    const list = el('div', { class: 'mosaic__tiles' });
    pillar.items.forEach((item, position) => {
      const node = scaledTile('mosaic__tile', TILE_HEIGHTS[pillar.key][position], null);
      list.append(node);
      tiles.push(node);
    });
    column.append(list, el('div', { class: 'mosaic__meta' }, [el('span', { class: 'mosaic__name', text: pillar.short })]));
    grid.append(column);
  }
  return { grid, tiles };
}

// settle: mark the already answered tiles as settled so they do not animate again on a rebuild.
export function updateLiveMosaic(tiles, answers, currentIndex, { settle = false } = {}) {
  tiles.forEach((node, index) => {
    const answered = Number.isInteger(answers[index]);
    node.classList.toggle('is-answered', answered);
    node.classList.toggle('is-current', index === currentIndex);
    if (settle && answered) node.classList.add('is-settled');
  });
}

// plain: the same tiles with the real shades, but no scores, no focus label, no animation and
// no labels for assistive tech. Used blurred on the email screen as a promise of the result.
export function renderMosaic(content, evaluation, { plain = false } = {}) {
  const grid = plain
    ? el('div', { class: 'mosaic mosaic--plain', 'aria-hidden': 'true' })
    : el('div', { class: 'mosaic' + (evaluation.focus ? '' : ' mosaic--balanced') });
  let questionIndex = 0;
  for (const pillar of content.pillars) {
    const isFocus = !plain && evaluation.focus === pillar.key;
    const column = el('div', { class: 'mosaic__col' + (isFocus ? ' is-focus' : '') });
    if (!plain && evaluation.focus) {
      const flag = el('span', { class: 'mosaic__flag' });
      if (isFocus) append(flag, [el('span', { class: 'mosaic__dot', 'aria-hidden': 'true' }), content.result.focus_label]);
      column.append(flag);
    }
    const tiles = el('div', { class: 'mosaic__tiles' });
    pillar.items.forEach((item, position) => {
      const score = evaluation.grouped[pillar.key][position];
      if (plain) {
        tiles.append(scaledTile('mosaic__tile', TILE_HEIGHTS[pillar.key][position], tileAlpha(score)));
        return;
      }
      const node = tile('mosaic__tile', TILE_HEIGHTS[pillar.key][position], tileAlpha(score));
      const label = `${item.title}: ${score} ${content.result.score_suffix}`;
      node.title = label;
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', label);
      node.style.animationDelay = `${tileDelay(questionIndex)}ms`;
      tiles.append(node);
      questionIndex += 1;
    });
    column.append(tiles);
    if (plain) {
      grid.append(column);
      continue;
    }
    column.append(el('div', { class: 'mosaic__meta' }, [
      el('span', { class: 'mosaic__name', text: pillar.short }),
      el('span', { class: 'mosaic__score' }, [
        formatAverage(evaluation.averages[pillar.key]),
        el('span', { class: 'mosaic__suffix', text: ` ${content.result.score_suffix}` }),
      ]),
    ]));
    grid.append(column);
  }
  return grid;
}

export function renderLegend(content) {
  return el('div', { class: 'legend' }, [
    el('span', { text: content.result.legend_low }),
    el('div', { class: 'legend__bar', 'aria-hidden': 'true' }),
    el('span', { text: content.result.legend_high }),
  ]);
}
