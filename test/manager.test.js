import test from 'brittle'
import { Manager } from '../src/manager.js'
import { Room } from '../example/room.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync } from 'fs'
import * as dispatch from '../example/spec/dispatch/index.js'
import db from '../example/spec/db/index.js'
import { waitForAtLeast } from "./helpers.js"

const schema = { db, dispatch }

function makeTmpDir () {
  const testId = Date.now() + Math.random()
  return join(tmpdir(), `autobonk-test-${testId}`)
}

test('Manager creates new context', async (t) => {
  const baseDir = makeTmpDir()
  let manager

  manager = new Manager(baseDir, { ContextClass: Room, schema })
  await manager.ready()

  t.teardown(async () => {
    if (manager) await manager.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  const context = await manager.createContext({ name: 'Test Context' })

  t.ok(context, 'context created')
  t.ok(context.key, 'context has key')
  t.ok(context.writable, 'context is writable')

  const contexts = await manager.listContexts()
  t.is(contexts.length, 1, 'context persisted to local storage')
  t.is(contexts[0].name, 'Test Context', 'context name saved')
  t.is(contexts[0].isCreator, true, 'marked as creator')
})

test('Manager joins existing context via invite', async (t) => {
  const baseDir1 = makeTmpDir()
  const baseDir2 = makeTmpDir()
  let manager1, manager2

  manager1 = new Manager(baseDir1, { ContextClass: Room, schema })
  await manager1.ready()

  const context = await manager1.createContext({ name: 'Original Context' })
  const invite = await context.createInvite()

  manager2 = new Manager(baseDir2, { ContextClass: Room, schema })
  await manager2.ready()

  t.teardown(async () => {
    if (manager1) await manager1.close()
    if (manager2) await manager2.close()
    rmSync(baseDir1, { recursive: true, force: true })
    rmSync(baseDir2, { recursive: true, force: true })
  })

  const joinedContext = await manager2.joinContext(invite)

  t.ok(joinedContext, 'context joined')
  t.ok(joinedContext.key, 'joined context has key')

  const contexts = await manager2.listContexts()
  t.is(contexts.length, 1, 'joined context persisted')
  t.is(contexts[0].isCreator, false, 'marked as non-creator')

  await context.sendMessage('Hello from creator')

  const messages = await waitForAtLeast(1, async () => {
    return await joinedContext.allMessages()
  })

  t.is(messages.length, 1, 'message synced')
  t.is(messages[0].text, 'Hello from creator', 'correct message content')
})

test('Manager gets existing context by key', async (t) => {
  const baseDir = makeTmpDir()

  const manager = new Manager(baseDir, { ContextClass: Room, schema })
  await manager.ready()

  t.teardown(async () => {
    if (manager) await manager.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  const created = await manager.createContext({ name: 'Test Context' })
  const keyHex = created.key.toString('hex')

  const retrieved = await manager.getContext(keyHex)

  t.ok(retrieved, 'context retrieved')
  t.alike(retrieved.key, created.key, 'same context key')
  t.is(retrieved.constructor.name, created.constructor.name, 'same context type')
})

test('Manager returns null for non-existent context', async (t) => {
  const baseDir = makeTmpDir()
  let manager

  manager = new Manager(baseDir, { ContextClass: Room, schema })
  await manager.ready()

  t.teardown(async () => {
    if (manager) await manager.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  const nonExistentKey = Buffer.alloc(32).toString('hex')
  const result = await manager.getContext(nonExistentKey)

  t.is(result, null, 'returns null for non-existent context')
})

test('Manager lists multiple contexts', async (t) => {
  const baseDir = makeTmpDir()
  let manager

  manager = new Manager(baseDir, { ContextClass: Room, schema })
  await manager.ready()

  t.teardown(async () => {
    if (manager) await manager.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  await manager.createContext({ name: 'Context 1' })
  await manager.createContext({ name: 'Context 2' })
  await manager.createContext({ name: 'Context 3' })

  const contexts = await manager.listContexts()

  t.is(contexts.length, 3, 'all contexts listed')

  const names = contexts.map(r => r.name).sort()
  t.alike(names, ['Context 1', 'Context 2', 'Context 3'], 'correct context names')

  contexts.forEach(context => {
    t.ok(context.key, 'context has key')
    t.ok(context.createdAt, 'context has createdAt')
    t.is(context.isCreator, true, 'all are creator contexts')
  })
})

test('Manager removes context', async (t) => {
  const baseDir = makeTmpDir()
  let manager

  manager = new Manager(baseDir, { ContextClass: Room, schema })
  await manager.ready()

  t.teardown(async () => {
    if (manager) await manager.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  const created = await manager.createContext({ name: 'To Remove' })
  const keyHex = created.key.toString('hex')

  let contexts = await manager.listContexts()
  t.is(contexts.length, 1, 'context exists')

  const removed = await manager.removeContext(keyHex)
  t.ok(removed, 'removeContext returns true')

  contexts = await manager.listContexts()
  t.is(contexts.length, 0, 'context removed from list')

  const retrieved = await manager.getContext(keyHex)
  t.is(retrieved, null, 'context no longer accessible')
})

test('Manager persists across restarts', async (t) => {
  const baseDir = makeTmpDir()
  let manager1, manager2

  manager1 = new Manager(baseDir, { ContextClass: Room, schema })
  await manager1.ready()

  t.teardown(async () => {
    if (manager1 && !manager1.closed) await manager1.close()
    if (manager2) await manager2.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  const context = await manager1.createContext({ name: 'Persistent Context' })
  const originalKey = context.key.toString('hex')

  const contexts1 = await manager1.listContexts()
  t.is(contexts1.length, 1, 'context created')
  t.is(contexts1[0].name, 'Persistent Context', 'correct name')

  await manager1.close()

  manager2 = new Manager(baseDir, { ContextClass: Room, schema })
  await manager2.ready()

  const contexts2 = await manager2.listContexts()
  t.is(contexts2.length, 1, 'context persisted across restart')
  t.is(contexts2[0].name, 'Persistent Context', 'context data intact')
  t.is(contexts2[0].key, originalKey, 'context key preserved')
  t.ok(contexts2[0].createdAt, 'createdAt preserved')
  t.ok(contexts2[0].encryptionKey, 'encryptionKey preserved')
})

test('Manager requires ContextClass', async (t) => {
  const baseDir = makeTmpDir()

  t.teardown(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  t.exception(() => {
    const manager = new Manager(baseDir, { schema })
    return manager
  }, /Manager requires ContextClass/)
})

test('Manager requires schema', async (t) => {
  const baseDir = makeTmpDir()

  t.teardown(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  t.exception(() => {
    const manager = new Manager(baseDir, { ContextClass: Room })
    return manager
  }, /Manager requires schema/)
})
