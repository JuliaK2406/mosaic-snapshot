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

export function renderIcon() {
  const icon = el('div', { class: 'brand__icon', 'aria-hidden': 'true' });
  for (const alpha of ICON_ALPHAS) {
    const cell = el('span');
    cell.style.background = `rgba(var(--aubergine-rgb), ${alpha})`;
    icon.append(cell);
  }
  return icon;
}

export function renderTeaser() {
  const teaser = el('div', { class: 'teaser', 'aria-hidden': 'true' });
  TEASER_SCORES.forEach((scores, column) => {
    const col = el('div', { class: 'teaser__col' });
    scores.forEach((score, row) => col.append(tile('teaser__tile', TEASER_HEIGHTS[column][row], tileAlpha(score))));
    teaser.append(col);
  });
  return teaser;
}

export function renderMosaic(content, evaluation) {
  const grid = el('div', { class: 'mosaic' + (evaluation.focus ? '' : ' mosaic--balanced') });
  let questionIndex = 0;
  for (const pillar of content.pillars) {
    const isFocus = evaluation.focus === pillar.key;
    const column = el('div', { class: 'mosaic__col' + (isFocus ? ' is-focus' : '') });
    if (evaluation.focus) {
      const flag = el('span', { class: 'mosaic__flag' });
      if (isFocus) append(flag, [el('span', { class: 'mosaic__dot', 'aria-hidden': 'true' }), content.result.focus_label]);
      column.append(flag);
    }
    const tiles = el('div', { class: 'mosaic__tiles', 'aria-hidden': 'true' });
    pillar.items.forEach((item, position) => {
      const score = evaluation.grouped[pillar.key][position];
      const node = tile('mosaic__tile', TILE_HEIGHTS[pillar.key][position], tileAlpha(score));
      node.title = `${item.title}: ${score} ${content.result.score_suffix}`;
      node.style.animationDelay = `${tileDelay(questionIndex)}ms`;
      tiles.append(node);
      questionIndex += 1;
    });
    column.append(tiles);
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
