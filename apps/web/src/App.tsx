import { useEffect, useState, type FormEvent } from 'react';
import { auth, configured, logout } from './auth';
import {
  api,
  type Project,
  type Page,
  type Destination,
  type Key,
  type Event,
  type Delivery,
  type Attempt,
  type Stats,
} from './api';
const date = (s: string) =>
  new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const short = (s: string) => s.slice(0, 17) + '…';
const fields = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return new FormData(e.currentTarget);
};
type Tab = 'Overview' | 'Events' | 'Destinations' | 'API keys' | 'Integration' | 'Settings';
const tabs: Tab[] = ['Overview', 'Events', 'Destinations', 'API keys', 'Integration', 'Settings'];
export function App() {
  const [signedIn, setSignedIn] = useState(false),
    [checking, setChecking] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (auth && window.location.pathname === '/callback') {
          await auth.signinRedirectCallback();
          window.history.replaceState({}, '', '/');
        }
        const user = await auth?.getUser();
        if (active) setSignedIn(Boolean(user && !user.expired));
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  if (checking)
    return (
      <main className="landing">
        <p>Checking your session…</p>
      </main>
    );
  if (signedIn) return <Console />;
  return (
    <main className="landing">
      <div className="wordmark">
        <span className="mark">⌁</span> OATHWIRE
      </div>
      <p className="eyebrow">EVENT DELIVERY INFRASTRUCTURE</p>
      <h1>
        Every event.
        <br />
        <span>Accounted for.</span>
      </h1>
      <p className="intro">
        Publish an event once. Oathwire records it, delivers signed webhooks, and keeps every
        attempt visible.
      </p>
      <div className="actions">
        <button
          disabled={!configured}
          onClick={() => void auth?.signinRedirect().catch((e) => setError(e.message))}
        >
          Sign in to Oathwire <span aria-hidden>↗</span>
        </button>
        <a href="https://github.com/AugereAbove/oathwire" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </div>
      {!configured && (
        <p className="notice">
          Authentication is not configured. Follow the deployment guide to connect Cognito and the
          API.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="pipeline">
        <span>Your application</span>
        <b>→</b>
        <span>Durable event + queue</span>
        <b>→</b>
        <span>Signed HTTPS webhook</span>
      </div>
      <section className="features">
        <article>
          <h2>Durable acceptance</h2>
          <p>A 202 response follows persistent storage of the event and its delivery work.</p>
        </article>
        <article>
          <h2>Bounded retries</h2>
          <p>Temporary failures retry up to six attempts. Replay failed deliveries when ready.</p>
        </article>
        <article>
          <h2>A visible history</h2>
          <p>
            Inspect outcomes and attempts. Delivery is at least once; receivers should deduplicate.
          </p>
        </article>
      </section>
      <details>
        <summary>Quick integration</summary>
        <Integration />
      </details>
      <footer>Oathwire · Seven-day history · Invitation-only beta</footer>
    </main>
  );
}
function Console() {
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState(''),
    [tab, setTab] = useState<Tab>('Overview');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [secret, setSecret] = useState('');
  const [newProject, setNewProject] = useState(false);
  const current = projects.find((p) => p.id === project);
  useEffect(() => {
    let active = true;
    api<Page<Project>>('/projects')
      .then((p) => {
        if (active) {
          setProjects(p.items);
          setProject((v) => v || p.items[0]?.id || '');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="console">
      <aside>
        <a href="/" className="wordmark">
          <span className="mark">⌁</span> OATHWIRE
        </a>
        <label className="eyebrow" htmlFor="project">
          WORKSPACE
        </label>
        <select
          id="project"
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setTab('Overview');
          }}
        >
          <option value="" disabled>
            Select a project
          </option>
          {projects.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
              {p.status === 'archived' ? ' (archived)' : ''}
            </option>
          ))}
        </select>
        <button className="subtle" onClick={() => setNewProject((v) => !v)}>
          + New project
        </button>
        <nav aria-label="Project navigation">
          {tabs.map((t) => (
            <button
              key={t}
              className={tab === t ? 'selected' : ''}
              onClick={() => {
                setTab(t);
                setError('');
              }}
            >
              {t}
              <span aria-hidden>↗</span>
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <span className="beta">BETA</span>
          <p>Every event. Accounted for.</p>
          <button
            className="subtle"
            onClick={() => void logout().catch((e) => setError(e.message))}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header>
          <div>
            <p className="eyebrow">
              {current?.name ?? 'YOUR WORKSPACE'} <span>/</span> {tab}
            </p>
            <h1>{tab === 'Overview' ? 'Delivery overview' : tab}</h1>
          </div>
          <span className="retention">7-day retention</span>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button className="subtle" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}
        {secret && (
          <section className="notice">
            <h2>Save this secret now</h2>
            <p>It is shown only once. Store it securely before closing this message.</p>
            <code className="secret">{secret}</code>
            <div className="actions">
              <button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(secret)
                    .catch(() => setError('Copy failed. Select and copy the secret manually.'))
                }
              >
                Copy
              </button>
              <button className="subtle" onClick={() => setSecret('')}>
                I saved it. Close
              </button>
            </div>
          </section>
        )}
        {newProject && (
          <section className="panel">
            <h2>Create project</h2>
            <form
              onSubmit={(e) => {
                const f = fields(e);
                void act(async () => {
                  const p = await api<Project>('/projects', 'POST', {
                    name: f.get('name'),
                    description: f.get('description'),
                  });
                  setProject(p.id);
                  setNewProject(false);
                });
              }}
            >
              <label>
                Name
                <input name="name" required maxLength={80} />
              </label>
              <label>
                Description
                <input name="description" maxLength={300} />
              </label>
              <button disabled={busy}>Create project</button>
            </form>
          </section>
        )}
        {current?.status === 'archived' && (
          <p className="notice">
            This project is archived. New events are rejected; pending deliveries are cancelled when
            processed.
          </p>
        )}
        {!project ? (
          <section className="empty">
            <span className="eyebrow">START HERE</span>
            <h2>Give your events a home.</h2>
            <p>Create a project, register an HTTPS destination, then generate a publishing key.</p>
            <button onClick={() => setNewProject(true)}>Create your first project</button>
          </section>
        ) : (
          <Content
            key={project + tab}
            project={current}
            projectId={project}
            tab={tab}
            revision={revision}
            busy={busy}
            act={act}
            reveal={setSecret}
          />
        )}
        <footer>Oathwire · At-least-once delivery. No guaranteed ordering.</footer>
      </main>
    </div>
  );
}
interface ContentProps {
  project?: Project;
  projectId: string;
  tab: Tab;
  revision: number;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  reveal: (value: string) => void;
}
function Content({ project, projectId, tab, revision, busy, act, reveal }: ContentProps) {
  const [destinations, setDestinations] = useState<Destination[]>([]),
    [keys, setKeys] = useState<Key[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [stats, setStats] = useState<Stats>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [cursor, setCursor] = useState<string>(),
    [page, setPage] = useState<string>();
  const [type, setType] = useState(''),
    [hours, setHours] = useState('24'),
    [filter, setFilter] = useState({ type: '', hours: '24' }),
    [selectedEvent, setSelectedEvent] = useState<Event>();
  const [editing, setEditing] = useState<Destination>();
  const [history, setHistory] = useState<Destination>();
  const base = '/projects/' + projectId;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      if (tab === 'Destinations') {
        const p = await api<Page<Destination>>(base + '/destinations');
        if (active) setDestinations(p.items);
      }
      if (tab === 'API keys') {
        const p = await api<Page<Key>>(base + '/keys');
        if (active) setKeys(p.items);
      }
      if (tab === 'Overview' || tab === 'Events') {
        const p = await api<Page<Event>>(
          base +
            '/events?hours=' +
            filter.hours +
            '&type=' +
            encodeURIComponent(filter.type) +
            (page ? '&cursor=' + page : ''),
        );
        if (active) {
          setEvents(p.items);
          setCursor(p.cursor);
        }
        if (tab === 'Overview') {
          const s = await api<Stats>(base + '/stats');
          if (active) setStats(s);
        }
      }
    })()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, base, revision, page, filter]);
  if (error)
    return (
      <div className="error" role="alert">
        {error}
      </div>
    );
  if (loading)
    return (
      <p className="muted" role="status">
        Loading {tab.toLowerCase()}…
      </p>
    );
  return (
    <>
      {tab === 'Overview' && (
        <>
          <p className="muted">{stats?.scope}. Refresh to fetch the latest delivery outcomes.</p>
          <div className="metrics">
            {[
              ['Events accepted', stats?.events],
              ['Acknowledged', stats?.delivered],
              ['Pending', stats?.pending],
              ['Failed', stats?.failed],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value ?? '—'}</strong>
              </div>
            ))}
          </div>
          <div className="section-title">
            <h2>Recent events</h2>
            <button className="subtle" disabled={busy} onClick={() => void act(async () => {})}>
              Refresh
            </button>
          </div>
        </>
      )}
      {(tab === 'Events' || tab === 'Overview') && (
        <>
          <form
            className="filters"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(undefined);
              setFilter({ type, hours });
            }}
          >
            <label>
              Event type
              <input
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="All event types"
                maxLength={100}
              />
            </label>
            <label>
              Time range
              <select value={hours} onChange={(e) => setHours(e.target.value)}>
                <option value="1">Last hour</option>
                <option value="24">Last 24 hours</option>
                <option value="168">Last 7 days</option>
              </select>
            </label>
            <button className="subtle">Apply filters</button>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Type</th>
                  <th>Destinations</th>
                  <th>Accepted</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <code title={e.id}>{short(e.id)}</code>
                    </td>
                    <td>{e.type}</td>
                    <td>
                      {e.matchedDestinations === 0 ? (
                        'No matches'
                      ) : (
                        <>
                          {e.matchedDestinations} matched
                          {e.deliverySummary && (
                            <small className="block muted">
                              {e.deliverySummary.delivered} delivered · {e.deliverySummary.failed}{' '}
                              failed · {e.deliverySummary.pending} pending
                              {e.deliverySummary.more ? ' (partial)' : ''}
                            </small>
                          )}
                        </>
                      )}
                    </td>
                    <td>{date(e.createdAt)}</td>
                    <td>
                      <button className="subtle" onClick={() => setSelectedEvent(e)}>
                        Inspect →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!events.length && (
              <div className="empty">
                <h2>No events in this page.</h2>
                <p>
                  Publish an event with your project API key, or adjust the filters. Filters apply
                  within each page.
                </p>
              </div>
            )}
          </div>
          <div className="actions">
            <button className="subtle" onClick={() => setPage(undefined)} disabled={!page}>
              First page
            </button>
            <button className="subtle" onClick={() => setPage(cursor)} disabled={!cursor}>
              Next page →
            </button>
          </div>
          {selectedEvent && (
            <EventDetail
              event={selectedEvent}
              onClose={() => setSelectedEvent(undefined)}
              act={act}
              busy={busy}
              revision={revision}
            />
          )}
        </>
      )}
      {tab === 'Destinations' && (
        <>
          <p className="muted">
            Public HTTPS endpoints only. A URL change requires a new destination. Five
            configurations per project.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Destination</th>
                  <th>Subscriptions</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.name}</strong>
                      <code className="block">{d.url}</code>
                    </td>
                    <td>
                      <code>{d.eventTypes.join(', ')}</code>
                    </td>
                    <td>
                      <Status value={d.retired ? 'retired' : d.enabled ? 'enabled' : 'disabled'} />
                    </td>
                    <td>
                      <button className="subtle" onClick={() => setHistory(d)}>
                        History
                      </button>
                      {!d.retired && (
                        <div className="actions">
                          <button className="subtle" disabled={busy} onClick={() => setEditing(d)}>
                            Edit
                          </button>
                          <button
                            className="subtle"
                            disabled={busy}
                            onClick={() =>
                              void act(() =>
                                api('/destinations/' + d.id, 'PATCH', { enabled: !d.enabled }),
                              )
                            }
                          >
                            {d.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            className="subtle"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  'Rotate the signing secret? Future attempts will immediately use the new secret.',
                                )
                              )
                                void act(async () => {
                                  const r = await api<{ signingSecret: string }>(
                                    '/destinations/' + d.id + '/rotate-secret',
                                    'POST',
                                    {},
                                  );
                                  reveal(r.signingSecret);
                                });
                            }}
                          >
                            Rotate secret
                          </button>
                          <button
                            className="danger subtle"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  'Retire this destination and cancel future attempts? History is retained.',
                                )
                              )
                                void act(() => api('/destinations/' + d.id, 'DELETE'));
                            }}
                          >
                            Retire
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!destinations.length && (
              <p className="empty">
                No destinations. Register the endpoint that should receive your events.
              </p>
            )}
          </div>
          {history && (
            <DestinationHistory destination={history} onClose={() => setHistory(undefined)} />
          )}
          <section className="panel">
            <h2>{editing ? 'Edit destination' : 'Register destination'}</h2>
            <form
              key={editing?.id ?? 'new'}
              onSubmit={(e) => {
                const f = fields(e);
                void act(async () => {
                  const input = {
                    name: f.get('name'),
                    eventTypes: String(f.get('types'))
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  };
                  if (editing) {
                    await api('/destinations/' + editing.id, 'PATCH', input);
                    setEditing(undefined);
                  } else {
                    const d = await api<{ signingSecret: string }>(base + '/destinations', 'POST', {
                      ...input,
                      url: f.get('url'),
                    });
                    reveal(d.signingSecret);
                  }
                });
              }}
            >
              <label>
                Name
                <input name="name" required maxLength={80} defaultValue={editing?.name} />
              </label>
              {!editing && (
                <label>
                  HTTPS endpoint
                  <input
                    name="url"
                    type="url"
                    required
                    placeholder="https://your-app.com/webhooks"
                    maxLength={2048}
                  />
                </label>
              )}
              <label>
                Event types, separated by commas
                <input
                  name="types"
                  required
                  defaultValue={editing?.eventTypes.join(', ') ?? '*'}
                  placeholder="order.created, payment.completed"
                />
              </label>
              <p className="muted">Use * alone to subscribe to all event types.</p>
              <div className="actions">
                <button disabled={busy || project?.status === 'archived'}>
                  {editing ? 'Save destination' : 'Register destination'}
                </button>
                {editing && (
                  <button type="button" className="subtle" onClick={() => setEditing(undefined)}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </section>
        </>
      )}
      {tab === 'API keys' && (
        <>
          <p className="muted">
            Publishing keys belong to this project. Full keys are shown once and stored only as
            hashes.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Created</th>
                  <th>Key identifier</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.label}</td>
                    <td>{date(k.createdAt)}</td>
                    <td>
                      <code>{short(k.id)}</code>
                    </td>
                    <td>
                      <button
                        className="danger subtle"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm('Revoke this publishing key immediately?'))
                            void act(() => api('/keys/' + k.id, 'DELETE'));
                        }}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!keys.length && <p className="empty">No active publishing keys.</p>}
          </div>
          <section className="panel">
            <h2>Generate publishing key</h2>
            <form
              onSubmit={(e) => {
                const f = fields(e);
                void act(async () => {
                  const k = await api<{ key: string }>(base + '/keys', 'POST', {
                    label: f.get('label'),
                  });
                  reveal(k.key);
                });
              }}
            >
              <label>
                Key label
                <input name="label" required maxLength={80} placeholder="Development publisher" />
              </label>
              <button disabled={busy || keys.length >= 3 || project?.status === 'archived'}>
                Generate key
              </button>
            </form>
          </section>
        </>
      )}
      {tab === 'Integration' && <Integration />}
      {tab === 'Settings' && (
        <section className="panel">
          <h2>Project settings</h2>
          <form
            key={project?.name}
            onSubmit={(e) => {
              const f = fields(e);
              void act(() =>
                api(base, 'PATCH', { name: f.get('name'), description: f.get('description') }),
              );
            }}
          >
            <label>
              Project name
              <input name="name" required maxLength={80} defaultValue={project?.name} />
            </label>
            <label>
              Description
              <textarea name="description" maxLength={300} defaultValue={project?.description} />
            </label>
            <button disabled={busy || project?.status === 'archived'}>Save project</button>
          </form>
          <hr />
          <h2>Archive project</h2>
          <p className="muted">
            Reject new events and cancel pending work when it is processed. History remains until
            retention expires. This action cannot be undone.
          </p>
          <button
            className="danger subtle"
            disabled={busy || project?.status === 'archived'}
            onClick={() => {
              if (window.confirm('Archive this project? This cannot be undone.'))
                void act(() => api(base, 'DELETE'));
            }}
          >
            Archive project
          </button>
        </section>
      )}
    </>
  );
}
function EventDetail({
  event,
  onClose,
  act,
  busy,
  revision,
}: {
  event: Event;
  onClose: () => void;
  act: ContentProps['act'];
  busy: boolean;
  revision: number;
}) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]),
    [selected, setSelected] = useState<Delivery>(),
    [attempts, setAttempts] = useState<Attempt[]>([]),
    [error, setError] = useState('');
  const [cursor, setCursor] = useState<string>();
  useEffect(() => {
    let active = true;
    api<Page<Delivery>>('/events/' + event.id + '/deliveries')
      .then((p) => {
        if (active) {
          setDeliveries(p.items);
          setCursor(p.cursor);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [event.id, revision]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    api<Page<Attempt>>('/deliveries/' + selected.id + '/attempts')
      .then((p) => {
        if (active) setAttempts(p.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [selected, revision]);
  return (
    <section className="panel detail">
      <div className="section-title">
        <h2>Event detail</h2>
        <button className="subtle" onClick={onClose}>
          Close
        </button>
      </div>
      <code>{event.id}</code>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <pre>{JSON.stringify(event.data, null, 2)}</pre>
      <h3>Deliveries</h3>
      {!deliveries.length && <p className="muted">No matching destinations.</p>}
      {deliveries.map((d) => (
        <div className="delivery" key={d.id}>
          <div>
            <Status value={d.status} />
            <code className="block">{d.id}</code>
            <p className="muted">
              {d.url} · {d.attemptCount}/6 attempts
              {d.lastHttpStatus ? ' · HTTP ' + d.lastHttpStatus : ''}
              {d.lastErrorCode ? ' · ' + d.lastErrorCode : ''}
            </p>
            {d.status === 'retrying' && (
              <p>Next attempt: {date(new Date(d.nextAttemptAt).toISOString())}</p>
            )}
            {d.originalDeliveryId && <p className="muted">Replays {d.originalDeliveryId}</p>}
          </div>
          <div className="actions">
            <button className="subtle" onClick={() => setSelected(d)}>
              Attempts
            </button>
            {d.status === 'failed' && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    api('/deliveries/' + d.id + '/replay', 'POST', {}, crypto.randomUUID()),
                  )
                }
              >
                Replay
              </button>
            )}
          </div>
        </div>
      ))}
      {cursor && (
        <button
          className="subtle"
          disabled={busy}
          onClick={() =>
            void (async () => {
              try {
                const p = await api<Page<Delivery>>(
                  '/events/' + event.id + '/deliveries?cursor=' + cursor,
                );
                setDeliveries((v) => [...v, ...p.items]);
                setCursor(p.cursor);
              } catch (e) {
                setError((e as Error).message);
              }
            })()
          }
        >
          More deliveries
        </button>
      )}
      {selected && (
        <>
          <h3>
            Attempts · <code>{short(selected.id)}</code>
          </h3>
          {!attempts.length && <p className="muted">No attempts recorded.</p>}
          <ol className="attempts">
            {attempts.map((a) => (
              <li key={a.id}>
                <strong>Attempt {a.attemptNumber}</strong>
                <Status value={a.result} />
                <span>
                  {a.httpStatus ? 'HTTP ' + a.httpStatus : (a.errorCode ?? 'Awaiting outcome')} ·{' '}
                  {a.durationMs ?? '—'} ms · {date(a.startedAt)}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
function Status({ value }: { value: string }) {
  return <span className={'status ' + value}>{value.replaceAll('_', ' ')}</span>;
}
function DestinationHistory({
  destination,
  onClose,
}: {
  destination: Destination;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Delivery[]>([]),
    [cursor, setCursor] = useState<string>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function load(next?: string) {
    setBusy(true);
    try {
      const p = await api<Page<Delivery>>(
        '/destinations/' + destination.id + '/deliveries' + (next ? '?cursor=' + next : ''),
      );
      setRows((v) => (next ? [...v, ...p.items] : p.items));
      setCursor(p.cursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [destination.id]);
  return (
    <section className="panel">
      <div className="section-title">
        <h2>History · {destination.name}</h2>
        <button className="subtle" onClick={onClose}>
          Close
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {rows.map((d) => (
        <div className="delivery" key={d.id}>
          <code>{d.id}</code>
          <Status value={d.status} />
          <span>
            {d.attemptCount}/6 attempts ·{' '}
            {d.lastHttpStatus
              ? 'HTTP ' + d.lastHttpStatus
              : (d.lastErrorCode ?? 'Awaiting delivery')}
          </span>
        </div>
      ))}
      {!rows.length && (
        <p className="muted">{busy ? 'Loading history…' : 'No retained deliveries.'}</p>
      )}
      {cursor && (
        <button className="subtle" disabled={busy} onClick={() => void load(cursor)}>
          More deliveries
        </button>
      )}
    </section>
  );
}
function Integration() {
  return (
    <section className="integration">
      <h2>Publish your first event</h2>
      <p>
        Use a project API key. A 202 response means durable acceptance; inspect delivery history for
        the outcome.
      </p>
      <pre>{`curl -X POST '${import.meta.env.VITE_API_URL ?? 'https://api.your-domain.com'}/v1/events' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Idempotency-Key: order-1842' \\\n  -d '{"type":"order.created","data":{"orderId":"1842"}}'`}</pre>
      <h3>Verify every request</h3>
      <p>
        Compute HMAC-SHA256 with your destination secret over <code>timestamp + "." + rawBody</code>
        . Compare it with the <code>X-Oathwire-Signature</code> header using a timing-safe
        comparison. Reject timestamps older than five minutes.
      </p>
      <h3>Handle duplicate deliveries</h3>
      <p>
        Persist the <code>X-Oathwire-Delivery-Id</code> before applying an effect. Automatic retries
        retain this ID; manual replay creates a new one. No ordering guarantee is provided.
      </p>
      <h3>Limits</h3>
      <p>
        16 KiB per event · 1,000 events per project per UTC day · six delivery attempts · seven-day
        history. Redirects and private network destinations are rejected.
      </p>
      <p>
        Full API and deployment documentation is in the repository’s <code>docs/</code> directory.
      </p>
    </section>
  );
}
