/* A browser-local record of decisions, their evidence, and later outcomes. */
(() => {
  const storageKey = 'product-lab.decisions.v1';
  const statuses = ['Review pending', 'Validated', 'Revised', 'Inconclusive'];
  const today = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };

  function attach(button, { project, capture }) {
    const dialog = document.createElement('dialog');
    dialog.className = 'decision-log';
    dialog.setAttribute('aria-label', project + ' decision log');
    dialog.innerHTML = `
      <header class="decision-header">
        <div><h2>Decision log</h2><p>Records are saved in this browser.</p></div>
        <button type="button" class="secondary" data-close>Close</button>
      </header>
      <form data-editor>
        <label>Decision <input name="decision" required maxlength="120"></label>
        <div class="decision-fields">
          <label>Owner <input name="owner" required maxlength="80"></label>
          <label>Review date <input name="due" type="date" required></label>
        </div>
        <label>What alternatives did you consider?
          <textarea name="tradeoff" rows="2" maxlength="600" required></textarea>
        </label>
        <label>What evidence would change this decision?
          <textarea name="trigger" rows="2" maxlength="600" required></textarea>
        </label>
        <details><summary>Evidence at time of decision</summary><pre data-evidence></pre></details>
        <button type="submit">Record decision</button>
      </form>
      <section aria-label="Saved decisions">
        <header class="decision-header">
          <h3>Saved decisions</h3>
          <button type="button" class="secondary" data-export>Export decision log</button>
        </header>
        <p data-status role="status"></p>
        <div data-records></div>
      </section>`;
    document.body.append(dialog);

    const form = dialog.querySelector('[data-editor]');
    const records = dialog.querySelector('[data-records]');
    const status = dialog.querySelector('[data-status]');
    const exportButton = dialog.querySelector('[data-export]');
    let evidence;

    function load() {
      const entries = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry !== 'object')) {
        throw new Error('Decision log data could not be read.');
      }
      return entries;
    }

    function save(update) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(update(load())));
      } catch {
        status.textContent = 'The decision log could not be saved. Your previous entries are unchanged.';
        return false;
      }
      return true;
    }

    function render() {
      records.replaceChildren();
      let entries;
      try {
        entries = load().filter(entry => entry.project === project);
      } catch {
        status.textContent = 'The decision log could not be opened.';
        exportButton.disabled = true;
        return;
      }
      exportButton.disabled = !entries.length;
      if (!entries.length) records.textContent = 'No saved decisions yet.';

      for (const entry of entries) {
        const card = document.createElement('details');
        card.className = 'decision-record';
        const title = document.createElement('summary');
        const overdue = entry.status === statuses[0] && entry.due < today();
        title.textContent = entry.decision + (overdue ? ' · Review overdue' : ' · ' + entry.status);
        const detail = document.createElement('div');
        detail.innerHTML = `
          <p data-meta></p><p data-tradeoff></p><p data-trigger></p>
          <details><summary>Original evidence</summary><pre></pre></details>
          <form>
            <label>Review result <select name="result" aria-label="Review result"></select></label>
            <label>What happened? <textarea name="outcome" rows="2" maxlength="600"></textarea></label>
            <button type="submit" class="secondary">Save review</button>
          </form>`;
        detail.querySelector('[data-meta]').textContent = `Owner ${entry.owner} · Review ${entry.due}`;
        detail.querySelector('[data-tradeoff]').textContent = 'Alternatives and rationale — ' + entry.tradeoff;
        detail.querySelector('[data-trigger]').textContent = 'Revisit if — ' + entry.trigger;
        detail.querySelector('pre').textContent = entry.evidence;
        const review = detail.querySelector('form');
        for (const value of statuses) {
          review.elements.result.add(new Option(value, value, false, value === entry.status));
        }
        review.elements.outcome.value = entry.outcome ?? '';
        review.addEventListener('submit', event => {
          event.preventDefault();
          const outcome = review.elements.outcome.value.trim();
          const result = review.elements.result.value;
          if (result !== statuses[0] && !outcome) {
            status.textContent = 'Describe the outcome before closing the review.';
            review.elements.outcome.focus();
            return;
          }
          if (save(all => all.map(item => item.id === entry.id
            ? { ...item, status: result, outcome, reviewedAt: today() } : item))) {
            status.textContent = 'Review saved.';
            title.textContent = entry.decision + (result === statuses[0] && entry.due < today()
              ? ' · Review overdue' : ' · ' + result);
          }
        });
        card.append(title, detail);
        records.append(card);
      }
    }

    button.addEventListener('click', () => {
      evidence = capture();
      if (!evidence) {
        UI.toast('Run the analysis first to capture its evidence.');
        return;
      }
      dialog.querySelector('[data-evidence]').textContent = evidence;
      status.textContent = '';
      render();
      dialog.showModal();
    });
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());

    form.addEventListener('submit', event => {
      event.preventDefault();
      const values = Object.fromEntries(
        [...new FormData(form)].map(([key, value]) => [key, value.trim()])
      );
      if (Object.values(values).some(value => !value)) {
        status.textContent = 'Complete each field before recording the decision.';
        return;
      }
      if (save(entries => [{
        ...values, project, evidence, id: crypto.randomUUID(), createdAt: today(), status: statuses[0],
      }, ...entries])) {
        form.reset();
        render();
        status.textContent = 'Decision recorded with its evidence.';
        form.elements.decision.focus();
      }
    });

    exportButton.addEventListener('click', () => {
      try {
        const entries = load().filter(entry => entry.project === project);
        const body = entries.map(entry => [
          '## ' + entry.decision,
          `Owner: ${entry.owner} | Recorded: ${entry.createdAt} | Review date: ${entry.due}`,
          'Alternatives and rationale: ' + entry.tradeoff,
          'Revisit if: ' + entry.trigger,
          'Evidence at time of decision:\n' + entry.evidence,
          `Review: ${entry.status}${entry.reviewedAt ? ' (' + entry.reviewedAt + ')' : ''}`,
          entry.outcome || '',
        ].filter(Boolean).join('\n\n')).join('\n\n---\n\n');
        UI.download('decision-log.md', `# ${project} decision log\n\n${body}\n`, 'text/markdown');
      } catch {
        status.textContent = 'The decision log could not be exported.';
      }
    });
  }

  window.DecisionLog = { attach };
})();
