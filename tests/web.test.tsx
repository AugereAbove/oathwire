import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), signinRedirect: vi.fn(), api: vi.fn() }));
vi.mock('../apps/web/src/auth', () => ({
  configured: true,
  auth: { getUser: mocks.getUser, signinRedirect: mocks.signinRedirect },
  logout: vi.fn(),
}));
vi.mock('../apps/web/src/api', () => ({ api: mocks.api }));
import { App } from '../apps/web/src/App';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.signinRedirect.mockResolvedValue(undefined);
  window.history.replaceState({}, '', '/');
});
afterEach(cleanup);
it('starts hosted sign in without fetching project data', async () => {
  mocks.getUser.mockResolvedValue(null);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: /Sign in to Oathwire/ }));
  expect(mocks.signinRedirect).toHaveBeenCalledOnce();
  expect(mocks.api).not.toHaveBeenCalled();
});
it('creates an owned project through the API and renders the empty console', async () => {
  mocks.getUser.mockResolvedValue({ expired: false });
  const project = { id: 'prj_test', name: 'Example Store', description: '', status: 'active' };
  let created = false;
  mocks.api.mockImplementation(async (path: string, method?: string) => {
    if (path === '/projects' && method === 'POST') {
      created = true;
      return project;
    }
    if (path === '/projects') return { items: created ? [project] : [] };
    if (path.endsWith('/stats'))
      return { scope: 'Recent events', events: 0, delivered: 0, failed: 0, pending: 0 };
    return { items: [] };
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Create your first project' }));
  await userEvent.type(screen.getByRole('textbox', { name: /^Name$/ }), 'Example Store');
  await userEvent.click(screen.getByRole('button', { name: /^Create project$/ }));
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith('/projects', 'POST', {
      name: 'Example Store',
      description: '',
    }),
  );
  expect(await screen.findByText('No events in this page.')).toBeTruthy();
});
it('displays the API error when project loading fails', async () => {
  mocks.getUser.mockResolvedValue({ expired: false });
  mocks.api.mockRejectedValue(new Error('The service is temporarily unavailable.'));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('temporarily unavailable'),
  );
});
