import test from 'brittle'
import Corestore from 'corestore'
import * as dispatch from '../example/basic/spec/dispatch/index.js'
import db from '../example/basic/spec/db/index.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync } from 'fs'
import { Room } from '../example/basic/room.js'
import { waitForAtLeast } from './helpers.js'

const OWNER_ROLE_NAME = 'owner'

const schema = { db, dispatch }

test('two autobonks communicate bidirectionally', async (t) => {
  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir1 = join(baseDir, `room1-${testId}`)
  const storageDir2 = join(baseDir, `room2-${testId}`)

  let room1 = null
  let room2 = null
  let store1 = null
  let store2 = null
  let pairer = null

  t.teardown(async () => {
    if (room1 && !room1.closed) await room1.close()
    if (room2 && !room2.closed) await room2.close()
    if (pairer && !pairer.closed) await pairer.close()
    if (store1) await store1.close()
    if (store2) await store2.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  store1 = new Corestore(storageDir1)
  room1 = new Room(store1, { schema })
  await room1.ready()

  const invite = await room1.createInvite()
  t.ok(invite, 'invite created')

  store2 = new Corestore(storageDir2)
  pairer = Room.pair(store2, invite, { schema })
  room2 = await pairer.resolve()
  await room2.ready()
  t.ok(room2, 'room2 paired')

  t.ok(room1.writable, 'room1 writable')
  t.ok(room2.writable, 'room2 writable')

  await room1.sendMessage('Hello from room1')

  const room2Messages = await waitForAtLeast(1, async () => {
    return await room2.allMessages()
  })

  t.is(room2Messages.length, 1, 'room2 received message')
  t.is(room2Messages[0].text, 'Hello from room1', 'correct message')

  await room2.sendMessage('Hello from room2')

  const room1Messages = await waitForAtLeast(1, async () => {
    return await room1.allMessages()
  })

  t.is(room1Messages.length, 2, 'room1 received both messages')
  const texts = room1Messages.map((m) => m.text).sort()
  t.alike(
    texts,
    ['Hello from room1', 'Hello from room2'].sort(),
    'both messages present'
  )
})

test('permission message schemas work', async (t) => {
  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir = join(baseDir, `permissions-${testId}`)

  let room = null
  let store = null

  t.teardown(async () => {
    if (room && !room.closed) await room.close()
    if (store) await store.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  store = new Corestore(storageDir)
  room = new Room(store, { schema })
  await room.ready()

  // Wait for automatic context initialization
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Test role definition message
  await room.base.append(
    room.schema.dispatch.encode('@autobonk/define-role', {
      name: 'admin',
      permissions: ['role:create', 'role:assign'],
      rev: 1,
      index: 1,
      timestamp: Date.now()
    })
  )

  // Test ACL entry message
  await room.base.append(
    room.schema.dispatch.encode('@autobonk/grant-roles', {
      subjectKey: Buffer.from('test-user-key'),
      roles: ['admin'],
      rev: 1,
      index: 2,
      timestamp: Date.now()
    })
  )

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Verify data was stored
  const contextInits = await room.base.view
    .find('@autobonk/context-init')
    .toArray()

  // We now expect 1 record from automatic initialization
  t.is(contextInits.length, 1, 'context init stored')
  t.is(
    contextInits[0].creatorKey.length,
    32,
    'creator key is proper public key length'
  )

  const roleDefs = await room.base.view.find('@autobonk/role-def').toArray()
  const ownerRole = roleDefs.find((role) => role.name === OWNER_ROLE_NAME)
  t.ok(ownerRole, 'owner role seeded')
  t.alike(ownerRole.permissions, [
    'role:create',
    'role:assign',
    'role:revoke',
    'user:invite',
    'user:remove'
  ])

  const adminRole = roleDefs.find((role) => role.name === 'admin')
  t.ok(adminRole, 'admin role stored')
  t.alike(
    adminRole.permissions,
    ['role:create', 'role:assign'],
    'admin permissions correct'
  )

  const aclEntries = await room.base.view.find('@autobonk/acl-entry').toArray()
  const ownerAcl = aclEntries.find((entry) =>
    entry.subjectKey.equals(contextInits[0].creatorKey)
  )
  t.ok(ownerAcl, 'owner ACL entry stored')
  t.alike(ownerAcl.roles, [OWNER_ROLE_NAME], 'owner has owner role')

  const adminAcl = aclEntries.find((entry) => entry.roles.includes('admin'))
  t.ok(adminAcl, 'admin ACL entry stored')
  t.alike(adminAcl.roles, ['admin'], 'admin roles correct')

  t.pass('all permission message types work correctly')
})

test('basic permission checking works', async (t) => {
  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir = join(baseDir, `permissions-check-${testId}`)

  let room = null
  let store = null

  t.teardown(async () => {
    if (room && !room.closed) await room.close()
    if (store) await store.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  store = new Corestore(storageDir)
  room = new Room(store, { schema })
  await room.ready()

  // Wait for automatic initialization
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Get the creator key from the context init
  const contextInit = await room.base.view.findOne('@autobonk/context-init', {})
  t.ok(contextInit, 'context was initialized')

  const ownerKey = contextInit.creatorKey
  const randomKey = Buffer.from('some-random-user-key-32-bytes-xx')

  // Test owner role grants meta-permissions
  t.ok(
    await room.hasPermission(ownerKey, 'role:create'),
    'owner has role:create'
  )
  t.ok(
    await room.hasPermission(ownerKey, 'role:assign'),
    'owner has role:assign'
  )
  t.ok(
    await room.hasPermission(ownerKey, 'user:invite'),
    'owner has user:invite'
  )

  // Test random user has no permissions
  t.is(
    await room.hasPermission(randomKey, 'role:create'),
    false,
    'random user lacks role:create'
  )
  t.is(
    await room.hasPermission(randomKey, 'role:assign'),
    false,
    'random user lacks role:assign'
  )

  // Test requirePermission throws for unauthorized user
  try {
    await room.requirePermission(randomKey, 'role:create')
    t.fail('should have thrown PermissionError')
  } catch (err) {
    t.is(err.name, 'PermissionError', 'throws PermissionError')
    t.is(err.requiredPermission, 'role:create', 'correct permission in error')
  }

  // Test requirePermission passes for owner
  try {
    await room.requirePermission(ownerKey, 'role:create')
    t.pass('owner passes requirePermission check')
  } catch (err) {
    t.fail('owner should have permission')
  }

  t.pass('basic permission checking works')
})

test('addWriter metadata passes through to Autobase', async (t) => {
  t.plan(4)

  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir = join(baseDir, `writer-meta-${testId}`)

  let room = null
  let store = null

  t.teardown(async () => {
    if (room && !room.closed) await room.close()
    if (store) await store.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  store = new Corestore(storageDir)
  room = new Room(store, { schema })
  await room.ready()

  const captured = []
  const originalAppend = room.base.append.bind(room.base)

  room.base.append = async (buffer) => {
    const decoded = dispatch.decode(buffer)
    if (decoded.name === '@autobonk/add-writer') {
      captured.push(decoded.value)
    }
    return await originalAppend(buffer)
  }

  t.teardown(() => {
    room.base.append = originalAppend
  })

  const writerOne = Buffer.alloc(32, 1)
  const writerTwo = Buffer.alloc(32, 2)

  await room.addWriter(writerOne, { isIndexer: false })
  await room.addWriter(writerTwo)

  for (let i = 0; i < 50 && captured.length < 2; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  t.ok(captured.length >= 2, 'capture both addWriter dispatches')
  t.ok(captured[0].key.equals(writerOne), 'first writer key passed through')
  t.is(
    captured[0].isIndexer,
    false,
    'first writer metadata disables indexer role'
  )
  t.is(
    captured[1].isIndexer,
    true,
    'default write keeps Autobase indexing behavior'
  )
})

test('ACL-based permissions work', async (t) => {
  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir = join(baseDir, `acl-permissions-${testId}`)

  let room = null
  let store = null

  t.teardown(async () => {
    if (room && !room.closed) await room.close()
    if (store) await store.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  store = new Corestore(storageDir)
  room = new Room(store, { schema })
  await room.ready()

  // Wait for automatic initialization
  await new Promise((resolve) => setTimeout(resolve, 100))

  const userKey = Buffer.from('test-user-key-32-bytes-for-testxx')

  // Create a role with specific permissions
  await room.base.append(
    room.schema.dispatch.encode('@autobonk/define-role', {
      name: 'moderator',
      permissions: ['post:delete', 'user:ban'],
      rev: 1,
      index: 1,
      timestamp: Date.now()
    })
  )

  // Grant the role to a user
  await room.base.append(
    room.schema.dispatch.encode('@autobonk/grant-roles', {
      subjectKey: userKey,
      roles: ['moderator'],
      rev: 1,
      index: 2,
      timestamp: Date.now()
    })
  )

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Test user now has the granted permissions
  t.ok(
    await room.hasPermission(userKey, 'post:delete'),
    'user has post:delete permission'
  )
  t.ok(
    await room.hasPermission(userKey, 'user:ban'),
    'user has user:ban permission'
  )

  // Test user does not have other permissions
  t.is(
    await room.hasPermission(userKey, 'role:create'),
    false,
    'user lacks role:create'
  )
  t.is(
    await room.hasPermission(userKey, 'post:create'),
    false,
    'user lacks post:create'
  )

  t.pass('ACL-based permissions work')
})

test('role/ACL management API works', async (t) => {
  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir = join(baseDir, `role-api-${testId}`)

  let room = null
  let store = null

  t.teardown(async () => {
    if (room && !room.closed) await room.close()
    if (store) await store.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  store = new Corestore(storageDir)
  room = new Room(store, { schema })
  await room.ready()

  // Wait for automatic initialization
  await new Promise((resolve) => setTimeout(resolve, 100))

  const userKey = Buffer.from('api-test-user-key-32-bytes-testxx')

  // Test defineRole API
  await room.defineRole('editor', ['post:create', 'post:edit'])
  await room.defineRole('admin', ['post:create', 'post:edit', 'post:delete'])

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Verify roles were created
  const editorRole = await room.getRole('editor')
  t.ok(editorRole, 'editor role created')
  t.alike(
    editorRole.permissions,
    ['post:create', 'post:edit'],
    'editor permissions correct'
  )

  const adminRole = await room.getRole('admin')
  t.ok(adminRole, 'admin role created')
  t.alike(
    adminRole.permissions,
    ['post:create', 'post:edit', 'post:delete'],
    'admin permissions correct'
  )

  // Test grantRoles API
  await room.grantRoles(userKey, ['editor'])

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Verify user has the role
  const userRoles = await room.getRoles(userKey)
  t.alike(userRoles, ['editor'], 'user has editor role')

  // Verify user has permissions from the role
  t.ok(
    await room.hasPermission(userKey, 'post:create'),
    'user can create posts'
  )
  t.ok(await room.hasPermission(userKey, 'post:edit'), 'user can edit posts')
  t.is(
    await room.hasPermission(userKey, 'post:delete'),
    false,
    'user cannot delete posts'
  )

  // Test upgrading role
  await room.grantRoles(userKey, ['admin'])

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Verify user now has admin role
  const upgradedRoles = await room.getRoles(userKey)
  t.alike(upgradedRoles, ['admin'], 'user upgraded to admin')

  // Verify user now has delete permission
  t.ok(
    await room.hasPermission(userKey, 'post:delete'),
    'admin can delete posts'
  )

  // Test revokeRoles API
  await room.revokeRoles(userKey)

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Verify user has no roles
  const revokedRoles = await room.getRoles(userKey)
  t.alike(revokedRoles, [], 'user has no roles after revocation')

  // Verify user has no permissions
  t.is(
    await room.hasPermission(userKey, 'post:create'),
    false,
    'revoked user cannot create posts'
  )
  t.is(
    await room.hasPermission(userKey, 'post:delete'),
    false,
    'revoked user cannot delete posts'
  )

  t.pass('role/ACL management API works')
})

test('grantRoles handles apply-mode snapshot', async (t) => {
  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir = join(baseDir, `grant-apply-${testId}`)

  let room = null
  let store = null

  t.teardown(async () => {
    if (room && !room.closed) await room.close()
    if (store) await store.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  store = new Corestore(storageDir)
  room = new Room(store, { schema })
  await room.ready()

  const ownerKey = room.base.local.key
  const userKey = Buffer.from('apply-mode-user-key-32-byte!!')

  await room.defineRole('member', ['post:create'])
  await room.defineRole('postboss', ['post:delete'])

  await room.grantRoles(userKey, ['member'])

  const applyBase = { length: room.base.length }
  await room.grantRoles(userKey, ['member', 'postboss'], ownerKey, {
    base: applyBase,
    view: room.base.view,
    blockIndex: room.base.length,
    order: 42
  })

  await new Promise((resolve) => setTimeout(resolve, 50))

  const aclEntry = await room.base.view.get('@autobonk/acl-entry', {
    subjectKey: userKey
  })
  t.ok(aclEntry, 'acl entry persisted')
  t.alike(
    aclEntry.roles.sort(),
    ['member', 'postboss'],
    'roles recorded through apply helper'
  )

  const audit = await room.getRoles(userKey)
  t.alike(
    audit.sort(),
    ['member', 'postboss'],
    'getRoles sees updated assignment'
  )
})

test('role-based invites', async (t) => {
  t.plan(8)

  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir1 = join(baseDir, `invite-creator-${testId}`)
  const storageDir2 = join(baseDir, `invite-joiner-${testId}`)

  let room1 = null
  let room2 = null
  let store1 = null
  let store2 = null
  let pairer = null

  t.teardown(async () => {
    if (room1 && !room1.closed) await room1.close()
    if (room2 && !room2.closed) await room2.close()
    if (pairer && !pairer.closed) await pairer.close()
    if (store1) await store1.close()
    if (store2) await store2.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  // Create first room (owner role has all permissions)
  store1 = new Corestore(storageDir1)
  room1 = new Room(store1, { schema })
  await room1.ready()

  // Define roles
  await room1.defineRole('viewer', ['post:read'])
  await room1.defineRole('editor', ['post:read', 'post:create'])

  // Wait for role processing
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Create invite with specific roles
  const invite = await room1.createInvite({ roles: ['viewer', 'editor'] })
  t.ok(invite, 'role-based invite created')

  // Join via invite
  store2 = new Corestore(storageDir2)
  pairer = Room.pair(store2, invite, { schema })
  room2 = await pairer.resolve()
  await room2.ready()

  // Wait for pairing and role assignment to complete
  await new Promise((resolve) => setTimeout(resolve, 200))

  t.ok(room2.writable, 'room2 is writable')

  // Check that joiner has the assigned roles
  const joinerKey = room2.base.local.key // writer key, not context key
  const assignedRoles = await room1.getRoles(joinerKey)
  t.alike(
    assignedRoles.sort(),
    ['editor', 'viewer'],
    'joiner has assigned roles'
  )

  // Check that joiner has permissions from those roles
  t.ok(
    await room1.hasPermission(joinerKey, 'post:read'),
    'joiner can read posts'
  )
  t.ok(
    await room1.hasPermission(joinerKey, 'post:create'),
    'joiner can create posts'
  )

  // Test permission enforcement from room2's perspective
  t.ok(
    await room2.hasPermission(joinerKey, 'post:read'),
    'joiner can read posts (from room2)'
  )
  t.ok(
    await room2.hasPermission(joinerKey, 'post:create'),
    'joiner can create posts (from room2)'
  )

  // Verify joiner cannot invite others (no user:invite permission)
  t.is(
    await room2.hasPermission(joinerKey, 'user:invite'),
    false,
    'joiner cannot create invites'
  )
})

test('invite permission enforcement', async (t) => {
  t.plan(2)

  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir = join(baseDir, `invite-perms-${testId}`)

  let room = null
  let store = null

  t.teardown(async () => {
    if (room && !room.closed) await room.close()
    if (store) await store.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  store = new Corestore(storageDir)
  room = new Room(store, { schema })
  await room.ready()

  // Owner can create invites (has user:invite permission)
  const ownerInvite = await room.createInvite({ roles: ['viewer'] })
  t.ok(ownerInvite, 'owner can create invites')

  // Create a user without user:invite permission
  const userKey = Buffer.alloc(32).fill(1)

  // Verify user cannot create invites by checking hasPermission directly
  const hasInvitePermission = await room.hasPermission(userKey, 'user:invite')
  t.is(
    hasInvitePermission,
    false,
    'user without permission cannot create invites'
  )
})

test('multi-invite lifecycle is tracked and revocable', async (t) => {
  t.plan(13)

  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir = join(baseDir, `multi-invite-${testId}`)

  let room = null
  let store = null

  t.teardown(async () => {
    if (room && !room.closed) await room.close()
    if (store) await store.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  store = new Corestore(storageDir)
  room = new Room(store, { schema })
  await room.ready()

  const inviteOne = await room.createInvite({ roles: ['viewer'] })
  t.ok(inviteOne, 'created first invite')

  const inviteTwo = await room.createInvite({
    roles: ['editor'],
    expires: Date.now() + 1000
  })
  t.ok(inviteTwo, 'created second invite with options')

  await new Promise((resolve) => setTimeout(resolve, 100))

  const invites = await room.listInvites()
  t.is(invites.length, 2, 'two active invites')

  const first = invites[0]
  t.ok(Buffer.isBuffer(first.createdBy), 'createdBy stored')
  t.ok(typeof first.createdAt === 'number', 'createdAt stored')
  t.ok(!first.revokedAt, 'active invite has no revokedAt value')

  const revoked = await room.revokeInvite(first.id)
  t.ok(revoked, 'revokeInvite returns true for active invite')

  await new Promise((resolve) => setTimeout(resolve, 100))

  const activeInvites = await room.listInvites()
  t.is(activeInvites.length, 1, 'one invite remains active after revocation')

  const allInvites = await room.listInvites({ includeRevoked: true })
  const revokedRecord = allInvites.find((entry) => entry.revokedAt)
  t.ok(
    revokedRecord,
    'revoked invite still present when including revoked entries'
  )
  t.ok(
    typeof revokedRecord.revokedAt === 'number',
    'revoked invite records timestamp'
  )

  const remaining = await room.listInvites()
  t.is(remaining.length, 1, 'exactly one invite to clean up')

  const cleared = await room.revokeInvite(remaining[0].id)
  t.ok(cleared, 'revokeInvite removes the final invite')

  const noneLeft = await room.listInvites()
  t.is(noneLeft.length, 0, 'no active invites after cleanup')
})

test('denounceRole removes owner privileges', async (t) => {
  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir = join(baseDir, `denounce-role-${testId}`)

  let room = null
  let store = null

  t.teardown(async () => {
    if (room && !room.closed) await room.close()
    if (store) await store.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  store = new Corestore(storageDir)
  room = new Room(store, { schema })
  await room.ready()

  await new Promise((resolve) => setTimeout(resolve, 100))

  const contextInit = await room.base.view.findOne('@autobonk/context-init', {})
  const ownerKey = contextInit.creatorKey

  t.ok(
    await room.hasPermission(ownerKey, 'role:create'),
    'owner starts with elevated permissions'
  )

  const result = await room.denounceRole(OWNER_ROLE_NAME)
  t.ok(result, 'denounceRole returns true when owner role removed')

  await new Promise((resolve) => setTimeout(resolve, 100))

  const roles = await room.getRoles(ownerKey)
  t.alike(roles, [], 'owner role removed from ACL entry')

  t.is(
    await room.hasPermission(ownerKey, 'role:create'),
    false,
    'owner loses elevated permissions after denouncing'
  )

  try {
    await room.defineRole('replacement-owner', ['role:create'])
    t.fail('denounced owner should not be able to define roles')
  } catch (err) {
    t.is(
      err.name,
      'PermissionError',
      'missing permission blocks role definition'
    )
  }
})
