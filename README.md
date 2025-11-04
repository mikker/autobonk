![Autobonk](/docs/autobonk.webp)

# Autobonk (EXPERIMENTAL)

Autobonk is a ready-made manager and context runtime for building Hypercore-powered, peer-to-peer applications with deterministic schemas and role-based permissions.

## Features

- Manager orchestrates _context_ creation, join, and lifecycle management on top of Corestore.
- Context base class wires Autobase, Hyperbee views, and the built-in permission system.
- Schema extension helpers (`extendSchema`, `extendDb`, `extendDispatch`) let projects compose additional tables or routes.
- Pairing flow handles invite-based onboarding with encryption and optional bootstrap peers.
- Subclasses get lifecycle hooks for provisioning and tearing down auxiliary resources like Hyperblobs.

## Usage

```sh
npm install autobonk
```

```js
import { Manager, Context } from 'autobonk'
import * as dispatch from './spec/dispatch/index.js'
import db from './spec/db/index.js'

export class Room extends Context {
  setupRoutes() {
    this.router.add('@room/send-message', async (data, context) => {
      const last = await this.lastMessage()
      const index = last ? last.index + 1 : 1

      await context.view.insert('@room/messages', {
        index,
        ...data
      })
    })
  }

  async allMessages() {
    const messages = await this.base.view.find('@room/messages').toArray()
    return messages
  }

  async sendMessage(text) {
    await this.base.append(this.schema.dispatch.encode('@room/send-message', { text }))
  }

  async lastMessage() {
    return await this.base.view.findOne('@room/messages', {
      reverse: true,
      limit: 1
    })
  }
}

const manager = new Manager('/tmp/autobonk-dev', {
  ContextClass: Room,
  schema: { db, dispatch }
})

await manager.ready()
const room = await manager.createContext({ name: 'Dev Room' })
console.log(room.key.toString('hex'))
await manager.close()
```

## Examples

- `example/basic/` – Chat room demo with a CLI (`node example/basic/cli.js`) showcasing create/join/list/connect commands.
- `example/forum/` – Moderated forum sample extending `Context` with role management routes; rebuild specs with the same schema script.

## API

### Manager

Manager extends `ReadyResource`; call `await manager.ready()` before first use and `await manager.close()` when you are finished.

#### `const manager = new Manager(baseDir, opts)`

Instantiate a manager rooted at `baseDir`. Provide the context constructor and schema bundle.

`opts` takes the following options:

```
{
  ContextClass, // required subclass of Context
  schema, // required { db, dispatch }
  bootstrap // optional Hyperswarm bootstrap peers
}
```

#### `await manager.ready()`

Wait for the manager to open its corestore and metadata database. Required before invoking other methods.

#### `await manager.close()`

Close all open contexts, the local database, and the underlying corestore.

#### `const context = await manager.createContext([options])`

Provision a new context namespace, persist its metadata locally, and return an initialized `Context` instance. Accepts an optional `{ name }` label.

#### `const context = await manager.joinContext(invite, [options])`

Join an existing context using an invite string. Persists the context locally, recreates it under a deterministic namespace, and returns the initialized `Context`. Accepts an optional `{ name }` label for local metadata.

#### `const context = await manager.getContext(keyHex)`

Resolve a previously known context by its hex-encoded key. Returns a cached `Context`, lazily loads it from disk when needed, or resolves to `null` when the key has no metadata.

#### `const records = await manager.listContexts()`

Return stored context records sorted newest-first. Each record includes `key`, `encryptionKey`, `name`, `createdAt`, `isCreator`, and `namespace`.

#### `const removed = await manager.removeContext(keyHex)`

Remove cached metadata for the given context key. Closes any active instance and resolves `true` when a record was deleted, otherwise `false`.

### Context

Context extends `ReadyResource`; call `await context.ready()` before interacting and `await context.close()` to release swarm resources.

#### `const context = new Context(store, opts)`

Construct a context around a corestore namespace. Projects typically instantiate subclasses that add routes during `setupRoutes`.

`opts` takes the following options:

```
{
  schema, // required { db, dispatch }
  key, // optional existing context key buffer
  encryptionKey, // optional symmetric encryption key buffer
  bootstrap, // optional Hyperswarm bootstrap peers
  swarm, // optional Hyperswarm instance to reuse
  autobase // optional additional Autobase constructor options
}
```

#### `await context.ready()`

Open the underlying Autobase, initialize the permission seed, and join the replication swarm if necessary.

#### `await context.close()`

Stop the pairing helpers, destroy the swarm, and close the Autobase.

##### Subclass lifecycle hooks

Override `async setupResources()` in a subclass when you need to spin up auxiliary stores (for example Hyperblobs or servers) once the Autobase view is ready. Pair it with `async teardownResources()` to clean everything up.

#### `context.writable`

Boolean getter indicating whether the local writer currently has append privileges.

#### `context.key`

Getter returning the shared context key as a `Buffer`.

#### `context.discoveryKey`

Getter for the discovery key used to join the replication swarm.

#### `context.writerKey`

Getter for the local writer key (`Buffer`). Unique per participant.

#### `context.contextKey`

Alias for `context.key` to help distinguish shared keys from writer keys in client code.

#### `context.encryptionKey`

Getter returning the symmetric encryption key (`Buffer`).

#### `const pairer = Context.pair(store, invite, [options])`

Static helper that returns a `ContextPairer` during invite-based joins. Resolves to a writable `Context` once pairing completes.

#### `const unsubscribe = context.subscribe(listener)`

Register a callback for `update` events. Returns a function that removes the listener.

#### `const hasAccess = await context.hasPermission(subjectKey, permission[, blockIndex])`

Check whether `subjectKey` holds `permission`. Accepts an optional historical `blockIndex` for time-travel checks.

#### `await context.requirePermission(subjectKey, permission)`

Throw a `PermissionError` unless `subjectKey` currently holds `permission`. Automatically skips enforcement before the context initialization record lands.

#### `await context.defineRole(name, permissions[, actorKey][, options])`

Append or apply a role definition. Requires the actor to hold `role:create`. Accepts either a single permission string or an array.

#### `await context.grantRoles(subjectKey, roles[, actorKey][, options])`

Assign one or more role names to `subjectKey`. Requires `role:assign` and validates that every role exists before committing.

#### `await context.revokeRoles(subjectKey)`

Clear all roles for `subjectKey`. Requires `role:revoke`.

#### `const changed = await context.denounceRole(roleName[, actorKey])`

Allow an actor to drop one of their roles. Requires `role:revoke` and returns `true` when a change was written.

#### `const role = await context.getRole(name)`

Fetch a stored role definition from the view.

#### `const roles = await context.getRoles(subjectKey)`

List the role names currently attached to `subjectKey`.

#### `await context.addWriter(key[, meta])`

Append a dispatch that authorizes the provided writer key. Accepts either a `Buffer` or `Uint8Array`. Pass an optional `meta` object—currently `{ isIndexer?: boolean }`—to flag writers that should opt out of Autobase indexing when you register special-purpose feeds.

#### `await context.removeWriter(key)`

Append a dispatch that removes the provided writer key.

#### `const invites = await context.listInvites([options])`

List stored invites. Pass `{ includeRevoked: true }` to include revoked entries. Requires `user:invite`. Active records contain `id`, `roles`, `expires`, `createdBy`, `createdAt`, and an optional `revokedAt` timestamp once revoked.

#### `const revoked = await context.revokeInvite(inviteId)`

Mark the invite referenced by `inviteId` as revoked. Expects a `Buffer` containing the invite id. Requires `user:invite`. Returns `true` when an active invite was revoked.

#### `const invite = await context.createInvite(options)`

Generate a new invite string. `options` is an object such as `{ roles: ['viewer'], expires: Date.now() + 3600000 }`. The `roles` field must be an array of role names. Requires `user:invite`. Resolves to the encoded invite string while persisting metadata (`roles`, `expires`, `createdBy`, `createdAt`).
