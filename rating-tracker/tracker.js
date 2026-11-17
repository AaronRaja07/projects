'use strict';

const storageKey = 'aaron-raja.rating-tracker.v1';
const categories = ['Movie', 'TV', 'Book', 'Game', 'Food', 'Other'];
const editor = document.querySelector('#editor');
const fields = editor.elements;
const category = document.querySelector('#category');
const search = document.querySelector('#search');
const filter = document.querySelector('#filter');
const status = document.querySelector('#status');
const list = document.querySelector('#entries');
const summary = document.querySelector('#summary');
const empty = document.querySelector('#empty');
const editorTitle = document.querySelector('#editor-title');
const save = document.querySelector('#save');
const cancel = document.querySelector('#cancel');
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
let editingId = null;

filter.add(new Option('All categories', ''));
for (const name of categories) {
  category.add(new Option(name, name));
  filter.add(new Option(name, name));
}

function validEntry(entry) {
  return entry && typeof entry.id === 'string' &&
    typeof entry.title === 'string' && typeof entry.notes === 'string' &&
    categories.includes(entry.category) &&
    Number.isInteger(entry.rating) && entry.rating >= 1 && entry.rating <= 5 &&
    Number.isFinite(entry.createdAt);
}

let entries = [];
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
  if (!Array.isArray(stored) || !stored.every(validEntry)) {
    throw new Error('Invalid saved entries');
  }
  entries = stored;
} catch {
  status.textContent = 'Saved entries could not be loaded. They have been left untouched.';
  save.disabled = true;
}

function persist(nextEntries) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(nextEntries));
  } catch {
    status.textContent = 'Your browser could not save the change. Your entries are unchanged.';
    return false;
  }
  entries = nextEntries;
  return true;
}

function resetEditor() {
  editingId = null;
  editor.reset();
  editorTitle.textContent = 'Add an entry';
  save.textContent = 'Add entry';
  cancel.hidden = true;
}

function editEntry(entry) {
  editingId = entry.id;
  fields.title.value = entry.title;
  fields.category.value = entry.category;
  fields.rating.value = entry.rating;
  fields.notes.value = entry.notes;
  editorTitle.textContent = 'Edit entry';
  save.textContent = 'Save changes';
  cancel.hidden = false;
  status.textContent = '';
  fields.title.focus();
}

function removeEntry(entry) {
  if (!window.confirm(`Remove “${entry.title}” from your ratings?`)) return;
  if (!persist(entries.filter(item => item.id !== entry.id))) return;
  if (editingId === entry.id) resetEditor();
  render();
  search.focus();
  status.textContent = 'Entry removed.';
}

function render() {
  const query = search.value.trim().toLocaleLowerCase();
  const visible = entries.filter(entry =>
    (!filter.value || entry.category === filter.value) &&
    (entry.title + ' ' + entry.notes).toLocaleLowerCase().includes(query)
  );
  const count = visible.length;
  const average = count ? visible.reduce((sum, entry) => sum + entry.rating, 0) / count : 0;
  summary.textContent = count ? `${count} · ${average.toFixed(1)} / 5 average` : '';
  empty.textContent = count ? '' : entries.length ? 'No matching entries.' : 'Add your first rating to get started.';
  list.replaceChildren();

  for (const entry of visible) {
    const row = document.createElement('li');
    row.innerHTML = '<div class="entry-title"><h3></h3><strong></strong></div>' +
      '<small></small><p class="entry-notes"></p>' +
      '<div class="actions entry-controls"><button class="secondary">Edit</button>' +
      '<button class="secondary">Remove</button></div>';
    row.querySelector('h3').textContent = entry.title;
    row.querySelector('strong').textContent = `${entry.rating} / 5`;
    row.querySelector('small').textContent = `${entry.category} · ${dateFormat.format(entry.createdAt)}`;
    const notes = row.querySelector('.entry-notes');
    notes.textContent = entry.notes;
    notes.hidden = !entry.notes;
    const [edit, remove] = row.querySelectorAll('button');
    edit.setAttribute('aria-label', `Edit ${entry.title}`);
    remove.setAttribute('aria-label', `Remove ${entry.title}`);
    edit.addEventListener('click', () => editEntry(entry));
    remove.addEventListener('click', () => removeEntry(entry));
    list.append(row);
  }
}

fields.title.addEventListener('input', () => fields.title.setCustomValidity(''));

editor.addEventListener('submit', event => {
  event.preventDefault();
  const title = fields.title.value.trim();
  if (!title) {
    fields.title.setCustomValidity('Enter a title.');
    fields.title.reportValidity();
    return;
  }

  const previous = entries.find(entry => entry.id === editingId);
  const entry = {
    id: previous?.id ?? crypto.randomUUID(),
    createdAt: previous?.createdAt ?? Date.now(),
    title,
    category: category.value,
    rating: Number(fields.rating.value),
    notes: fields.notes.value.trim(),
  };
  if (!validEntry(entry)) return;
  const next = previous ? entries.map(item => item.id === entry.id ? entry : item) : [entry, ...entries];
  if (!persist(next)) return;
  resetEditor();
  render();
  status.textContent = previous ? 'Changes saved.' : 'Entry added.';
});

cancel.addEventListener('click', () => {
  resetEditor();
  fields.title.focus();
});
search.addEventListener('input', render);
filter.addEventListener('change', render);
render();

DecisionLog.attach(document.querySelector('#decision-log'), {
  project: 'Rating Tracker',
  capture: () => {
    const buckets = categories.map(name => {
      const ratings = entries.filter(entry => entry.category === name);
      if (!ratings.length) return `${name}: no ratings`;
      const average = ratings.reduce((sum, entry) => sum + entry.rating, 0) / ratings.length;
      return `${name}: ${ratings.length} ratings · ${average.toFixed(1)} / 5 average`;
    });
    return ['Personal ratings · all entries', 'Title and note text excluded.', ...buckets].join('\n');
  },
});
