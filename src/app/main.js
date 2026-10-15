// Screens and transitions. Every text comes from the content JSON embedded at build time.
// No innerHTML anywhere: see dom.js.

import { el, append, svg } from './dom.js';
import { evaluate, growLineKind, fillTemplate } from './scoring.js';
import { renderIcon, renderTeaser, renderMosaic, renderLegend, renderLiveMosaic, updateLiveMosaic } from './mosaic.js';
import { readSrc, calendlyUrl, buildPayload, sendPayload } from './submit.js';

const content = JSON.parse(document.getElementById('snapshot-content').textContent);
const root = document.getElementById('app');

const questions = content.pillars.flatMap((pillar) => pillar.items.map((item) => ({ pillar, item })));
const TOTAL_STEPS = questions.length + 1;
const TRANSITION_MS = 250;
const UNWIND_FALLBACK_MS = 600;
const BACK_LOCK_MS = 500;
const NAME_MAX_LENGTH = 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAMPLE = { answers: [4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6], grow: 'V' };

const src = readSrc(window.location.search);

const state = {
  step: 'intro',
  qi: 0,
  answers: new Array(questions.length).fill(null),
  grow: null,
  name: '',
  email: '',
  consent: false,
  sample: false,
  evaluation: null,
  session: newSession(),
  depth: 0,
};

let transition = null;   // timer of the 250 ms highlight before the next screen
let unwinding = null;    // callback waiting for history.go() to land on the first screen
let backLock = null;     // ignores a second Back tap until the first one has landed
let questionRefs = null; // live nodes of the mounted question screen
let growButtons = null;   // cards of the mounted question 13, for the keyboard
let growNext = null;      // the Next button of question 13
let nextLock = null;      // set by a Next tap until the next screen has been painted
let submitting = false;  // a result is being prepared; further submits are ignored

// ---------- history ----------

function newSession() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function historyEntry(step) {
  return { step, qi: state.qi, session: state.session, depth: state.depth };
}

function pushEntry(step) {
  state.depth += 1;
  window.history.pushState(historyEntry(step), '');
}

function replaceEntry(step) {
  window.history.replaceState(historyEntry(step), '');
}

function clearTransition() {
  if (transition) {
    clearTimeout(transition);
    transition = null;
  }
}

function releaseBackLock() {
  if (backLock) {
    clearTimeout(backLock);
    backLock = null;
  }
}

function resetAnswers() {
  state.answers.fill(null);
  state.qi = 0;
  state.grow = null;
  state.name = '';
  state.email = '';
  state.consent = false;
  state.sample = false;
  state.evaluation = null;
  state.session = newSession();
}

function go(step, patch = {}) {
  clearTransition();
  Object.assign(state, patch, { step });
  pushEntry(step);
  render();
}

function goBack() {
  clearTransition();
  if (state.depth > 0) lockedBack();
  else showIntro();
}

// One history.back() at a time: a second tap before the popstate lands would leave the site.
function lockedBack() {
  if (backLock) return;
  backLock = setTimeout(releaseBackLock, BACK_LOCK_MS);
  window.history.back();
}

// Forward without changing the answer: to the next question, to question 13, or from
// question 13 to the email screen. Only when the current step already has an answer,
// never during the 250 ms highlight, never while a Back is still landing, and not again
// before the next screen has been painted: a doubled event moves one step, a second
// real tap on the painted screen moves one more.
function canGoNext() {
  if (transition || backLock || nextLock) return false;
  if (state.step === 'q') return Number.isInteger(state.answers[state.qi]);
  if (state.step === 'grow') return Boolean(state.grow);
  return false;
}

function goNext() {
  if (!canGoNext()) return;
  nextLock = true;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      nextLock = null;
    });
  });
  if (state.step === 'grow') {
    go('email');
    return;
  }
  if (state.qi < questions.length - 1) go('q', { qi: state.qi + 1 });
  else go('grow');
}

function showIntro() {
  state.step = 'intro';
  state.depth = 0;
  replaceEntry('intro');
  render();
}

// Walks history back to the first screen, then runs fn. Called before the result is
// shown, so that the phone's back gesture from the result leads to the first screen.
function unwindThen(fn) {
  const depth = state.depth;
  if (depth <= 0) {
    fn();
    return;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    unwinding = null;
    state.depth = 0;
    fn();
  };
  unwinding = finish;
  setTimeout(finish, UNWIND_FALLBACK_MS);
  window.history.go(-depth);
}

window.addEventListener('popstate', (event) => {
  releaseBackLock();
  if (unwinding) {
    unwinding();
    return;
  }
  clearTransition();
  const target = event.state;
  if (state.step === 'result') resetAnswers();
  const stale = !target || target.session !== state.session || (target.step === 'result' && !state.evaluation);
  if (stale) {
    showIntro();
    return;
  }
  state.depth = target.depth;
  state.step = target.step;
  if (target.step === 'q') state.qi = target.qi;
  render();
});

// ---------- keyboard, questions 1 to 13 only ----------

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (state.step !== 'q' && state.step !== 'grow') return;
  if (event.target && event.target.closest && event.target.closest('input, textarea, select, [contenteditable]')) return;
  const key = event.key;
  if (key === 'ArrowLeft' || key === 'Backspace') {
    event.preventDefault();
    goBack();
    return;
  }
  if (key === 'ArrowRight') {
    event.preventDefault();
    goNext();
    return;
  }
  if (!/^[0-9]$/.test(key)) return;
  event.preventDefault();
  if (state.step === 'q') {
    pick(key === '0' ? 10 : Number(key));
    return;
  }
  const option = content.grow_question.options[Number(key) - 1];
  if (option && growButtons) pickGrow(option.key, growButtons);
});

// ---------- rendering ----------

const SCREENS = { intro: introScreen, q: questionScreen, grow: growScreen, email: emailScreen, result: resultScreen };

function render() {
  const previous = root.dataset.step;
  if (state.step === 'q' && previous === 'q' && questionRefs && root.contains(questionRefs.title)) {
    updateQuestion();
  } else {
    questionRefs = null;
    growButtons = null;
    growNext = null;
    root.replaceChildren(SCREENS[state.step]());
    if (state.step === 'result') fitResultColumn();
  }
  root.dataset.step = state.step;
  root.dataset.qi = state.step === 'q' ? String(state.qi) : '';
  window.scrollTo(0, 0);
  const heading = root.querySelector('[data-focus-target]');
  if (heading) heading.focus({ preventScroll: true });
}

function pillarInText(key) {
  const pillar = content.pillars.find((candidate) => candidate.key === key);
  return pillar ? pillar.in_text : '';
}

function backIcon() {
  const icon = svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' });
  icon.append(svg('path', {
    d: 'M13 8H3M7 4 3 8l4 4',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.6,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));
  return icon;
}

function nextIcon() {
  const icon = svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' });
  icon.append(svg('path', {
    d: 'M3 8h10M9 4l4 4-4 4',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.6,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));
  return icon;
}

// Back on the left, the counter in the middle, Next on the right. Next starts hidden
// (not shown, not focusable, not read out) and takes no space either way: the three
// cells of the bar are fixed, so showing or hiding it moves nothing.
function topBar({ step, showProgress, next }) {
  const bar = el('div', { class: 'topbar' }, [
    el('button', { type: 'button', class: 'back', onclick: goBack }, [backIcon(), content.question.back_label]),
  ]);
  const nextButton = next ? el('button', { type: 'button', class: 'next', hidden: true, onclick: goNext }, [content.question.next_label, nextIcon()]) : null;
  if (!showProgress) {
    if (nextButton) bar.append(el('span', { class: 'topbar__count' }), nextButton);
    return { bar, count: null, fill: null, progress: null, next: nextButton };
  }
  const count = el('span', { class: 'topbar__count', id: 'progress-count' });
  bar.append(count);
  if (nextButton) bar.append(nextButton);
  const fill = el('div', { class: 'progress__fill' });
  const progress = el('div', {
    class: 'progress',
    role: 'progressbar',
    'aria-labelledby': 'progress-count',
    'aria-valuemin': '0',
    'aria-valuemax': String(TOTAL_STEPS),
  }, [fill]);
  const refs = { bar, count, fill, progress, next: nextButton };
  setProgress(refs, step);
  return refs;
}

function setProgress(refs, step) {
  refs.count.textContent = `${step} / ${TOTAL_STEPS}`;
  refs.fill.style.width = `${Math.round((step / TOTAL_STEPS) * 100)}%`;
  refs.progress.setAttribute('aria-valuenow', String(step));
}

// ---------- screen 1: intro ----------

function introScreen() {
  const screen = el('section', { class: 'screen screen--intro' });
  const main = el('div', { class: 'screen__main' }, [
    el('div', { class: 'brand' }, [renderIcon(), el('span', { class: 'brand__wordmark', text: content.intro.wordmark })]),
    el('div', { class: 'intro__head' }, [
      el('h1', { class: 'display', tabindex: '-1', 'data-focus-target': '', text: content.intro.headline }),
      el('p', { class: 'lead', text: content.intro.subhead }),
      content.intro.audience ? el('p', { class: 'intro__audience', text: content.intro.audience }) : null,
    ]),
    renderTeaser(),
    el('p', { class: 'meta-line', text: content.intro.meta_line }),
    el('div', { class: 'intro__actions' }, [
      content.intro.instruction ? el('p', { class: 'intro__instruction', text: content.intro.instruction }) : null,
      el('button', { type: 'button', class: 'btn btn--primary', text: content.intro.start_label, onclick: start }),
      authorLine(),
    ]),
  ]);
  append(screen, [main, el('div', { class: 'screen__aside' }, [renderTeaser({ large: true })])]);
  return screen;
}

// The author line is one string in the content file. The author's name inside it is
// shown in bold, as in the approved prototype; the text itself stays exactly as written.
function authorLine() {
  const text = content.intro.author_line;
  const name = content.result.signature_name;
  const line = el('p', { class: 'author-line' });
  const at = name ? text.indexOf(name) : -1;
  if (at < 0) {
    line.textContent = text;
    return line;
  }
  append(line, [text.slice(0, at), el('strong', { text: name }), text.slice(at + name.length)]);
  return line;
}

function start() {
  if (state.step !== 'intro') return;
  go('q', { qi: 0 });
}

// ---------- screens 2 to 12: scale questions ----------

function questionScreen() {
  const screen = el('section', { class: 'screen screen--question' });
  const refs = {
    ...topBar({ step: state.qi + 1, showProgress: true, next: true }),
    pillar: el('span', { class: 'eyebrow eyebrow--pillar' }),
    title: el('h1', { class: 'heading', id: 'question-title', tabindex: '-1', 'data-focus-target': '' }),
    note: el('p', { class: 'note' }),
    buttons: [],
  };
  const rates = el('div', { class: 'rates', role: 'group', 'aria-labelledby': 'question-title question-prompt' });
  for (let value = 1; value <= 10; value += 1) {
    const button = el('button', { type: 'button', class: 'rate', text: String(value), onclick: () => pick(value) });
    refs.buttons.push(button);
    rates.append(button);
  }
  const scale = el('dl', { class: 'scale' });
  for (const mark of content.question.scale) {
    scale.append(el('dt', { text: String(mark.value) }), el('dd', { text: mark.label, 'data-mark': String(mark.value) }));
  }
  const live = renderLiveMosaic(content);
  refs.liveTiles = live.tiles;
  updateLiveMosaic(live.tiles, state.answers, state.qi, { settle: true });
  append(screen, [
    el('div', { class: 'screen__main' }, [
      refs.bar,
      refs.progress,
      el('div', { class: 'question__head' }, [refs.pillar, refs.title, refs.note]),
      el('p', { class: 'prompt', id: 'question-prompt', text: content.question.prompt }),
      rates,
      scale,
    ]),
    el('div', { class: 'screen__aside' }, [live.grid]),
  ]);
  questionRefs = refs;
  updateQuestion();
  return screen;
}

function updateQuestion() {
  const refs = questionRefs;
  const { pillar, item } = questions[state.qi];
  setProgress(refs, state.qi + 1);
  refs.pillar.textContent = pillar.name;
  refs.title.textContent = item.title;
  refs.note.textContent = item.note || '';
  refs.note.hidden = !item.note;
  const current = state.answers[state.qi];
  refs.buttons.forEach((button, index) => {
    const selected = current === index + 1;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  refs.next.hidden = !(Number.isInteger(current) && !transition);
  if (refs.liveTiles) updateLiveMosaic(refs.liveTiles, state.answers, state.qi);
}

function pick(value) {
  if (transition) return;
  state.answers[state.qi] = value;
  // The timer starts before the screen updates, so Next stays hidden during the highlight.
  transition = setTimeout(() => {
    transition = null;
    if (state.qi < questions.length - 1) go('q', { qi: state.qi + 1 });
    else go('grow');
  }, TRANSITION_MS);
  updateQuestion();
}

// ---------- screen 13: which area to grow ----------

function growScreen() {
  const screen = el('section', { class: 'screen screen--question screen--grow' });
  const progress = topBar({ step: TOTAL_STEPS, showProgress: true, next: true });
  const q = content.grow_question;
  const buttons = [];
  for (const option of q.options) {
    const button = el('button', { type: 'button', class: 'card', 'aria-pressed': 'false' }, [
      el('span', { class: 'card__label', text: option.label }),
      el('span', { class: 'card__desc', text: option.description }),
    ]);
    button.addEventListener('click', () => pickGrow(option.key, buttons));
    buttons.push({ key: option.key, button });
  }
  growButtons = buttons;
  growNext = progress.next;
  markGrow(buttons);
  append(screen, [
    el('div', { class: 'screen__main' }, [
      progress.bar,
      progress.progress,
      el('div', { class: 'question__head' }, [
        el('span', { class: 'eyebrow', text: q.eyebrow }),
        el('h1', { class: 'heading', tabindex: '-1', 'data-focus-target': '', text: q.title }),
        el('p', { class: 'note', text: q.subtitle }),
      ]),
      el('div', { class: 'cards' }, buttons.map((entry) => entry.button)),
    ]),
  ]);
  return screen;
}

function markGrow(buttons) {
  for (const { key, button } of buttons) {
    const selected = state.grow === key;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }
  if (growNext) growNext.hidden = !(state.grow && !transition);
}

function pickGrow(key, buttons) {
  if (transition) return;
  state.grow = key;
  transition = setTimeout(() => {
    transition = null;
    go('email');
  }, TRANSITION_MS);
  markGrow(buttons);
}

// ---------- screen 14: name and email ----------

function emailScreen() {
  const screen = el('section', { class: 'screen screen--question screen--email' });
  const t = content.email_step;
  const nameError = el('p', { class: 'field__error', id: 'name-error', 'aria-live': 'polite' });
  const emailError = el('p', { class: 'field__error', id: 'email-error', 'aria-live': 'polite' });
  const nameInput = el('input', {
    id: 'name',
    type: 'text',
    autocomplete: 'given-name',
    maxlength: String(NAME_MAX_LENGTH),
    'aria-describedby': 'name-error',
    value: state.name,
  });
  const emailInput = el('input', {
    id: 'email',
    type: 'email',
    autocomplete: 'email',
    inputmode: 'email',
    'aria-describedby': 'email-error',
    value: state.email,
  });
  const consent = el('input', { id: 'consent', type: 'checkbox' });
  consent.checked = state.consent;
  nameInput.addEventListener('input', () => {
    state.name = nameInput.value;
    setError(nameInput, nameError, '');
  });
  emailInput.addEventListener('input', () => {
    state.email = emailInput.value;
    setError(emailInput, emailError, '');
  });
  consent.addEventListener('change', () => {
    state.consent = consent.checked;
  });
  const form = el('form', { class: 'form', novalidate: true }, [
    el('div', { class: 'field' }, [el('label', { for: 'name', text: t.name_label }), nameInput, nameError]),
    el('div', { class: 'field' }, [el('label', { for: 'email', text: t.email_label }), emailInput, emailError]),
    el('label', { class: 'consent', for: 'consent' }, [consent, el('span', { text: t.consent_label })]),
    el('button', { type: 'submit', class: 'btn btn--primary', text: t.submit_label }),
    el('p', { class: 'data-note', text: t.data_note }),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitForm({ nameInput, emailInput, nameError, emailError });
  });
  append(screen, [
    el('div', { class: 'screen__main' }, [
      topBar({ step: TOTAL_STEPS, showProgress: false, next: false }).bar,
      el('div', { class: 'email__head' }, [
        el('div', { class: 'email__text' }, [
          el('span', { class: 'eyebrow', text: t.eyebrow }),
          el('h1', { class: 'heading', tabindex: '-1', 'data-focus-target': '', text: t.title }),
        ]),
        blurredMosaic(),
        el('p', { class: 'note', text: t.subtitle }),
      ]),
      form,
    ]),
    el('div', { class: 'screen__aside' }, [veiledMosaic()]),
  ]);
  return screen;
}

// Phone: the person's real mosaic, small and blurred beside the title, the promise before
// the email, the reveal after it.
function blurredMosaic() {
  if (!state.answers.every(Number.isInteger)) return null;
  const evaluation = evaluate(state.answers, content);
  return el('div', { class: 'mosaic-blur mosaic-blur--compact', 'aria-hidden': 'true' }, [
    renderMosaic(content, evaluation, { plain: true }),
  ]);
}

// Wide screens: the same live mosaic as beside the questions, all twelve tiles settled in the
// flat answered tone, under a light blur like frosted glass (CSS). No real shade is in the
// markup; those appear only on the result screen.
function veiledMosaic() {
  if (!state.answers.every(Number.isInteger)) return null;
  const live = renderLiveMosaic(content);
  live.grid.classList.add('mosaic--veiled');
  updateLiveMosaic(live.tiles, state.answers, -1, { settle: true });
  return live.grid;
}

function setError(input, errorNode, message) {
  errorNode.textContent = message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function submitForm(refs) {
  const name = refs.nameInput.value.trim();
  const email = refs.emailInput.value.trim();
  const nameOk = name.length >= 1 && name.length <= NAME_MAX_LENGTH;
  const emailOk = EMAIL_PATTERN.test(email);
  setError(refs.nameInput, refs.nameError, nameOk ? '' : content.email_step.error_name);
  setError(refs.emailInput, refs.emailError, emailOk ? '' : content.email_step.error_email);
  if (!nameOk) {
    refs.nameInput.focus();
    return;
  }
  if (!emailOk) {
    refs.emailInput.focus();
    return;
  }
  state.name = name;
  state.email = email;
  showResult(false);
}

// ---------- screen 15: result ----------

function showSample() {
  clearTransition();
  state.answers = SAMPLE.answers.slice();
  state.grow = SAMPLE.grow;
  state.name = '';
  state.email = '';
  state.consent = false;
  showResult(true);
}

function showResult(sample) {
  if (submitting) return;
  submitting = true;
  state.sample = sample;
  state.evaluation = evaluate(state.answers, content);
  if (!sample) {
    const payload = buildPayload({
      name: state.name,
      email: state.email,
      consent: state.consent,
      src,
      grow: state.grow,
      evaluation: state.evaluation,
      answers: state.answers,
      pillars: content.pillars,
    });
    sendPayload(payload, content.backend.endpoint_url);
  }
  unwindThen(() => {
    state.step = 'result';
    pushEntry('result');
    render();
    submitting = false;
  });
}

function resultScreen() {
  const r = content.result;
  const evaluation = state.evaluation;
  const key = evaluation.result;
  const texts = content.results[key];
  const screen = el('section', { class: 'screen screen--result' });
  const greeting = state.name ? fillTemplate(r.greeting_with_name, { name: state.name }) : r.greeting;

  const body = el('div', { class: 'result__body rise' }, [el('h2', { class: 'heading-sm', text: texts.headline })]);
  const lineKind = growLineKind(key, state.grow);
  if (lineKind) {
    const template = lineKind === 'match' ? r.grow_match : r.grow_mismatch;
    const line = fillTemplate(template, { grow: pillarInText(state.grow), focus: pillarInText(key) });
    body.append(el('p', { class: 'grow-note', text: line }));
  }
  body.append(section(r.section_labels.what_it_means, [texts.what_it_means]));
  if (key === 'balanced') body.append(section(r.section_labels.whats_next, texts.whats_next));
  else body.append(section(r.section_labels.how_it_affects, texts.how_it_affects));
  body.append(section(r.section_labels.first_steps, [], el('ol', { class: 'steps' }, texts.steps.map((step) => el('li', { text: step })))));

  const ctaBlock = (className) => el('div', { class: className }, [
    el('h2', { class: 'cta__question', text: texts.cta_question }),
    el('a', {
      class: 'btn btn--primary',
      href: calendlyUrl(content.links.calendly, { src, result: key }),
      target: '_blank',
      rel: 'noopener',
      text: r.cta_button,
    }),
    el('p', { class: 'cta__note', text: r.cta_note }),
  ]);
  const cta = ctaBlock('cta');          // the band at the end, phones and short windows
  const ctaCard = ctaBlock('cta-card'); // the card in the sticky left column, wide screens

  const footer = el('div', { class: 'result__footer' }, [
    state.email ? el('p', { class: 'copy-line', text: fillTemplate(r.copy_line, { email: state.email }) }) : null,
    el('button', { type: 'button', class: 'link-button', text: r.retake_label, onclick: retake }),
    el('div', { class: 'signature' }, [
      el('strong', { text: r.signature_name }),
      el('span', { text: r.signature_title }),
      el('span', { text: r.legal_line }),
    ]),
  ]);

  append(screen, [
    el('div', { class: 'result__left' }, [
      el('div', { class: 'result__head' }, [
        el('span', { class: 'eyebrow', text: r.eyebrow }),
        el('h1', { class: 'heading', tabindex: '-1', 'data-focus-target': '', text: greeting }),
      ]),
      el('div', { class: 'result__mosaic' }, [renderMosaic(content, evaluation), renderLegend(content)]),
      ctaCard,
    ]),
    el('div', { class: 'result__right' }, [body, cta, footer]),
  ]);
  return screen;
}

function section(label, paragraphs, extra) {
  return el('div', { class: 'section' }, [
    el('h3', { class: 'section__label', text: label }),
    ...paragraphs.map((text) => el('p', { text })),
    extra,
  ]);
}

function retake() {
  clearTransition();
  if (state.depth > 0) {
    lockedBack();
  } else {
    resetAnswers();
    showIntro();
  }
}

// On wide screens the left column of the result is sticky. When it is taller than the
// window (long greeting, small window) it would hide the call button, so the page falls
// back to the short-window layout: static column, call band at the end.
function fitResultColumn() {
  const screen = root.querySelector('.screen--result');
  if (!screen) return;
  const left = screen.querySelector('.result__left');
  screen.classList.remove('result--tall');
  const needed = left.getBoundingClientRect().height + 32 + 16;
  screen.classList.toggle('result--tall', needed > window.innerHeight);
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.step === 'result') fitResultColumn();
  }, 100);
});

// ---------- start ----------

if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
// The sample result opens from the address with ?sample, only while the page is unpublished.
// There is no link to it on the page: it is a check for the team, not for the people taking the test.
const sampleRequested = !content.meta.published && new URLSearchParams(window.location.search).has('sample');
// After a reload in the middle of the questions the old entries are still in history:
// show the first screen, then walk back to where that run began, so Back behaves normally.
const previousEntry = window.history.state;
showIntro();
if (sampleRequested) {
  showSample();
} else if (previousEntry && Number.isInteger(previousEntry.depth) && previousEntry.depth > 0) {
  window.history.go(-previousEntry.depth);
}
