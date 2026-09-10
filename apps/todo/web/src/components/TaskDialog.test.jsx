import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import TaskDialog from './TaskDialog.jsx';

const categories = [{ id: 1, name: 'Home', color: '#111' }];
const users = [{ id: 1, display_name: 'Ryan' }, { id: 2, display_name: 'Sam' }];
const currentUser = { id: 1, display_name: 'Ryan', is_admin: true };

function renderDialog(props = {}) {
  return render(
    <TaskDialog
      open
      task={null}
      categories={categories}
      users={users}
      currentUser={currentUser}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      {...props}
    />,
  );
}

describe('TaskDialog save failure', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Regression coverage ported from the old vanilla-JS suite: a failed save
  // must not silently discard what the user typed, and must not close the
  // dialog as if the task had been saved.
  test('keeps the dialog open, preserves the typed title, and shows an error', async () => {
    const user = userEvent.setup();
    renderDialog();

    const titleInput = screen.getByLabelText(/title/i);
    await user.type(titleInput, 'This should not vanish');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The api() helper surfaces the raw fetch error when there's no JSON
    // `{error}` body to read a message from (a network failure never
    // reaches the server) — same behavior as the vanilla version, which
    // only asserted the message was non-empty rather than its exact text.
    const err = await screen.findByText((_, el) => el?.className === 'form-error' && el.textContent.length > 0);
    expect(err).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveValue('This should not vanish');
    // Still rendering the dialog's own form — not unmounted/closed.
    expect(screen.getByRole('heading', { name: 'New task' })).toBeInTheDocument();
  });
});

describe('TaskDialog validation', () => {
  test('rejects a whitespace-only title (passes HTML "required" but trims to empty)', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderDialog();

    // A single space satisfies the input's native `required` attribute (so
    // the browser lets the submit event through) but the app's own
    // trim()-based check must still catch it.
    await user.type(screen.getByLabelText(/title/i), ' ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test('requires a due date for a repeating task', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderDialog();

    await user.type(screen.getByLabelText(/title/i), 'Water plants');
    await user.selectOptions(screen.getByLabelText(/repeats/i), 'weekly');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/repeating task needs a due date/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('TaskDialog editing an existing task', () => {
  test('prefills every field from the task, including links and assignees', () => {
    const task = {
      id: 7,
      title: 'Renew passport',
      notes: 'Bring photos',
      category_id: 1,
      importance: 'high',
      due_date: '2026-03-01T12:00:00.000Z',
      recurrence: null,
      links: [{ id: 1, url: 'https://example.com', label: 'DMV' }],
      assignees: [{ id: 2, display_name: 'Sam' }],
    };
    renderDialog({ task });

    expect(screen.getByRole('heading', { name: 'Edit task' })).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveValue('Renew passport');
    expect(screen.getByLabelText(/notes/i)).toHaveValue('Bring photos');
    expect(screen.getByLabelText(/importance/i)).toHaveValue('high');
    expect(screen.getByLabelText(/links/i)).toHaveValue('DMV https://example.com');
    expect(screen.getByRole('button', { name: 'Sam' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
