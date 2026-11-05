import type { AddressInfo } from 'node:net';
import { io as connect } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/app';
import { pool } from '../src/db';
import { seed, SEED_PASSWORD } from '../src/db/seed';

const { server } = buildServer();
let s: Awaited<ReturnType<typeof seed>>;
let url: string;
const V = '/api/v1';

async function login(handle: string) {
  const agent = request.agent(server);
  await agent.post(`${V}/auth/login`).send({ email: `${handle}@lockstep.test`, password: SEED_PASSWORD }).expect(200);
  return agent;
}
const cookieFor = async (handle: string) => {
  const r = await request(server).post(`${V}/auth/login`).send({ email: `${handle}@lockstep.test`, password: SEED_PASSWORD });
  return (r.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
};

beforeAll(async () => {
  s = await seed();
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.close(); await pool.end(); });

describe('authorization is enforced by the API', () => {
  it('rejects anonymous requests', async () => {
    await request(server).get(`${V}/projects`).expect(401);
  });
  it('rejects a Viewer creating a task or commenting', async () => {
    const vera = await login('vera');
    await vera.post(`${V}/projects/${s.atlas.id}/tasks`).send({ title: 'x' }).expect(403);
    await vera.post(`${V}/tasks/${s.atlasTasks[0].id}/comments`).send({ body: 'x' }).expect(403);
  });
  it('rejects a Team Member creating, deleting or assigning tasks', async () => {
    const dana = await login('dana');
    await dana.post(`${V}/projects/${s.atlas.id}/tasks`).send({ title: 'x' }).expect(403);
    await dana.delete(`${V}/tasks/${s.atlasTasks[4].id}?version=8`).expect(403);
    await dana.patch(`${V}/tasks/${s.atlasTasks[4].id}`).send({ version: 8, assigneeId: s.leo.id }).expect(403);
  });
  it('rejects a Team Member updating a task assigned to someone else', async () => {
    const dana = await login('dana');
    await dana.patch(`${V}/tasks/${s.atlasTasks[0].id}`).send({ version: 3, status: 'todo' }).expect(403);
  });
  it('hides projects from non-members as 404', async () => {
    const marcus = await login('marcus');
    await marcus.get(`${V}/projects/${s.portal.id}`).expect(404);
  });
  it('stops a Project Manager using Admin-only operations', async () => {
    const priya = await login('priya');
    await priya.post(`${V}/projects`).send({ name: 'x', key: 'XX' }).expect(403);
    await priya.delete(`${V}/projects/${s.atlas.id}`).expect(403);
    await priya.post(`${V}/users`).send({ email: 'a@b.co', name: 'x', password: 'password1', role: 'viewer' }).expect(403);
  });
  it('blocks writes to archived projects', async () => {
    const priya = await login('priya');
    const r = await priya.post(`${V}/projects/${s.billing.id}/tasks`).send({ title: 'x' }).expect(409);
    expect(r.body.error.code).toBe('PROJECT_ARCHIVED');
  });
  it('validates input', async () => {
    const priya = await login('priya');
    await priya.post(`${V}/projects/${s.atlas.id}/tasks`).send({ title: '' }).expect(400);
  });
});

describe('concurrent updates', () => {
  it('rejects a stale version with 409 and returns the latest task', async () => {
    const priya = await login('priya');
    const id = s.atlasTasks[7].id;
    const ok = await priya.patch(`${V}/tasks/${id}`).send({ version: 1, title: 'First writer' }).expect(200);
    expect(ok.body.data.version).toBe(2);
    const stale = await priya.patch(`${V}/tasks/${id}`).send({ version: 1, title: 'Stale writer' }).expect(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.details.current).toMatchObject({ title: 'First writer', version: 2 });
  });
  it('lets exactly one of many simultaneous writers win', async () => {
    const priya = await login('priya');
    const id = s.atlasTasks[6].id;
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      priya.patch(`${V}/tasks/${id}`).send({ version: 2, title: `Writer ${i}` })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
  });
});

describe('real time', () => {
  it('delivers task changes to members and notifications to the assignee, not to outsiders', async () => {
    const open = async (handle: string) => {
      const c = connect(url, { extraHeaders: { cookie: await cookieFor(handle) } });
      await new Promise<void>((r) => c.once('ready', () => r()));
      return c;
    };
    const [leo, outsider] = [await open('leo'), await open('admin')];
    const stranger = await (async () => {
      const agent = await login('admin');
      await agent.post(`${V}/users`).send({ email: 'out@lockstep.test', name: 'Out Sider', password: SEED_PASSWORD, role: 'team_member' }).expect(201);
      return open('out');
    })();
    let leaked = false;
    stranger.on('event', () => { leaked = true; });
    const gotEvent = new Promise<any>((r) => leo.on('event', (e) => e.type === 'task.created' && r(e)));
    const gotNote = new Promise<any>((r) => leo.once('notification', r));
    const priya = await login('priya');
    await priya.post(`${V}/projects/${s.atlas.id}/tasks`).send({ title: 'Live one', assigneeId: s.leo.id }).expect(201);
    expect((await gotEvent).data.title).toBe('Live one');
    expect((await gotNote).type).toBe('assignment');
    await new Promise((r) => setTimeout(r, 100));
    expect(leaked).toBe(false);
    [leo, outsider, stranger].forEach((c) => c.close());
  });
  it('refuses unauthenticated sockets', async () => {
    const c = connect(url);
    const err = await new Promise<Error>((r) => c.once('connect_error', r));
    expect(err.message).toBe('UNAUTHENTICATED');
    c.close();
  });
});

describe('activity and mentions', () => {
  it('records activity and notifies mentioned users', async () => {
    const dana = await login('dana');
    await dana.post(`${V}/tasks/${s.atlasTasks[4].id}/comments`).send({ body: 'hey @leo look' }).expect(201);
    const leo = await login('leo');
    const n = await leo.get(`${V}/notifications?unread=true`).expect(200);
    expect(n.body.data.some((x: any) => x.type === 'mention')).toBe(true);
    const a = await dana.get(`${V}/projects/${s.atlas.id}/activity`).expect(200);
    expect(a.body.data[0].action).toBe('comment.added');
  });
});
